import "dotenv/config";

import { and, eq, inArray } from "drizzle-orm";

import { db, schema } from "../../db";
import { InversorSolis, SolisClient, UsinaSolis } from "./client";

/**
 * Coletor da Solis: lê o SolisCloud e grava no banco.
 *
 * **Lê mais de uma conta.** A BB tem duas: a primeira, com a usina
 * `equilibrium`, e outra com quatro (Italo Magnavita 01 e 02, Adelvo Ivo do
 * Prado 1 e 2). Descobrimos isso do jeito difícil — a API da primeira conta
 * respondia "1 usina" e estava certa; era a pergunta que estava incompleta.
 * Cada conta tem sua própria chave, então o coletor varre todas as que
 * estiverem no `.env`:
 *
 *     SOLIS_KEY_ID / SOLIS_KEY_SECRET
 *     SOLIS_KEY_ID_2 / SOLIS_KEY_SECRET_2
 *     SOLIS_KEY_ID_3 / ...
 *
 * Mesma forma dos outros coletores — idempotente, roda sozinho, repetir não
 * duplica. O que muda é o cuidado com **unidade**: o SolisCloud é o único dos
 * portais que troca a unidade conforme o tamanho do número. A mesma usina
 * devolve `dayEnergy: 37.3` em kWh e `allEnergy: 14.329` em MWh, cada um com o
 * seu campo `...Str` dizendo qual é. Ler o número sem ler a unidade erra por mil.
 *
 * A outra armadilha tem nome bonito: `dayPowerGeneration` **não é geração**. É
 * hora de sol pleno — 3,39 na usina de 11 kWp que gerou 37,3 kWh. O campo certo
 * é `dayEnergy`, e os dois aparecem lado a lado esperando a confusão.
 *
 *   npm run coletar:solis
 */

/** Fatores para kWh. A chave é o `...Str` que o próprio portal manda. */
const ENERGIA_EM_KWH: Record<string, number> = {
  wh: 0.001,
  kwh: 1,
  mwh: 1000,
  gwh: 1_000_000,
};

/** Fatores para watt. */
const POTENCIA_EM_W: Record<string, number> = {
  w: 1,
  kw: 1000,
  mw: 1_000_000,
};

function converter(
  valor: number | undefined,
  unidade: string | undefined,
  tabela: Record<string, number>,
  padrao: number,
): number | undefined {
  if (valor === undefined || !Number.isFinite(valor)) return undefined;
  const fator = tabela[(unidade ?? "").trim().toLowerCase()] ?? padrao;
  return valor * fator;
}

const kwh = (v?: number, u?: string) => converter(v, u, ENERGIA_EM_KWH, 1);
const watts = (v?: number, u?: string) => converter(v, u, POTENCIA_EM_W, 1000);

/**
 * Estado do equipamento no SolisCloud.
 *
 * Só o 1 apareceu nas contas da BB até agora; 2 e 3 vêm da documentação e dos
 * contadores da lista de usinas, que separa normal, offline e falha. Estado
 * desconhecido também vira alerta — melhor um alerta a mais do que uma usina
 * parada em silêncio.
 */
const ESTADO_ROTULO: Record<number, string> = {
  1: "online",
  2: "offline",
  3: "em falha",
};

/** Hoje às 12h UTC — o instante que representa o dia na tabela de leituras. */
function hoje(): Date {
  const d = new Date();
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 12, 0, 0),
  );
}

interface Credencial {
  indice: number;
  apelido: string;
  keyId: string;
  keySecret: string;
}

/**
 * Lê as contas do `.env`.
 *
 * A primeira não tem sufixo, por compatibilidade com quem já tinha uma conta
 * só; as demais são numeradas. Para de procurar no primeiro buraco, então
 * pular do 2 para o 4 esconde a quarta — e o aviso na tela diz isso.
 */
function credenciais(): Credencial[] {
  const achadas: Credencial[] = [];
  for (let i = 1; i <= 9; i++) {
    const sufixo = i === 1 ? "" : `_${i}`;
    const keyId = process.env[`SOLIS_KEY_ID${sufixo}`];
    const keySecret = process.env[`SOLIS_KEY_SECRET${sufixo}`];
    if (!keyId || !keySecret) break;
    achadas.push({
      indice: i,
      apelido: `SolisCloud #${i}`,
      keyId: keyId.trim(),
      keySecret: keySecret.trim(),
    });
  }
  return achadas;
}

