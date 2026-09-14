import "dotenv/config";

import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";

import { db, schema } from "../db";

/**
 * Cria um dossiê por venda a partir do que o Drive já organizou, e prende cada
 * documento ao dossiê certo.
 *
 * O Drive **já está organizado por projeto** — 1.640 dos 2.788 arquivos estão
 * dentro de uma subpasta `PE …`, e o nome dela traz cliente e data. A
 * importação achatava isso: tudo pendurava no cliente. Com pastas
 * `PE Aumento GD` existindo, que é venda nova no mesmo cliente, os dois
 * projetos dividiam uma pilha só e ninguém sabia qual ART era de qual.
 *
 * A granularidade escolhida é **(cliente, ano)**, e não uma por subpasta `PE`,
 * porque a subpasta é a pasta do *projeto elétrico* — um mesmo negócio pode ter
 * `PE Solar … V2` e `PE Aumento …` do mesmo ano. Ano é o que o Drive garante:
 * `CLIENTES 2026 / FULANO /`.
 *
 * Documento pessoal **não entra em dossiê**: CNH e RG são da pessoa, valem para
 * qualquer venda dela, e pedir de novo no segundo projeto seria burrice.
 *
 *   npm run dossies -- --simular
 *   npm run dossies
 */

/** Marca no `observacoes` que o projeto nasceu daqui, e não de alguém digitando. */
const ASSINATURA = "Dossiê criado pela importação do Drive";

/**
 * Tipos que pertencem à pessoa, não à venda.
 *
 * Ficam com `projetoId` nulo de propósito e valem para todos os dossiês do
 * cliente.
 */
const DO_CLIENTE = new Set(["documento_pessoal", "ficha_cadastral"]);

function anoDaPasta(origem: string | null): string | null {
  const achado = origem?.match(/\d{4}/);
  return achado ? achado[0] : null;
}

