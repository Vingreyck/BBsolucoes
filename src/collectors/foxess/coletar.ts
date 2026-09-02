import "dotenv/config";

import { and, eq } from "drizzle-orm";

import { db, schema } from "../../db";
import { FoxEssClient } from "./client";

/**
 * Coletor da FoxESS: vai ao portal, lê o que há e grava no banco.
 *
 * Diferente da Growatt, aqui não há planilha no meio — a API entrega tudo, e
 * este programa roda sozinho. É a diferença entre alguém conseguir abrir o
 * portal e olhar, e o sistema saber sem ninguém olhar.
 *
 * Idempotente do começo ao fim: rodar dez vezes seguidas deixa o banco igual a
 * rodar uma. Isso importa porque ele vai rodar todo dia, e porque erro de rede
 * no meio do caminho precisa poder ser resolvido rodando de novo.
 *
 *   npm run coletar:foxess
 */

interface UsinaFox {
  stationID: string;
  name?: string;
  ianaTimezone?: string;
}

interface DispositivoFox {
  deviceSN: string;
  moduleSN?: string;
  deviceType?: string;
  productType?: string;
  stationID?: string;
  stationName?: string;
  hasBattery?: boolean;
  hasPV?: boolean;
  /** 1 online, 2 em falha, 3 offline. */
  status?: number;
}

const STATUS_ROTULO: Record<number, string> = {
  1: "online",
  2: "em falha",
  3: "offline",
};

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