interface Resultado {
  usinasNovas: number;
  equipamentosNovos: number;
  leituras: number;
  alertas: number;
  usinas: number;
}

async function coletarConta(
  credencial: Credencial,
  empresaId: string,
  contasSolis: string[],
): Promise<Resultado> {
  const cliente = new SolisClient(
    credencial.keyId,
    credencial.keySecret,
    process.env.SOLIS_BASE_URL,
  );

  let conta = await db.query.contaPortal.findFirst({
    where: and(
      eq(schema.contaPortal.empresaId, empresaId),
      eq(schema.contaPortal.fabricante, "solis"),
      eq(schema.contaPortal.apelido, credencial.apelido),
    ),
  });
  if (!conta) {
    [conta] = await db
      .insert(schema.contaPortal)
      .values({
        empresaId,
        fabricante: "solis",
        apelido: credencial.apelido,
        // O portal atualiza o dado a cada 5 minutos; coletar mais que isso é
        // gastar chamada para reler o mesmo número.
        cadenciaMinutos: 15,
        chamadasDiaMax: 2000,
      })
      .returning();
    contasSolis.push(conta.id);
  }

  const resultado: Resultado = {
    usinasNovas: 0,
    equipamentosNovos: 0,
    leituras: 0,
    alertas: 0,
    usinas: 0,
  };

  const respUsinas = await cliente.listarUsinas();
  const usinas = (respUsinas.data?.page?.records ?? []) as UsinaSolis[];
  const contadores = respUsinas.data?.stationStatusVo;
  resultado.usinas = usinas.length;

  console.log(
    `  ${usinas.length} usinas` +
      (contadores
        ? ` (${contadores.normal ?? 0} normais, ${contadores.fault ?? 0} em falha, ` +
          `${contadores.offline ?? 0} offline)`
        : ""),
  );

  const usinaPorId = new Map<string, string>();

  for (const u of usinas) {
    const nome = u.stationName?.trim() || `Usina ${u.id}`;
    const potenciaKwp = converter(
      u.capacity,
      u.capacityStr,
      { kwp: 1, wp: 0.001, mwp: 1000 },
      1,
    );

    /**
     * Procura o vínculo em **todas** as contas Solis da empresa, não só na
     * atual. Uma usina que mude de conta no portal continuaria sendo a mesma
     * usina aqui — sem isso, ela viraria um cliente duplicado no dia em que
     * alguém reorganizasse as contas lá.
     */
    const vinculo = contasSolis.length
      ? await db.query.vinculoPortal.findFirst({
          where: and(
            inArray(schema.vinculoPortal.contaPortalId, contasSolis),
            eq(schema.vinculoPortal.idExterno, u.id),
          ),
        })
      : undefined;

    if (vinculo) {
      usinaPorId.set(u.id, vinculo.usinaId);
      await db
        .update(schema.usina)
        .set({
          nome,
          ...(potenciaKwp !== undefined ? { potenciaKwp: String(potenciaKwp) } : {}),
        })
        .where(eq(schema.usina.id, vinculo.usinaId));
      continue;
    }

    // O portal não separa cliente de usina: o nome da estação é tudo o que há.
    let clienteDb = await db.query.cliente.findFirst({
      where: and(
        eq(schema.cliente.empresaId, empresaId),
        eq(schema.cliente.nome, nome),
      ),
    });
    if (!clienteDb) {
      [clienteDb] = await db
        .insert(schema.cliente)
        .values({ empresaId, nome })
        .returning();
    }

    const [usina] = await db
      .insert(schema.usina)
      .values({
        empresaId,
        clienteId: clienteDb.id,
        nome,
        potenciaKwp: potenciaKwp !== undefined ? String(potenciaKwp) : null,
        // Endereço vem de quem cadastrou a usina no portal e costuma vir
        // torto — aqui é só ponto de partida, a ficha de cadastro corrige.
        cidade: u.cityStr?.trim() || null,
        status: "gerando",
      })
      .returning();

    await db.insert(schema.vinculoPortal).values({
      empresaId,
      usinaId: usina.id,
      contaPortalId: conta.id,
      idExterno: u.id,
      nomeExterno: nome,
    });

    usinaPorId.set(u.id, usina.id);
    resultado.usinasNovas++;
  }

  const respInv = await cliente.listarInversores();
  const inversores = (respInv.data?.page?.records ?? []) as InversorSolis[];
  const equipamentoPorSn = new Map<string, string>();

  for (const inv of inversores) {
    const usinaId = inv.stationId ? usinaPorId.get(inv.stationId) : undefined;
    const sn = inv.sn?.trim();
    if (!usinaId || !sn) continue;

    let equipamento = await db.query.equipamento.findFirst({
      where: and(
        eq(schema.equipamento.empresaId, empresaId),
        eq(schema.equipamento.numeroSerie, sn),
      ),
    });

    if (!equipamento) {
      // `machine` traz o modelo de verdade (S5-GR1P10K); `model` é um código
      // interno de quatro dígitos que não diz nada a ninguém.
      const modelo =
        (inv as { machine?: string }).machine?.trim() ||
        inv.productModel ||
        inv.model;
      [equipamento] = await db
        .insert(schema.equipamento)
        .values({
          empresaId,
          usinaId,
          tipo: "inversor",
          fabricante: "Solis",
          modelo,
          numeroSerie: sn,
          // `power` é a potência nominal do inversor, em kW.
          potenciaW: (() => {
            const w = watts(
              (inv as { power?: number }).power,
              (inv as { powerStr?: string }).powerStr,
            );
            return w !== undefined ? String(w) : null;
          })(),
        })
        .returning();
      resultado.equipamentosNovos++;
    }

    equipamentoPorSn.set(sn, equipamento.id);

    // O datalogger é o que mais cai em campo, e é ele que explica a usina
    // "sumir" sem o inversor ter nada.
    const coletorSn = inv.collectorSn?.trim();
    if (coletorSn && coletorSn !== sn) {
      const jaTem = await db.query.equipamento.findFirst({
        where: and(
          eq(schema.equipamento.empresaId, empresaId),
          eq(schema.equipamento.numeroSerie, coletorSn),
        ),
      });
      if (!jaTem) {
        await db.insert(schema.equipamento).values({
          empresaId,
          usinaId,
          tipo: "datalogger",
          fabricante: "Solis",
          numeroSerie: coletorSn,
        });
        resultado.equipamentosNovos++;
      }
    }
  }

  const dia = hoje();

  for (const inv of inversores) {
    const sn = inv.sn?.trim();
    const equipamentoId = sn ? equipamentoPorSn.get(sn) : undefined;
    const usinaId = inv.stationId ? usinaPorId.get(inv.stationId) : undefined;
    if (!equipamentoId || !usinaId) continue;

    const energiaDia = kwh(inv.etoday, (inv as { etodayStr?: string }).etodayStr);
    if (energiaDia === undefined) continue;

    const potencia = watts(inv.pac, inv.pacStr);

    await db
      .insert(schema.leitura)
      .values({
        empresaId,
        usinaId,
        equipamentoId,
        medidoEm: dia,
        granularidade: "dia",
        energiaKwh: String(energiaDia),
        potenciaW: potencia !== undefined ? String(potencia) : null,
      })
      // A geração do dia só cresce até o sol se pôr: a última leitura vale.
      .onConflictDoUpdate({
        target: [
          schema.leitura.equipamentoId,
          schema.leitura.medidoEm,
          schema.leitura.granularidade,
        ],
        set: {
          energiaKwh: String(energiaDia),
          potenciaW: potencia !== undefined ? String(potencia) : null,
          coletadoEm: new Date(),
        },
      });
    resultado.leituras++;
    console.log(`    ${sn}: ${energiaDia.toFixed(1)} kWh hoje`);
  }

  /**
   * Alerta a partir do que o próprio portal informa.
   *
   * Como na FoxESS, não é preciso deduzir falha da curva: o SolisCloud diz o
   * estado do inversor e conta os alarmes da usina. Quando a fonte já sabe,
   * perguntar é melhor que adivinhar.
   */
  const agora = new Date();

  for (const inv of inversores) {
    const usinaId = inv.stationId ? usinaPorId.get(inv.stationId) : undefined;
    if (!usinaId || inv.state === undefined || inv.state === 1) continue;

    const gravado = await db
      .insert(schema.alerta)
      .values({
        empresaId,
        usinaId,
        tipo: inv.state === 2 ? "sem_comunicacao" : "alarme_inversor",
        severidade: "critico",
        mensagem:
          `Inversor ${inv.sn ?? inv.id} está ` +
          `${ESTADO_ROTULO[inv.state] ?? `com estado ${inv.state}`}, ` +
          "segundo o portal da Solis",
        codigoFabricante: `solis-estado-${inv.state}`,
        abertoEm: agora,
      })
      .onConflictDoNothing()
      .returning({ id: schema.alerta.id });
    if (gravado.length) resultado.alertas++;
  }

  for (const u of usinas as (UsinaSolis & {
    alarmCount?: number;
    alarmMsg?: string;
  })[]) {
    const usinaId = usinaPorId.get(u.id);
    if (!usinaId || !u.alarmCount) continue;

    const gravado = await db
      .insert(schema.alerta)
      .values({
        empresaId,
        usinaId,
        tipo: "alarme_inversor",
        severidade: "atencao",
        mensagem:
          `${u.alarmCount} alarme(s) abertos na usina, segundo o portal da Solis` +
          (u.alarmMsg ? `: ${u.alarmMsg}` : ""),
        codigoFabricante: "solis-alarme-usina",
        abertoEm: agora,
      })
      .onConflictDoNothing()
      .returning({ id: schema.alerta.id });
    if (gravado.length) resultado.alertas++;
  }

  await db
    .update(schema.contaPortal)
    .set({ ultimaColetaEm: new Date(), ultimoErro: null })
    .where(eq(schema.contaPortal.id, conta.id));

  return resultado;
}