async function main() {
  const simular = process.argv.includes("--simular");

  const empresa = await db.query.empresa.findFirst();
  if (!empresa) {
    console.error("Nenhuma empresa no banco. Rode `npm run db:seed` primeiro.");
    process.exit(1);
  }

  const etapas = await db.query.etapa.findMany({
    where: eq(schema.etapa.empresaId, empresa.id),
    orderBy: asc(schema.etapa.ordem),
  });
  const exigencias = await db.query.exigenciaDocumento.findMany({
    where: eq(schema.exigenciaDocumento.empresaId, empresa.id),
    with: { etapa: true },
  });
  if (etapas.length === 0 || exigencias.length === 0) {
    console.error(
      "Faltam etapas ou exigências. Rode `npm run db:seed` e `npm run seed:exigencias`.",
    );
    process.exit(1);
  }

  const monitoramento =
    etapas.find((e) => e.slug.startsWith("monitoramento")) ?? etapas.at(-1)!;

  /**
   * Só etapas que exigem algum documento entram na conta.
   *
   * "Proposta comercial" e "Forma de pagamento" não pedem papel nenhum, e a
   * primeira versão disto avançava por elas só porque a conta de luz tinha
   * chegado — 100 dossiês foram parar em "Forma de pagamento" sem que nada no
   * Drive dissesse coisa alguma sobre pagamento. Ter o talão não diz que o
   * pagamento foi acertado.
   */
  const comExigencia = etapas.filter((e) =>
    exigencias.some((x) => x.obrigatorio && x.etapaId === e.id),
  );

  /**
   * Onde o dossiê parou, pelos documentos que existem.
   *
   * Devolve a **primeira etapa incompleta** — onde o trabalho está travado —, e
   * não a última completa: quem não tem a conta de luz está em coleta de
   * informações, não em lead. Devolve `null` quando não falta nada.
   *
   * É inferência, e está dita como tal no `observacoes` de cada projeto. Mas é
   * muito melhor do que jogar 171 dossiês no "Lead" e mandar alguém arrastar um
   * por um.
   */
  function etapaPelosDocumentos(tipos: Set<string>) {
    for (const etapa of comExigencia) {
      const falta = exigencias.some(
        (x) => x.obrigatorio && x.etapa.ordem <= etapa.ordem && !tipos.has(x.tipo),
      );
      if (falta) return etapa;
    }
    return null;
  }

  const documentos = await db.query.documento.findMany({
    where: eq(schema.documento.empresaId, empresa.id),
    columns: {
      id: true,
      clienteId: true,
      tipo: true,
      origem: true,
      status: true,
    },
  });

  const usinas = await db.query.usina.findMany({
    where: eq(schema.usina.empresaId, empresa.id),
    columns: { id: true, clienteId: true, status: true, potenciaKwp: true },
  });
  const usinaPorCliente = new Map<string, (typeof usinas)[number]>();
  for (const u of usinas) if (!usinaPorCliente.has(u.clienteId)) usinaPorCliente.set(u.clienteId, u);

  /** Dossiês que já existem, para não criar de novo a cada rodada. */
  const projetos = await db.query.projeto.findMany({
    where: eq(schema.projeto.empresaId, empresa.id),
    columns: { id: true, clienteId: true, titulo: true, observacoes: true },
  });
  const jaCriados = new Map<string, string>();
  for (const p of projetos) {
    if (p.observacoes?.includes(ASSINATURA)) jaCriados.set(p.titulo, p.id);
  }

  // Agrupa os documentos por (cliente, ano da pasta).
  const grupos = new Map<
    string,
    { clienteId: string; ano: string; docs: typeof documentos }
  >();
  const soltos: typeof documentos = [];

  for (const d of documentos) {
    if (DO_CLIENTE.has(d.tipo)) {
      soltos.push(d);
      continue;
    }
    const ano = anoDaPasta(d.origem);
    if (!ano) {
      soltos.push(d);
      continue;
    }
    const chave = `${d.clienteId}|${ano}`;
    const grupo = grupos.get(chave) ?? { clienteId: d.clienteId, ano, docs: [] };
    grupo.docs.push(d);
    grupos.set(chave, grupo);
  }

  const clientes = await db.query.cliente.findMany({
    where: inArray(
      schema.cliente.id,
      [...new Set([...grupos.values()].map((g) => g.clienteId))],
    ),
    columns: { id: true, nome: true },
  });
  const nomePorCliente = new Map(clientes.map((c) => [c.id, c.nome]));

  console.log(simular ? "SIMULAÇÃO — nada será gravado.\n" : "");

  let criados = 0;
  let reaproveitados = 0;
  let vinculados = 0;
  const porEtapa = new Map<string, number>();

  for (const grupo of [...grupos.values()].sort((a, b) =>
    (nomePorCliente.get(a.clienteId) ?? "").localeCompare(
      nomePorCliente.get(b.clienteId) ?? "",
      "pt-BR",
    ),
  )) {
    const nome = nomePorCliente.get(grupo.clienteId) ?? "(sem nome)";
    const titulo = `${nome} — ${grupo.ano}`;

    /**
     * O arquivo de trabalho não conta como documento.
     *
     * O `.dwg` do projeto e a planilha `.xlsm` do memorial são o meio do
     * caminho, não o entregável — 9 clientes tinham como único memorial a
     * planilha e passavam por completos.
     *
     * E os documentos pessoais valem para qualquer dossiê do cliente: quem
     * mandou a CNH uma vez não deve aparecer sem documento do titular no
     * segundo projeto.
     */
    const tipos = new Set(
      grupo.docs.filter((d) => d.status !== "trabalho").map((d) => d.tipo),
    );
    for (const s of soltos) {
      if (s.clienteId === grupo.clienteId && s.status !== "trabalho") tipos.add(s.tipo);
    }

    const etapa = etapaPelosDocumentos(tipos);
    const usina = usinaPorCliente.get(grupo.clienteId);

    /**
     * Usina gerando significa obra entregue, mesmo com papel faltando no
     * Drive: a documentação de 2024 e 2025 nunca foi arquivada direito, e
     * segurar esses dossiês em "Vistoria técnica" encheria o quadro de
     * trabalho que não existe. Projeto concluído sai do caminho de quem está
     * trabalhando hoje.
     */
    const concluido = usina?.status === "gerando" || etapa === null;
    const etapaFinal = concluido ? monitoramento : etapa!;

    porEtapa.set(etapaFinal.nome, (porEtapa.get(etapaFinal.nome) ?? 0) + 1);

    let projetoId = jaCriados.get(titulo);
    if (projetoId) {
      reaproveitados++;
    } else if (!simular) {
      const [criado] = await db
        .insert(schema.projeto)
        .values({
          empresaId: empresa.id,
          clienteId: grupo.clienteId,
          usinaId: usina?.id ?? null,
          titulo,
          etapaId: etapaFinal.id,
          situacao: concluido ? "concluido" : "em_andamento",
          potenciaKwp: usina?.potenciaKwp ?? null,
          observacoes:
            `${ASSINATURA} em ${new Date().toLocaleDateString("pt-BR")}. ` +
            `A etapa foi deduzida dos documentos que existem na pasta, não informada por ninguém — confira antes de cobrar alguém por ela.`,
        })
        .returning({ id: schema.projeto.id });
      projetoId = criado.id;
      jaCriados.set(titulo, projetoId);
      criados++;
    } else {
      criados++;
    }

    if (!simular && projetoId) {
      const ids = grupo.docs.map((d) => d.id);
      for (let i = 0; i < ids.length; i += 200) {
        await db
          .update(schema.documento)
          .set({ projetoId })
          .where(inArray(schema.documento.id, ids.slice(i, i + 200)));
      }
      vinculados += ids.length;
    } else {
      vinculados += grupo.docs.length;
    }
  }

  console.log(`Dossiês criados:      ${criados}`);
  if (reaproveitados) console.log(`Já existiam:          ${reaproveitados}`);
  console.log(`Documentos vinculados: ${vinculados}`);
  console.log(`Documentos da pessoa (sem dossiê): ${soltos.length}`);

  console.log("\nEtapa deduzida pelos documentos:");
  const ordemDe = new Map(etapas.map((e) => [e.nome, e.ordem]));
  for (const [etapa, n] of [...porEtapa].sort(
    (a, b) => (ordemDe.get(a[0]) ?? 0) - (ordemDe.get(b[0]) ?? 0),
  )) {
    console.log(`  ${String(n).padStart(4)}  ${etapa}`);
  }

  if (simular) console.log("\nNada foi gravado. Rode sem --simular para valer.");
  process.exit(0);
}

main().catch((erro) => {
  console.error("Falhou:", erro instanceof Error ? erro.message : erro);
  process.exit(1);
});
