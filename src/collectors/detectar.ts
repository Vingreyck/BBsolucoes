import "dotenv/config";

import { and, eq, isNull, sql } from "drizzle-orm";

import { db, schema } from "../db";

/**
 * Detecta usina parada e usina rendendo abaixo do normal, a partir da série
 * diária de geração.
 *
 * Por que não usar o Fault Log da Growatt: ele registrou **um** evento em cinco
 * meses, enquanto o painel mostrava cinco usinas offline no mesmo instante. Ele
 * só enxerga falha que o inversor consegue reportar — se o datalogger cai,
 * ninguém reporta nada. A geração é o sinal honesto: usina que não gerou, parou.
 *
 * Por que não comparar com a potência instalada: 36 das 136 usinas estão com a
 * potência errada no cadastro do portal, por um fator de mil. Qualquer conta de
 * kWh por kWp herdaria esse erro.
 *
 * O método aqui não depende de nenhum dos dois:
 *
 *   1. Cada usina vira seu próprio padrão — a mediana da geração dos dias em que
 *      ela gerou. Não importa qual é a potência: importa o que ela costuma
 *      entregar.
 *   2. O clima do dia sai da mediana, entre todas as usinas, da razão entre o
 *      que cada uma gerou naquele dia e o seu próprio padrão. Num dia nublado
 *      esse fator cai para todo mundo junto.
 *   3. Só então se compara: usina que zerou num dia em que as vizinhas geraram
 *      normalmente está parada. Dia de chuva não gera alerta, porque o fator do
 *      dia cai para todas.
 *
 *   npm run detectar
 */

/** Abaixo disto o dia foi ruim para todo mundo e não dá para julgar ninguém. */
const FATOR_DIA_MINIMO = 0.35;

/** Fração do esperado abaixo da qual a usina conta como rendendo pouco. */
const LIMITE_BAIXA = 0.4;

/** Uma usina precisa de pelo menos isto de histórico para ter padrão confiável. */
const DIAS_MINIMOS = 7;

/**
 * Dias de carência após a instalação antes de começar a cobrar geração.
 *
 * Entre a data que consta como instalação e a usina de fato produzindo há
 * comissionamento, vistoria e troca de medidor. Julgar nesse intervalo gera
 * alarme falso justamente com o cliente mais recente — o pior momento possível
 * para telefonar dizendo que a usina dele não está gerando.
 */
const CARENCIA_DIAS = 5;

function mediana(valores: number[]): number {
  if (valores.length === 0) return 0;
  const ordenado = [...valores].sort((a, b) => a - b);
  const meio = Math.floor(ordenado.length / 2);
  return ordenado.length % 2
    ? ordenado[meio]
    : (ordenado[meio - 1] + ordenado[meio]) / 2;
}

