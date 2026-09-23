import "dotenv/config";

import { and, eq, isNull } from "drizzle-orm";

import { db, schema } from "../../db";
import { donoConhecido } from "../dono";
import { FusionSolarClient } from "./client";

/**
 * Coletor do FusionSolar: lê as usinas Huawei e grava no banco.
 *
 * Mesmo formato dos coletores da FoxESS e da Solis — idempotente, roda sozinho,
 * repetir não duplica.
 *
 * O cuidado próprio daqui é a **noite**. O portal marca o inversor como
 * desconectado quando o sol se põe, porque ele simplesmente desliga. Alertar
 * por isso encheria a tela de "sem comunicação" todo fim de tarde, e no dia
 * seguinte tudo estaria normal de novo — o jeito mais rápido de ensinar a
 * equipe a ignorar alerta. Por isso desconectado só vira alerta quando a usina
 * também **não gerou nada no dia**.
 *
 *   npm run coletar:fusionsolar
 */

/** `real_health_state`: 1 desconectado, 2 em falha, 3 saudável. */
const DESCONECTADO = 1;
const EM_FALHA = 2;

/**
 * Janela em que um inversor de Sergipe deveria estar acordado, hora local.
 *
 * Fora dela, desconectado é o sol se pondo — o inversor desliga e o portal o
 * marca como desconectado, todo dia, em todas as usinas.
 */
const AMANHECE = 7;
const ANOITECE = 17;

/** Hora local de Sergipe (UTC−3), sem depender do fuso da máquina. */
function horaLocal(): number {
  return Number(
    new Intl.DateTimeFormat("pt-BR", {
      hour: "numeric",
      hour12: false,
      timeZone: "America/Sao_Paulo",
    }).format(new Date()),
  );
}

/** Hoje às 12h UTC — o instante que representa o dia na tabela de leituras. */
function hoje(): Date {
  const d = new Date();
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 12, 0, 0),
  );
}

function numero(v: unknown): number | undefined {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : undefined;
}

interface DispositivoHuawei {
  id?: number | string;
  devName?: string;
  esnCode?: string;
  stationCode?: string;
  devTypeId?: number;
  invType?: string;
  model?: string;
  softwareVersion?: string;
}

