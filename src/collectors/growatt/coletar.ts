import "dotenv/config";

import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";

import { db, schema } from "../../db";
import {
  ehErroDeFrequencia,
  GrowattOpenApi,
  type DispositivoV1,
  type UsinaV1,
} from "./openapi";

/**
 * Coletor da Growatt pela OpenAPI — 143 usinas, 86% do parque da BB.
 *
 * Substitui a entrada por planilha (`npm run import:geracao`), que dependia de
 * alguém lembrar de exportar o OSS. Mesmo formato dos outros quatro coletores:
 * idempotente, roda sozinho, repetir não duplica.
 *
 * O cuidado próprio daqui é **frequência**. A Growatt devolve `10012` quando
 * acha que você chamou demais, e a punição não para no erro: outros
 * integradores relatam IP bloqueado por dias. Com 143 usinas, uma chamada por
 * usina a cada hora daria 3.400 chamadas por dia, e isso é pedir para ser
 * bloqueado.
 *
 * Então a coleta é em duas passadas:
 *
 * 1. **Cadastro**, toda rodada: `/v1/plant/list` paginado, duas chamadas para
 *    as 143 usinas. Traz nome, cidade, potência instantânea e acumulado.
 *
 * 2. **Geração, em lotes**: `/v1/plant/energy` numa usina por vez, no máximo
 *    `LOTE_PADRAO` por rodada, começando pelas mais desatualizadas. Cada
 *    chamada traz **sete dias**, então além de atualizar hoje ela tapa buraco
 *    de dia em que o coletor não rodou. Rodando de hora em hora, cada usina é
 *    revisitada a cada três ou quatro horas, com menos de mil chamadas no dia.
 *
 * Ao primeiro `10012` a passada para na hora e sai limpo. As usinas que ficaram
 * de fora entram na próxima rodada, porque a fila é ordenada por quem está mais
 * velho — insistir é o que bloqueia o IP, e não há pressa que justifique.
 *
 *   npm run coletar:growatt
 *   npm run coletar:growatt -- --lote 20    (mais devagar)
 *   npm run coletar:growatt -- --forcar     (ignora a cadência)
 */

/** Usinas cuja geração é atualizada por rodada. */
const LOTE_PADRAO = 40;

/**
 * `peak_power` **não** serve como potência instalada.
 *
 * O campo vem preenchido à mão, e cada instalador usou uma unidade: em 99
 * usinas conferidas, 56 traziam kWp e 37 traziam MW, com 6 que não fecham em
 * hipótese nenhuma. O teste foi físico — dividir o acumulado pela potência e
 * pelos anos desde o cadastro, e ver qual leitura cai na faixa de Sergipe, que
 * é 1.300 a 1.800 kWh/kWp/ano. A leitura errada erra por exatamente mil, igual
 * ao `capacity` da Huawei.
 *
 * Como não há regra confiável para separar os dois casos, a potência **não é
 * gravada daqui**. Ela vem dos modelos de inversor da exportação do OSS
 * (`npm run import:dispositivos`), onde `MIN 5000TL-X` diz 5 kW sem ambiguidade.
 */
const POTENCIA_NAO_CONFIAVEL = true;

/** `lost`: 0 online, 1 sem comunicação. `status` do inversor: 3 é falha. */
const DISPOSITIVO_PERDIDO = 1;
const INVERSOR_EM_FALHA = 3;

function numero(v: unknown): number | undefined {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Nome comparável: minúsculo, sem acento, sem pontuação, espaços colapsados.
 *
 * Serve para uma coisa só, e ela é delicada: as 136 usinas que entraram por
 * planilha foram vinculadas **pelo nome**, porque a exportação do OSS não trazia
 * o id. A API traz `plant_id` numérico. Sem casar os dois, este coletor criaria
 * 143 usinas novas ao lado das 136 que já existem, com os mesmos clientes.
 *
 * Conferido antes de escrever: das 100 usinas da primeira página, 98 têm nome
 * e todas as 98 casam exatamente com um vínculo do banco depois de normalizar.
 */
function normalizar(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Meio-dia UTC do dia informado — o instante que representa o dia na tabela. */
function instanteDoDia(iso: string): Date | null {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], 12, 0, 0));
}