async function main() {
  const empresa = await db.query.empresa.findFirst();
  if (!empresa) {
    console.error("Nenhuma empresa no banco. Rode `npm run db:seed` primeiro.");
    process.exit(1);
  }

  /**
   * `--reset` apaga os alertas gerados por regra antes de detectar de novo.
   *
   * Uma vez resolvido, o alerta não volta — que é o certo em operação, mas
   * atrapalha na hora de mostrar a tela para alguém. Isto é um parâmetro e não
   * um comando de shell de propósito: encadear com `&&` quebra no PowerShell,
   * e o projeto é usado ora no PowerShell, ora no Git Bash.
   *
   * Apaga só o que a regra criou e que ninguém pegou para fazer:
   *
   * - alerta vindo do portal tem código de fabricante e fica de fora, porque
   *   esse não dá para regenerar a partir da série;
   * - alerta que já virou ordem de serviço também fica, porque representa
   *   trabalho de verdade — apagar deixaria a OS sem o motivo que a originou.
   */
  if (process.argv.includes("--reset")) {
    const apagados = await db
      .delete(schema.alerta)
      .where(
        and(
          eq(schema.alerta.empresaId, empresa.id),
          isNull(schema.alerta.codigoFabricante),
          isNull(schema.alerta.ordemServicoId),
        ),
      )
      .returning({ id: schema.alerta.id });

    const [{ comOs }] = await db
      .select({ comOs: sql<number>`count(*)::int` })
      .from(schema.alerta)
      .where(sql`${schema.alerta.ordemServicoId} is not null`);

    console.log(
      `--reset: ${apagados.length} alertas de regra apagados.` +
        (comOs ? ` ${comOs} preservados por já terem ordem de serviço.` : "") +
        "\n",
    );
  }

  // Só a série diária serve: total mensal não diz em que dia a usina parou.
  const leituras = await db
    .select({
      usinaId: schema.leitura.usinaId,
      dia: sql<string>`(${schema.leitura.medidoEm} at time zone 'UTC')::date::text`,
      kwh: sql<number>`${schema.leitura.energiaKwh}::float8`,
    })
    .from(schema.leitura)
    .where(eq(schema.leitura.granularidade, "dia"));

  if (leituras.length === 0) {
    console.log(
      "Não há série diária no banco. Importe um relatório diário ou mensal por\n" +
        "equipamento: npm run import:geracao -- dados/",
    );
    process.exit(0);
  }

  const usinas = await db.query.usina.findMany({ with: { cliente: true } });
  const nomeDaUsina = new Map(usinas.map((u) => [u.id, u.nome]));

  /**
   * A partir de quando cada usina pode ser cobrada: data de instalação mais a
   * carência. Sem isso o detector acusa usina que ainda não existia no período —
   * e foi exatamente o que aconteceu na primeira rodada, com duas usinas
   * instaladas depois do mês analisado aparecendo como "praticamente sem
   * geração".
   */
  const cobravelDesde = new Map<string, string>();
  for (const u of usinas) {
    if (!u.dataInstalacao) continue;
    const inicio = new Date(u.dataInstalacao);
    inicio.setDate(inicio.getDate() + CARENCIA_DIAS);
    cobravelDesde.set(u.id, inicio.toISOString().slice(0, 10));
  }

  // Passo 1: o padrão de cada usina é a mediana dos seus dias com geração.
  let foraDoPeriodo = 0;
  const porUsina = new Map<string, Map<string, number>>();
  for (const l of leituras) {
    const desde = cobravelDesde.get(l.usinaId);
    if (desde && l.dia < desde) {
      foraDoPeriodo++;
      continue;
    }
    if (!porUsina.has(l.usinaId)) porUsina.set(l.usinaId, new Map());
    porUsina.get(l.usinaId)!.set(l.dia, l.kwh);
  }

  const padrao = new Map<string, number>();
  /**
   * Usina observada tempo suficiente e que mesmo assim quase não gerou.
   *
   * Aqui mora a armadilha: excluir essas usinas da análise, como um filtro de
   * qualidade de dado faria, joga fora exatamente o pior caso — a usina que
   * passou o mês inteiro parada não tem histórico justamente porque está morta.
   * A ausência de geração é o achado, não a falta dele.
   */
  const semPadrao: { usinaId: string; diasComGeracao: number; diasNoPeriodo: number }[] =
    [];
  /**
   * Usina recém-chegada, com poucos dias no banco.
   *
   * É diferente de estar parada, e confundir as duas gera o pior tipo de alarme
   * falso: acusar de morta uma usina que entrou ontem no sistema e está gerando
   * normalmente. Só se afirma alguma coisa sobre uma usina depois de observá-la
   * por `DIAS_MINIMOS` dias.
   */
  let historicoInsuficiente = 0;

  for (const [usinaId, dias] of porUsina) {
    const positivos = [...dias.values()].filter((v) => v > 0);
    if (positivos.length >= DIAS_MINIMOS) {
      padrao.set(usinaId, mediana(positivos));
    } else if (dias.size >= DIAS_MINIMOS) {
      // Tempo de observação suficiente, geração quase nenhuma: é achado.
      semPadrao.push({
        usinaId,
        diasComGeracao: positivos.length,
        diasNoPeriodo: dias.size,
      });
    } else {
      historicoInsuficiente++;
    }
  }

  if (padrao.size === 0 && semPadrao.length === 0) {
    console.log(
      `Nenhuma usina tem ${DIAS_MINIMOS} dias de geração no banco — pouco` +
        "\nhistórico para estabelecer padrão. Importe mais meses.",
    );
    process.exit(0);
  }

  // Passo 2: o fator de cada dia, que é o clima, sai da mediana das razões.
  const diasUnicos = [...new Set(leituras.map((l) => l.dia))].sort();
  const fatorDoDia = new Map<string, number>();
  for (const dia of diasUnicos) {
    const razoes: number[] = [];
    for (const [usinaId, base] of padrao) {
      const gerado = porUsina.get(usinaId)?.get(dia);
      if (gerado !== undefined && base > 0) razoes.push(gerado / base);
    }
    fatorDoDia.set(dia, mediana(razoes));
  }

  // Passo 3: julgar cada usina em cada dia, contra o esperado daquele dia.
  type Achado = {
    usinaId: string;
    dia: string;
    gerado: number;
    esperado: number;
    tipo: "offline" | "geracao_baixa";
  };
  const achados: Achado[] = [];
  let diasDescartados = 0;

  for (const dia of diasUnicos) {
    const fator = fatorDoDia.get(dia) ?? 0;
    if (fator < FATOR_DIA_MINIMO) {
      diasDescartados++;
      continue;
    }
    for (const [usinaId, base] of padrao) {
      const gerado = porUsina.get(usinaId)?.get(dia);
      if (gerado === undefined) continue;
      const esperado = base * fator;
      if (gerado === 0) {
        achados.push({ usinaId, dia, gerado, esperado, tipo: "offline" });
      } else if (gerado < esperado * LIMITE_BAIXA) {
        achados.push({ usinaId, dia, gerado, esperado, tipo: "geracao_baixa" });
      }
    }
  }

  console.log(
    `${padrao.size} usinas com padrão estabelecido, ${diasUnicos.length} dias analisados` +
      (diasDescartados ? `, ${diasDescartados} descartados por tempo ruim` : "") +
      ".",
  );
  if (foraDoPeriodo) {
    console.log(
      `${foraDoPeriodo} leituras ignoradas por serem anteriores à instalação ` +
        `da usina (mais ${CARENCIA_DIAS} dias de carência).`,
    );
  }
  if (historicoInsuficiente) {
    console.log(
      `${historicoInsuficiente} usinas com menos de ${DIAS_MINIMOS} dias no banco — ` +
        "novas demais para julgar, nada afirmado sobre elas.",
    );
  }
  console.log("");

  let novos = 0;

  // As sem padrão vêm primeiro: são as mais graves e as que passariam batido.
  if (semPadrao.length) {
    console.log(
      `${semPadrao.length} usinas praticamente sem geração no período — essas são` +
        "\nas mais urgentes, e são justamente as que um filtro de dado ruim" +
        "\nesconderia:\n",
    );
    for (const s of semPadrao.sort((a, b) => a.diasComGeracao - b.diasComGeracao)) {
      const rotulo =
        s.diasComGeracao === 0
          ? `não gerou em nenhum dos ${s.diasNoPeriodo} dias`
          : `gerou em apenas ${s.diasComGeracao} de ${s.diasNoPeriodo} dias`;
      console.log(`  ${nomeDaUsina.get(s.usinaId) ?? s.usinaId}\n    ${rotulo}`);

      // Um alerta só, datado no último dia do período: é uma condição contínua,
      // não um evento por dia.
      const resultado = await db
        .insert(schema.alerta)
        .values({
          empresaId: empresa.id,
          usinaId: s.usinaId,
          tipo: "offline",
          severidade: "critico",
          mensagem: `Praticamente sem geração: ${rotulo} entre ${diasUnicos[0]} e ${
            diasUnicos[diasUnicos.length - 1]
          }`,
          abertoEm: new Date(`${diasUnicos[diasUnicos.length - 1]}T12:00:00Z`),
        })
        .onConflictDoNothing()
        .returning({ id: schema.alerta.id });
      if (resultado.length) novos++;
    }
    console.log("");
  }

  if (achados.length === 0) {
    if (!semPadrao.length) {
      console.log("Nenhuma anomalia no período. Todas geraram dentro do esperado.");
    }
    console.log(`${novos} alertas novos gravados.`);
    process.exit(0);
  }
  for (const a of achados) {
    const quando = new Date(`${a.dia}T12:00:00Z`);
    const resultado = await db
      .insert(schema.alerta)
      .values({
        empresaId: empresa.id,
        usinaId: a.usinaId,
        tipo: a.tipo,
        severidade: a.tipo === "offline" ? "critico" : "atencao",
        mensagem:
          a.tipo === "offline"
            ? `Não gerou nada em ${a.dia}, quando o esperado era ${a.esperado.toFixed(1)} kWh`
            : `Gerou ${a.gerado.toFixed(1)} kWh em ${a.dia}, ${Math.round(
                (1 - a.gerado / a.esperado) * 100,
              )}% abaixo dos ${a.esperado.toFixed(1)} kWh esperados`,
        abertoEm: quando,
      })
      .onConflictDoNothing()
      .returning({ id: schema.alerta.id });
    if (resultado.length) novos++;
  }

  // Agrupa por usina: 5 dias parados na mesma usina é um problema, não cinco.
  const porUsinaAchado = new Map<string, Achado[]>();
  for (const a of achados) {
    if (!porUsinaAchado.has(a.usinaId)) porUsinaAchado.set(a.usinaId, []);
    porUsinaAchado.get(a.usinaId)!.push(a);
  }

  const ordenado = [...porUsinaAchado].sort((a, b) => b[1].length - a[1].length);
  console.log(`${achados.length} dias com anomalia em ${ordenado.length} usinas:\n`);

  for (const [usinaId, lista] of ordenado) {
    const parados = lista.filter((a) => a.tipo === "offline");
    const fracos = lista.filter((a) => a.tipo === "geracao_baixa");
    const perdido = lista.reduce((s, a) => s + (a.esperado - a.gerado), 0);
    const partes: string[] = [];
    if (parados.length) partes.push(`${parados.length} dias parada`);
    if (fracos.length) partes.push(`${fracos.length} dias fraca`);
    console.log(
      `  ${nomeDaUsina.get(usinaId) ?? usinaId}\n` +
        `    ${partes.join(", ")} · ${perdido.toFixed(0)} kWh deixados de gerar` +
        (parados.length
          ? `\n    primeiro dia parado: ${parados[0].dia}`
          : ""),
    );
  }

  console.log(`\n${novos} alertas novos gravados.`);
  process.exit(0);
}

main().catch((erro) => {
  console.error("Falhou:", erro instanceof Error ? erro.message : erro);
  process.exit(1);
});