async function main() {
  const chave = process.env.FOXESS_API_KEY;
  if (!chave) {
    console.error("Falta FOXESS_API_KEY no .env.");
    process.exit(1);
  }

  const empresa = await db.query.empresa.findFirst();
  if (!empresa) {
    console.error("Nenhuma empresa no banco. Rode `npm run db:seed` primeiro.");
    process.exit(1);
  }

  const cliente = new FoxEssClient(chave);

  // Uma conta de portal por fabricante, reaproveitada entre execuções.
  let conta = await db.query.contaPortal.findFirst({
    where: and(
      eq(schema.contaPortal.empresaId, empresa.id),
      eq(schema.contaPortal.fabricante, "foxess"),
    ),
  });
  if (!conta) {
    [conta] = await db
      .insert(schema.contaPortal)
      .values({
        empresaId: empresa.id,
        fabricante: "foxess",
        apelido: "FoxESS Cloud",
        // A FoxESS permite 1.440 chamadas por dia por dispositivo: cabe de sobra.
        cadenciaMinutos: 15,
        chamadasDiaMax: 1440,
      })
      .returning();
  }

  console.log("Lendo usinas...");
  const respUsinas = await cliente.listarUsinas(1, 100);
  const usinasFox = ((respUsinas.result as { data?: UsinaFox[] })?.data ??
    []) as UsinaFox[];
  console.log(`  ${usinasFox.length} usinas no portal`);

  const usinaPorStation = new Map<string, string>();
  let usinasNovas = 0;

  for (const u of usinasFox) {
    const nome = u.name?.trim() || `Usina ${u.stationID}`;

    const vinculo = await db.query.vinculoPortal.findFirst({
      where: and(
        eq(schema.vinculoPortal.contaPortalId, conta.id),
        eq(schema.vinculoPortal.idExterno, u.stationID),
      ),
    });

    if (vinculo) {
      usinaPorStation.set(u.stationID, vinculo.usinaId);
      await db
        .update(schema.usina)
        .set({ nome })
        .where(eq(schema.usina.id, vinculo.usinaId));
      continue;
    }

    // Cliente pelo nome da usina. A FoxESS não expõe dado do dono, então o
    // nome da estação é tudo o que há — a ficha de cadastro corrige depois.
    let clienteDb = await db.query.cliente.findFirst({
      where: and(
        eq(schema.cliente.empresaId, empresa.id),
        eq(schema.cliente.nome, nome),
      ),
    });
    if (!clienteDb) {
      [clienteDb] = await db
        .insert(schema.cliente)
        .values({ empresaId: empresa.id, nome })
        .returning();
    }

    const [usina] = await db
      .insert(schema.usina)
      .values({
        empresaId: empresa.id,
        clienteId: clienteDb.id,
        nome,
        status: "gerando",
      })
      .returning();

    await db.insert(schema.vinculoPortal).values({
      empresaId: empresa.id,
      usinaId: usina.id,
      contaPortalId: conta.id,
      idExterno: u.stationID,
      nomeExterno: nome,
    });

    usinaPorStation.set(u.stationID, usina.id);
    usinasNovas++;
  }

  console.log("Lendo dispositivos...");
  const respDisp = await cliente.listarDispositivos(1, 100);
  const dispositivos = ((respDisp.result as { data?: DispositivoFox[] })?.data ??
    []) as DispositivoFox[];
  console.log(`  ${dispositivos.length} dispositivos`);

  let equipamentosNovos = 0;
  const seriePorUsina = new Map<string, string[]>();

  for (const d of dispositivos) {
    const usinaId = d.stationID ? usinaPorStation.get(d.stationID) : undefined;
    if (!usinaId || !d.deviceSN) continue;

    const lista = seriePorUsina.get(usinaId) ?? [];
    lista.push(d.deviceSN);
    seriePorUsina.set(usinaId, lista);

    const jaTem = await db.query.equipamento.findFirst({
      where: eq(schema.equipamento.numeroSerie, d.deviceSN),
    });
    if (!jaTem) {
      await db.insert(schema.equipamento).values({
        empresaId: empresa.id,
        usinaId,
        // Q1-2400-E e afins são microinversores; o campo hasPV confirma solar.
        tipo: /micro|^q\d/i.test(d.deviceType ?? "") ? "microinversor" : "inversor",
        fabricante: "FoxESS",
        modelo: d.deviceType ?? d.productType,
        numeroSerie: d.deviceSN,
      });
      equipamentosNovos++;
    }

    // O datalogger vem como moduleSN e é o que mais falha em campo.
    if (d.moduleSN && d.moduleSN !== d.deviceSN) {
      const temModulo = await db.query.equipamento.findFirst({
        where: eq(schema.equipamento.numeroSerie, d.moduleSN),
      });
      if (!temModulo) {
        await db.insert(schema.equipamento).values({
          empresaId: empresa.id,
          usinaId,
          tipo: "datalogger",
          fabricante: "FoxESS",
          numeroSerie: d.moduleSN,
        });
        equipamentosNovos++;
      }
    }
  }

  /**
   * Alerta a partir do status que a própria FoxESS informa.
   *
   * Aqui não é preciso deduzir a falha da curva de geração, como na Growatt: o
   * portal diz se o equipamento está online, em falha ou offline. Quando a
   * fonte já sabe, perguntar é melhor que adivinhar.
   */
  let alertasNovos = 0;
  const agora = new Date();
  for (const d of dispositivos) {
    const usinaId = d.stationID ? usinaPorStation.get(d.stationID) : undefined;
    if (!usinaId || d.status === undefined || d.status === 1) continue;

    const resultado = await db
      .insert(schema.alerta)
      .values({
        empresaId: empresa.id,
        usinaId,
        tipo: d.status === 3 ? "sem_comunicacao" : "alarme_inversor",
        severidade: "critico",
        mensagem: `Inversor ${d.deviceSN} está ${STATUS_ROTULO[d.status] ?? `com status ${d.status}`}, segundo o portal da FoxESS`,
        codigoFabricante: `foxess-status-${d.status}`,
        abertoEm: agora,
      })
      .onConflictDoNothing()
      .returning({ id: schema.alerta.id });
    if (resultado.length) alertasNovos++;
  }

  console.log("Lendo geração...");
  let leiturasGravadas = 0;
  const dia = hoje();

  for (const [usinaId, series] of seriePorUsina) {
    // Até 50 números de série por chamada; aqui sempre cabe numa só.
    const resposta = await cliente.dadosAgora(series);
    const porDispositivo = (resposta.result ?? []) as {
      deviceSN?: string;
      datas?: { variable?: string; value?: unknown }[];
    }[];

    let geracaoDaUsina = 0;

    for (const item of porDispositivo) {
      const valores = new Map(
        (item.datas ?? []).map((v) => [v.variable, numero(v.value)]),
      );
      const geracaoDia = valores.get("todayYield");
      const potencia = valores.get("pvPower");

      const equipamento = item.deviceSN
        ? await db.query.equipamento.findFirst({
            where: eq(schema.equipamento.numeroSerie, item.deviceSN),
          })
        : undefined;

      if (geracaoDia !== undefined) geracaoDaUsina += geracaoDia;

      if (equipamento && geracaoDia !== undefined) {
        await db
          .insert(schema.leitura)
          .values({
            empresaId: empresa.id,
            usinaId,
            equipamentoId: equipamento.id,
            medidoEm: dia,
            granularidade: "dia",
            energiaKwh: String(geracaoDia),
            potenciaW: potencia !== undefined ? String(potencia * 1000) : null,
          })
          // Rodar de novo no mesmo dia atualiza: a geração do dia só cresce até
          // o sol se pôr, e a última leitura é a que vale.
          .onConflictDoUpdate({
            target: [
              schema.leitura.equipamentoId,
              schema.leitura.medidoEm,
              schema.leitura.granularidade,
            ],
            set: {
              energiaKwh: String(geracaoDia),
              potenciaW: potencia !== undefined ? String(potencia * 1000) : null,
              coletadoEm: new Date(),
            },
          });
        leiturasGravadas++;
      }
    }

    console.log(`  usina com ${series.length} inversores: ${geracaoDaUsina.toFixed(1)} kWh hoje`);
  }

  await db
    .update(schema.contaPortal)
    .set({ ultimaColetaEm: new Date(), ultimoErro: null })
    .where(eq(schema.contaPortal.id, conta.id));

  console.log(
    `\nUsinas novas: ${usinasNovas} · Equipamentos novos: ${equipamentosNovos} · ` +
      `Leituras: ${leiturasGravadas} · Alertas novos: ${alertasNovos}`,
  );
  process.exit(0);
}

main().catch(async (erro) => {
  const mensagem = erro instanceof Error ? erro.message : String(erro);
  // Registra a falha na conta para a tela poder mostrar que a coleta parou.
  const conta = await db.query.contaPortal.findFirst({
    where: eq(schema.contaPortal.fabricante, "foxess"),
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