/** Data de hoje em Sergipe, no formato que a Growatt espera. */
function hojeLocal(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function diasAtras(n: number): string {
  const d = new Date(Date.now() - n * 86_400_000);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

async function main() {
  const token = process.env.GROWATT_API_TOKEN;
  if (!token) {
    console.error(
      "Falta GROWATT_API_TOKEN no .env.\n\n" +
        "O token sai no OSS: System Setting → System Management →\n" +
        "API management → Add API Request.",
    );
    process.exit(1);
  }

  const empresa = await db.query.empresa.findFirst();
  if (!empresa) {
    console.error("Nenhuma empresa no banco. Rode `npm run db:seed` primeiro.");
    process.exit(1);
  }

  const argLote = process.argv.indexOf("--lote");
  const lote =
    argLote >= 0 ? Math.max(1, Number(process.argv[argLote + 1]) || LOTE_PADRAO) : LOTE_PADRAO;
  const forcar = process.argv.includes("--forcar");
  const simular = process.argv.includes("--simular");

  let conta = await db.query.contaPortal.findFirst({
    where: and(
      eq(schema.contaPortal.empresaId, empresa.id),
      eq(schema.contaPortal.fabricante, "growatt"),
    ),
  });
  if (!conta) {
    [conta] = await db
      .insert(schema.contaPortal)
      .values({
        empresaId: empresa.id,
        fabricante: "growatt",
        apelido: "Growatt OpenAPI (EDPGV8)",
        cadenciaMinutos: 60,
        chamadasDiaMax: 1200,
      })
      .returning();
  }

  if (!forcar && conta.ultimaColetaEm) {
    const minutos = Math.floor((Date.now() - conta.ultimaColetaEm.getTime()) / 60_000);
    const cadencia = conta.cadenciaMinutos ?? 60;
    if (minutos < cadencia) {
      console.log(
        `Coletado há ${minutos} min, e a cadência é de ${cadencia} min.\n` +
          "Nada a fazer — a Growatt bloqueia IP por frequência.\n" +
          "Para forçar: npm run coletar:growatt -- --forcar",
      );
      process.exit(0);
    }
  }

  const api = new GrowattOpenApi(token);

  // ---------------------------------------------------------------- cadastro
  console.log("Lendo usinas...");
  const usinas: UsinaV1[] = [];
  try {
    for (let pagina = 1; pagina <= 20; pagina++) {
      const resposta = await api.listarUsinas(pagina, 100);
      const pedaco = resposta.data?.plants ?? [];
      usinas.push(...pedaco);
      const total = resposta.data?.count ?? pedaco.length;
      if (usinas.length >= total || pedaco.length === 0) break;
    }
  } catch (erro) {
    const mensagem = erro instanceof Error ? erro.message : String(erro);
    /**
     * `10012` já na listagem não é falha: é a Growatt dizendo que alguém
     * chamou há menos de cinco minutos — o probe, outra rodada, qualquer
     * coisa. Sair com erro aqui encheria `conta_portal.ultimoErro` de alarme
     * falso e faria `npm run atualizar` parecer quebrado todo dia.
     */
    if (ehErroDeFrequencia(mensagem)) {
      console.log(
        "A Growatt pediu calma (10012) logo na listagem. Alguma chamada foi\n" +
          "feita há menos de cinco minutos — pode ter sido o probe ou outra\n" +
          "rodada. Nada foi coletado; tente de novo daqui a pouco.",
      );
      process.exit(0);
    }
    throw erro;
  }
  console.log(`  ${usinas.length} usinas`);

  /**
   * Os vínculos que já existem, indexados das duas formas.
   *
   * `porIdExterno` pega quem já foi migrado para o `plant_id` numérico;
   * `porNome` pega as 136 da planilha, que foram vinculadas pelo nome.
   */
  const existentes = await db.query.vinculoPortal.findMany({
    where: eq(schema.vinculoPortal.contaPortalId, conta.id),
  });
  const porIdExterno = new Map(existentes.map((v) => [v.idExterno, v]));
  const porNome = new Map<string, (typeof existentes)[number]>();
  for (const v of existentes) {
    for (const candidato of [v.nomeExterno, v.idExterno]) {
      const chave = candidato ? normalizar(candidato) : "";
      if (chave && !porNome.has(chave)) porNome.set(chave, v);
    }
  }

  const usinaPorId = new Map<string, string>();
  /** Vínculos já reivindicados nesta rodada, para o segundo homônimo não roubar. */
  const consumidos = new Set<string>();
  const homonimas: string[] = [];
  let novas = 0;
  let migradas = 0;

  for (const u of usinas) {
    const idExterno = String(u.plant_id);
    const nome = u.name?.trim() || `Usina ${idExterno}`;
    const cidade = u.city?.trim() || null;

    /**
     * Cada vínculo só pode ser reivindicado por **uma** usina da API.
     *
     * A simulação pegou 137 migrações para 136 vínculos: duas usinas diferentes
     * casando pelo mesmo nome. Sem esta trava, a segunda sobrescreveria o
     * `idExterno` da primeira e as duas passariam a apontar para a mesma usina
     * do banco — as leituras de uma sobrescrevendo as da outra, em silêncio.
     *
     * Quem chega depois vira usina nova. Juntar duas depois é fácil; separar
     * leitura misturada não é.
     */
    const chaveNome = normalizar(nome);
    const porId = porIdExterno.get(idExterno);
    let porNomeDela: (typeof existentes)[number] | null = null;

    if (!porId) {
      const candidato = porNome.get(chaveNome);
      if (candidato && consumidos.has(candidato.id)) {
        homonimas.push(`${nome} (${idExterno})`);
      } else if (candidato) {
        porNomeDela = candidato;
        consumidos.add(candidato.id);
      }
    }

    const vinculo = porId ?? porNomeDela ?? null;

    if (vinculo) {
      usinaPorId.set(idExterno, vinculo.usinaId);

      /**
       * Troca o nome pelo `plant_id` na primeira vez que encontra a usina.
       *
       * Nome não é identidade: basta alguém renomear a usina no portal para o
       * vínculo se perder e uma duplicata nascer na rodada seguinte. O id
       * numérico não muda. É a mesma correção que a importação do Drive
       * precisou, pelo mesmo motivo.
       */
      if (vinculo.idExterno !== idExterno) {
        if (!simular) {
          await db
            .update(schema.vinculoPortal)
            .set({ idExterno, nomeExterno: nome })
            .where(eq(schema.vinculoPortal.id, vinculo.id));
        }
        migradas++;
      }

      if (!simular) {
        await db
          .update(schema.usina)
          .set({ nome, ...(cidade ? { cidade } : {}) })
          .where(eq(schema.usina.id, vinculo.usinaId));
      }
      continue;
    }

    novas++;
    if (simular) {
      console.log(`  criaria usina nova: ${nome} (${idExterno})`);
      continue;
    }

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
        // Ver POTENCIA_NAO_CONFIAVEL: `peak_power` mistura kWp e MW.
        potenciaKwp: POTENCIA_NAO_CONFIAVEL ? null : String(u.peak_power ?? 0),
        cidade,
        latitude: u.latitude ? String(u.latitude) : null,
        longitude: u.longitude ? String(u.longitude) : null,
        dataInstalacao: u.create_date ? new Date(u.create_date) : null,
        status: "gerando",
      })
      .returning();

    await db.insert(schema.vinculoPortal).values({
      empresaId: empresa.id,
      usinaId: usina.id,
      contaPortalId: conta.id,
      idExterno,
      nomeExterno: nome,
    });

    usinaPorId.set(idExterno, usina.id);
  }

  if (migradas) {
    console.log(
      `  ${migradas} vínculos migrados do nome para o plant_id` +
        (simular ? " (seriam)" : ""),
    );
  }

  /**
   * Vínculos que a API não devolveu.
   *
   * Uma usina que está no banco e sumiu da listagem é sempre uma das três: foi
   * renomeada no portal, foi movida para outra conta, ou é duplicata velha da
   * planilha. Nenhuma delas o coletor deve resolver sozinho — apagar seria
   * perder histórico, e adivinhar o novo nome seria juntar o que talvez não
   * seja a mesma usina. Então só avisa.
   */
  const orfaos = existentes.filter(
    (v) => !consumidos.has(v.id) && !usinaPorId.has(v.idExterno),
  );
  if (orfaos.length) {
    console.log(
      `\n${orfaos.length} usinas do banco não apareceram na API. Podem ter sido\n` +
        "renomeadas no portal, movidas de conta, ou ser duplicata da planilha:",
    );
    for (const v of orfaos.slice(0, 10)) {
      console.log(`  ${v.nomeExterno ?? v.idExterno}`);
    }
    if (orfaos.length > 10) console.log(`  ... e mais ${orfaos.length - 10}`);
  }

  if (homonimas.length) {
    console.log(
      `\n${homonimas.length} usinas da API têm o mesmo nome de outra que já foi\n` +
        "casada, então viram usina nova em vez de roubar o vínculo:",
    );
    for (const h of homonimas) console.log(`  ${h}`);
    console.log("Vale conferir no portal se são mesmo duas, ou a mesma repetida.");
  }

  if (simular) {
    console.log(
      `\nSIMULAÇÃO: ${usinas.length} usinas na API, ${migradas} vínculos a migrar, ` +
        `${novas} usinas a criar.\nNada foi gravado.`,
    );
    process.exit(0);
  }

  // ------------------------------------------------------- fila da geração
  /**
   * Quem está mais desatualizado vai primeiro.
   *
   * A fila é ordenada pela leitura mais recente de cada usina: quem nunca teve
   * leitura encabeça, depois quem tem a mais velha. Com isso a rotação se
   * equilibra sozinha e, se uma rodada for cortada no meio por `10012`, a
   * seguinte continua de onde parou sem guardar estado nenhum.
   */
  const ids = [...usinaPorId.values()];
  const recencia = ids.length
    ? await db
        .select({
          usinaId: schema.leitura.usinaId,
          ultima: sql<string>`max(${schema.leitura.coletadoEm})`.as("ultima"),
        })
        .from(schema.leitura)
        .where(
          and(
            inArray(schema.leitura.usinaId, ids),
            eq(schema.leitura.granularidade, "dia"),
            isNull(schema.leitura.equipamentoId),
          ),
        )
        .groupBy(schema.leitura.usinaId)
    : [];
  const ultimaPorUsina = new Map(recencia.map((r) => [r.usinaId, r.ultima]));

  const fila = [...usinaPorId.entries()].sort(([, a], [, b]) => {
    const ua = ultimaPorUsina.get(a) ?? "";
    const ub = ultimaPorUsina.get(b) ?? "";
    return ua < ub ? -1 : ua > ub ? 1 : 0;
  });

  const inicio = diasAtras(6);
  const fim = hojeLocal();

  console.log(`Lendo geração de ${Math.min(lote, fila.length)} usinas...`);

  let leituras = 0;
  let equipamentosNovos = 0;
  let alertas = 0;
  let visitadas = 0;
  let cortadoPorFrequencia = false;

  for (const [idExterno, usinaId] of fila.slice(0, lote)) {
    try {
      const resposta = await api.energia(idExterno, inicio, fim, "day");
      for (const ponto of resposta.data?.energys ?? []) {
        const kwh = numero(ponto.energy);
        const dia = ponto.date ? instanteDoDia(ponto.date) : null;
        if (kwh === undefined || kwh < 0 || !dia) continue;

        await db
          .insert(schema.leitura)
          .values({
            empresaId: empresa.id,
            usinaId,
            medidoEm: dia,
            granularidade: "dia",
            energiaKwh: String(kwh),
          })
          /**
           * A Growatt entrega geração por usina, não por inversor — a leitura
           * vai sem `equipamento_id`, e o índice que a protege é o parcial
           * `leitura_usina_instante_uq`. Sem o `targetWhere` o Postgres não
           * sabe qual índice usar e a inserção quebra em vez de atualizar.
           */
          .onConflictDoUpdate({
            target: [
              schema.leitura.usinaId,
              schema.leitura.medidoEm,
              schema.leitura.granularidade,
            ],
            targetWhere: isNull(schema.leitura.equipamentoId),
            set: { energiaKwh: String(kwh), coletadoEm: new Date() },
          });
        leituras++;
      }
      visitadas++;

      /**
       * Dispositivos só de quem ainda não tem nenhum cadastrado.
       *
       * Inversor não aparece e some: depois que a usina tem equipamento, essa
       * chamada não se repete. É o que mantém a conta de chamadas caindo com o
       * tempo em vez de crescer com o parque.
       */
      const jaTemEquipamento = await db.query.equipamento.findFirst({
        where: eq(schema.equipamento.usinaId, usinaId),
        columns: { id: true },
      });
      if (jaTemEquipamento) continue;

      const respDisp = await api.listarDispositivos(idExterno);
      for (const d of (respDisp.data?.devices ?? []) as DispositivoV1[]) {
        const serie = d.device_sn?.trim() || d.device_id?.trim();
        if (!serie) continue;

        const conflito = await db.query.equipamento.findFirst({
          where: and(
            eq(schema.equipamento.empresaId, empresa.id),
            eq(schema.equipamento.numeroSerie, serie),
          ),
          columns: { id: true },
        });
        if (!conflito) {
          await db.insert(schema.equipamento).values({
            empresaId: empresa.id,
            usinaId,
            tipo: /neo|micro/i.test(d.model ?? "") ? "microinversor" : "inversor",
            fabricante: "Growatt",
            modelo: d.model ?? null,
            numeroSerie: serie,
          });
          equipamentosNovos++;
        }

        if (d.lost === DISPOSITIVO_PERDIDO || d.status === INVERSOR_EM_FALHA) {
          const gravado = await db
            .insert(schema.alerta)
            .values({
              empresaId: empresa.id,
              usinaId,
              tipo: d.status === INVERSOR_EM_FALHA ? "alarme_inversor" : "sem_comunicacao",
              severidade: "critico",
              mensagem:
                d.status === INVERSOR_EM_FALHA
                  ? `Inversor ${serie} em falha, segundo o portal da Growatt`
                  : `Inversor ${serie} sem comunicação, segundo o portal da Growatt`,
              codigoFabricante: `growatt-lost-${d.lost ?? "?"}-status-${d.status ?? "?"}`,
              abertoEm: d.last_update_time ? new Date(d.last_update_time) : new Date(),
            })
            .onConflictDoNothing()
            .returning({ id: schema.alerta.id });
          if (gravado.length) alertas++;
        }
      }
    } catch (erro) {
      const mensagem = erro instanceof Error ? erro.message : String(erro);
      /**
       * `10012` encerra a passada, e não é falha: é a Growatt pedindo calma.
       * O que sobrou vai para a próxima rodada porque a fila é ordenada por
       * quem está mais velho. Insistir aqui é o caminho para o IP bloqueado.
       */
      if (ehErroDeFrequencia(mensagem)) {
        cortadoPorFrequencia = true;
        break;
      }
      throw erro;
    }
  }

  await db
    .update(schema.contaPortal)
    .set({ ultimaColetaEm: new Date(), ultimoErro: null })
    .where(eq(schema.contaPortal.id, conta.id));

  console.log(
    `\nUsinas novas: ${novas} · Geração atualizada em ${visitadas} de ${fila.length} · ` +
      `Leituras: ${leituras} · Equipamentos novos: ${equipamentosNovos} · Alertas: ${alertas}`,
  );
  if (cortadoPorFrequencia) {
    console.log(
      "A Growatt pediu calma (10012) e a passada parou aí. O resto entra na\n" +
        "próxima rodada — a fila começa por quem está mais desatualizado.",
    );
  }
  if (fila.length > visitadas && !cortadoPorFrequencia) {
    console.log(
      `${fila.length - visitadas} usinas ficam para a próxima rodada, por lote.\n` +
        `Rodando de hora em hora, cada usina é revisitada a cada ${Math.ceil(fila.length / lote)} horas.`,
    );
  }
  process.exit(0);
}

main().catch(async (erro) => {
  const mensagem = erro instanceof Error ? erro.message : String(erro);
  const conta = await db.query.contaPortal.findFirst({
    where: eq(schema.contaPortal.fabricante, "growatt"),
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