async function main() {
  const usuario = process.env.FUSIONSOLAR_USUARIO;
  const systemCode = process.env.FUSIONSOLAR_SYSTEM_CODE;
  const base = process.env.FUSIONSOLAR_BASE_URL;

  if (!usuario || !systemCode || !base) {
    console.error(
      "Faltam FUSIONSOLAR_USUARIO, FUSIONSOLAR_SYSTEM_CODE ou " +
        "FUSIONSOLAR_BASE_URL no .env. Rode `npm run probe:fusionsolar`.",
    );
    process.exit(1);
  }

  const empresa = await db.query.empresa.findFirst();
  if (!empresa) {
    console.error("Nenhuma empresa no banco. Rode `npm run db:seed` primeiro.");
    process.exit(1);
  }

  const cliente = new FusionSolarClient(usuario, systemCode, base);

  let conta = await db.query.contaPortal.findFirst({
    where: and(
      eq(schema.contaPortal.empresaId, empresa.id),
      eq(schema.contaPortal.fabricante, "huawei"),
    ),
  });
  if (!conta) {
    [conta] = await db
      .insert(schema.contaPortal)
      .values({
        empresaId: empresa.id,
        fabricante: "huawei",
        apelido: "FusionSolar",
        /**
         * A Northbound é a API mais apertada do projeto: uma chamada por minuto
         * por endpoint, sessão única, e `⌈usinas ÷ 100⌉ + 24` chamadas por dia
         * no histórico diário. De hora em hora cabe com folga.
         */
        cadenciaMinutos: 60,
        chamadasDiaMax: 200,
      })
      .returning();
  }

  /**
   * Respeita a cadência gravada na conta antes de tocar na API.
   *
   * A Northbound limita o KPI de agora a cerca de `⌈usinas ÷ 100⌉` chamadas a
   * cada cinco minutos — com 16 usinas, uma. Rodar `npm run atualizar` duas
   * vezes seguidas derrubava a etapa com `failCode 407`, e o custo de insistir
   * não é só o erro: é a conta trancar.
   *
   * Pular é mais honesto que falhar. Quem realmente quer forçar passa
   * `--forcar`.
   */
  const forcar = process.argv.includes("--forcar");
  if (!forcar && conta.ultimaColetaEm) {
    const minutos = Math.floor(
      (Date.now() - conta.ultimaColetaEm.getTime()) / 60_000,
    );
    const cadencia = conta.cadenciaMinutos ?? 60;
    if (minutos < cadencia) {
      console.log(
        `Coletado há ${minutos} min, e a cadência é de ${cadencia} min.\n` +
          "Nada a fazer — a Huawei recusa consultas seguidas e insistir tranca\n" +
          "a conta. Para forçar mesmo assim: npm run coletar:fusionsolar -- --forcar",
      );
      process.exit(0);
    }
  }

  console.log("Lendo usinas...");
  const { usinas, rota } = await cliente.listarUsinas();
  console.log(`  ${usinas.length} usinas (rota ${rota})`);

  const usinaPorCodigo = new Map<string, string>();
  /**
   * Usinas que apareceram no portal e ainda não têm dono conhecido.
   *
   * Antes elas ganhavam um cliente inventado com o nome do login do técnico.
   * Agora ficam sem dono e esperam em /usinas/sem-dono, que é honesto e
   * reversível — inventar não era nem uma coisa nem outra.
   */
  let semDono = 0;
  let usinasNovas = 0;
  let semPotencia = 0;

  for (const u of usinas) {
    const nome = u.nome?.trim() || `Usina ${u.codigo}`;
    // Vem em kWp, apesar de a documentação dizer MW — ver comentário no client.
    const kwp = u.capacidadeBruta && u.capacidadeBruta > 0 ? u.capacidadeBruta : null;
    if (!kwp) semPotencia++;

    // O endereço da Huawei vem com país, estado e cidade grudados sem separador.
    // Não dá para fatiar com confiança, então entra inteiro em `cidade` só
    // quando é curto; a ficha de cadastro corrige depois.
    const endereco = u.endereco?.trim();

    const vinculo = await db.query.vinculoPortal.findFirst({
      where: and(
        eq(schema.vinculoPortal.contaPortalId, conta.id),
        eq(schema.vinculoPortal.idExterno, u.codigo),
      ),
    });

    if (vinculo) {
      usinaPorCodigo.set(u.codigo, vinculo.usinaId);
      await db
        .update(schema.usina)
        .set({ nome, ...(kwp ? { potenciaKwp: String(kwp) } : {}) })
        .where(eq(schema.usina.id, vinculo.usinaId));
      continue;
    }

    const clienteId = await donoConhecido(empresa.id, nome);
    if (!clienteId) semDono++;

    const [usina] = await db
      .insert(schema.usina)
      .values({
        empresaId: empresa.id,
        clienteId,
        nome,
        potenciaKwp: kwp ? String(kwp) : null,
        cidade: endereco && endereco.length <= 60 ? endereco : null,
        dataInstalacao: u.conexaoEm ? new Date(u.conexaoEm) : null,
        status: "gerando",
      })
      .returning();

    await db.insert(schema.vinculoPortal).values({
      empresaId: empresa.id,
      usinaId: usina.id,
      contaPortalId: conta.id,
      idExterno: u.codigo,
      nomeExterno: nome,
    });

    usinaPorCodigo.set(u.codigo, usina.id);
    usinasNovas++;
  }

  console.log("Lendo dispositivos...");
  const codigos = usinas.map((u) => u.codigo);
  const respDisp = await cliente.listarDispositivos(codigos);
  const dispositivos = (respDisp.data ?? []) as DispositivoHuawei[];
  console.log(`  ${dispositivos.length} dispositivos`);

  let equipamentosNovos = 0;
  for (const d of dispositivos) {
    const usinaId = d.stationCode ? usinaPorCodigo.get(d.stationCode) : undefined;
    const serie = d.esnCode?.trim();
    if (!usinaId || !serie) continue;

    const jaTem = await db.query.equipamento.findFirst({
      where: and(
        eq(schema.equipamento.empresaId, empresa.id),
        eq(schema.equipamento.numeroSerie, serie),
      ),
    });
    if (jaTem) continue;

    await db.insert(schema.equipamento).values({
      empresaId: empresa.id,
      usinaId,
      // devTypeId 38 é inversor residencial; 39 seria bateria.
      tipo: d.devTypeId === 39 ? "bateria" : "inversor",
      fabricante: "Huawei",
      modelo: d.invType ?? d.model,
      numeroSerie: serie,
    });
    equipamentosNovos++;
  }

  console.log("Lendo geração e estado...");
  const kpi = await cliente.kpiAgora(codigos);
  const linhas = (kpi.data ?? []) as {
    stationCode?: string;
    dataItemMap?: Record<string, unknown>;
  }[];

  const dia = hoje();
  const agora = new Date();
  let leituras = 0;
  let alertas = 0;
  let noite = 0;

  for (const linha of linhas) {
    const usinaId = linha.stationCode
      ? usinaPorCodigo.get(linha.stationCode)
      : undefined;
    if (!usinaId) continue;

    const mapa = linha.dataItemMap ?? {};
    const geracaoDia = numero(mapa.day_power);
    const saude = numero(mapa.real_health_state);

    if (geracaoDia !== undefined && geracaoDia >= 0) {
      await db
        .insert(schema.leitura)
        .values({
          empresaId: empresa.id,
          usinaId,
          medidoEm: dia,
          granularidade: "dia",
          energiaKwh: String(geracaoDia),
        })
        /**
         * A Northbound entrega geração por usina, não por inversor — então a
         * leitura vai sem `equipamento_id`, e o índice que a protege é o
         * parcial `leitura_usina_instante_uq`, que só vale quando esse campo é
         * nulo. Sem o `targetWhere` o Postgres não reconhece qual índice usar e
         * a inserção quebra em vez de atualizar.
         */
        .onConflictDoUpdate({
          target: [
            schema.leitura.usinaId,
            schema.leitura.medidoEm,
            schema.leitura.granularidade,
          ],
          targetWhere: isNull(schema.leitura.equipamentoId),
          set: { energiaKwh: String(geracaoDia), coletadoEm: new Date() },
        });
      leituras++;
    }

    /**
     * Desconectado à noite é o sol se pondo, não defeito: a Huawei marca todo
     * inversor como desconectado depois do pôr do sol, e sem este filtro o
     * sistema abriria dezesseis alertas por dia, todos os dias, até a equipe
     * aprender a ignorar a tela.
     *
     * Mas só vale à noite. Uma usina que gerou pela manhã e está desconectada
     * às três da tarde caiu de verdade — foi o que aconteceu com duas delas na
     * primeira coleta, e a primeira versão desta regra as escondeu. Quem não
     * gerou nada no dia é alerta a qualquer hora.
     */
    const noiteAgora = horaLocal() >= ANOITECE || horaLocal() < AMANHECE;
    if (saude === DESCONECTADO && (geracaoDia ?? 0) > 0 && noiteAgora) {
      noite++;
      continue;
    }

    if (saude === EM_FALHA || saude === DESCONECTADO) {
      const resultado = await db
        .insert(schema.alerta)
        .values({
          empresaId: empresa.id,
          usinaId,
          tipo: saude === EM_FALHA ? "alarme_inversor" : "sem_comunicacao",
          severidade: "critico",
          mensagem:
            saude === EM_FALHA
              ? "Usina em falha, segundo o portal da Huawei"
              : (geracaoDia ?? 0) > 0
                ? `Usina desconectada durante o dia, depois de gerar ${geracaoDia} kWh, segundo o portal da Huawei`
                : "Usina desconectada e sem geração hoje, segundo o portal da Huawei",
          codigoFabricante: `huawei-saude-${saude}`,
          abertoEm: dia,
        })
        .onConflictDoNothing()
        .returning({ id: schema.alerta.id });
      if (resultado.length) alertas++;
    }
  }

  await db
    .update(schema.contaPortal)
    .set({ ultimaColetaEm: new Date(), ultimoErro: null })
    .where(eq(schema.contaPortal.id, conta.id));

  console.log(
    `\nUsinas novas: ${usinasNovas} · Equipamentos novos: ${equipamentosNovos} · ` +
      `Leituras: ${leituras} · Alertas novos: ${alertas}`,
  );
  if (semPotencia) {
    console.log(
      `${semPotencia} usinas sem potência no cadastro do portal — o campo está ` +
        "vazio lá, e sem ele o alerta de geração baixa não funciona nelas.",
    );
  }
  if (noite) {
    console.log(
      `${noite} usinas desconectadas fora do horário de sol, mas com geração ` +
        "hoje: é o inversor dormindo, não deu alerta.",
    );
  }
  console.log(`Fechado em ${agora.toLocaleString("pt-BR")}.`);
  process.exit(0);
}

main().catch(async (erro) => {
  const mensagem = erro instanceof Error ? erro.message : String(erro);
  const conta = await db.query.contaPortal.findFirst({
    where: eq(schema.contaPortal.fabricante, "huawei"),
  });
  if (conta) {
    await db
      .update(schema.contaPortal)
      .set({ ultimoErro: mensagem.slice(0, 500) })
      .where(eq(schema.contaPortal.id, conta.id));
  }
  console.error("Falhou:", mensagem);
  process.exit(1);
});