async function main() {
  const contas = credenciais();
  if (contas.length === 0) {
    console.error(
      "Faltam SOLIS_KEY_ID e SOLIS_KEY_SECRET no .env.\n" +
        "Para mais de uma conta, numere a partir da segunda:\n" +
        "  SOLIS_KEY_ID_2 / SOLIS_KEY_SECRET_2",
    );
    process.exit(1);
  }

  const empresa = await db.query.empresa.findFirst();
  if (!empresa) {
    console.error("Nenhuma empresa no banco. Rode `npm run db:seed` primeiro.");
    process.exit(1);
  }

  const existentes = await db.query.contaPortal.findMany({
    where: and(
      eq(schema.contaPortal.empresaId, empresa.id),
      eq(schema.contaPortal.fabricante, "solis"),
    ),
  });
  const contasSolis = existentes.map((c) => c.id);

  console.log(
    `${contas.length} ${contas.length === 1 ? "conta" : "contas"} no .env.\n`,
  );

  const total: Resultado = {
    usinasNovas: 0,
    equipamentosNovos: 0,
    leituras: 0,
    alertas: 0,
    usinas: 0,
  };
  const falhas: string[] = [];

  for (const credencial of contas) {
    console.log(`${credencial.apelido}:`);
    try {
      const r = await coletarConta(credencial, empresa.id, contasSolis);
      total.usinasNovas += r.usinasNovas;
      total.equipamentosNovos += r.equipamentosNovos;
      total.leituras += r.leituras;
      total.alertas += r.alertas;
      total.usinas += r.usinas;
    } catch (erro) {
      // Uma conta fora do ar não pode impedir a outra de ser coletada.
      const mensagem = erro instanceof Error ? erro.message : String(erro);
      console.log(`  falhou: ${mensagem}`);
      falhas.push(`${credencial.apelido}: ${mensagem}`);
      await db
        .update(schema.contaPortal)
        .set({ ultimoErro: mensagem.slice(0, 500) })
        .where(
          and(
            eq(schema.contaPortal.empresaId, empresa.id),
            eq(schema.contaPortal.apelido, credencial.apelido),
          ),
        );
    }
  }

  console.log(
    `\nTotal: ${total.usinas} usinas · ${total.usinasNovas} novas · ` +
      `${total.equipamentosNovos} equipamentos novos · ${total.leituras} leituras · ` +
      `${total.alertas} alertas novos`,
  );

  if (falhas.length) {
    console.log(`\n${falhas.length} conta(s) falharam:`);
    for (const f of falhas) console.log(`  ${f}`);
    process.exit(1);
  }
  process.exit(0);
}

main().catch((erro) => {
  console.error("Falhou:", erro instanceof Error ? erro.message : erro);
  process.exit(1);
});
