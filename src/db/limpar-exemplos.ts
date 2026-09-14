import "dotenv/config";

import { and, eq, inArray, isNull, notInArray, sql } from "drizzle-orm";

import { db, schema } from "../db";

/**
 * Remove os projetos e clientes de exemplo que o `db:seed` criou.
 *
 * Eles existiam para a esteira não nascer vazia — a própria tela avisa que "os
 * projetos são fictícios". Agora que os 171 dossiês reais entraram pelo Drive,
 * Maria Souza e a Padaria Central atrapalham: quem olhar o quadro não tem como
 * saber quais linhas são de gente de verdade.
 *
 * Só apaga o que é seguramente inventado: cliente **sem nenhum documento, sem
 * nenhuma usina e sem ordem de serviço**, com projeto que não veio da
 * importação. Qualquer vínculo com dado real e o cliente fica de pé.
 *
 *   npm run limpar:exemplos              (mostra o que seria apagado)
 *   npm run limpar:exemplos -- --apagar  (apaga de verdade)
 */

const ASSINATURA = "Dossiê criado pela importação do Drive";

async function main() {
  const apagar = process.argv.includes("--apagar");

  const empresa = await db.query.empresa.findFirst();
  if (!empresa) {
    console.error("Nenhuma empresa no banco.");
    process.exit(1);
  }

  const projetos = await db.query.projeto.findMany({
    where: eq(schema.projeto.empresaId, empresa.id),
    with: { cliente: true, documentos: { columns: { id: true } } },
  });

  /**
   * Projeto de exemplo: não veio da importação e não tem documento nenhum.
   *
   * As duas condições juntas, não uma. Projeto criado à mão pelo Vinícius na
   * tela `/projeto/novo` também não tem a assinatura da importação, e apagar
   * isso seria apagar trabalho de verdade — por isso a exigência de estar
   * vazio.
   */
  const deExemplo = projetos.filter(
    (p) => !p.observacoes?.includes(ASSINATURA) && p.documentos.length === 0,
  );

  if (deExemplo.length === 0) {
    console.log("Nada de exemplo sobrou. Nenhuma mudança.");
    process.exit(0);
  }

  const idsProjeto = deExemplo.map((p) => p.id);
  const idsCliente = [...new Set(deExemplo.map((p) => p.clienteId))];

  // Um cliente só cai junto se não tiver nada de real preso nele.
  const comUsina = await db
    .select({ id: schema.usina.clienteId })
    .from(schema.usina)
    .where(inArray(schema.usina.clienteId, idsCliente));
  const comDocumento = await db
    .select({ id: schema.documento.clienteId })
    .from(schema.documento)
    .where(inArray(schema.documento.clienteId, idsCliente));
  const comOs = await db
    .select({ id: schema.ordemServico.clienteId })
    .from(schema.ordemServico)
    .where(inArray(schema.ordemServico.clienteId, idsCliente));
  const comOutroProjeto = projetos
    .filter((p) => !idsProjeto.includes(p.id))
    .map((p) => p.clienteId);

  const presos = new Set([
    ...comUsina.map((r) => r.id),
    ...comDocumento.map((r) => r.id),
    ...comOs.map((r) => r.id),
    ...comOutroProjeto,
  ]);
  const clientesParaApagar = idsCliente.filter((id) => !presos.has(id));

  console.log(`Projetos de exemplo: ${deExemplo.length}`);
  for (const p of deExemplo) {
    console.log(`  ${p.titulo.padEnd(24)} ${p.cliente.nome}`);
  }
  console.log(`\nClientes que caem junto: ${clientesParaApagar.length}`);
  console.log(
    `Clientes preservados por terem dado real: ${idsCliente.length - clientesParaApagar.length}`,
  );

  if (!apagar) {
    console.log("\nNada foi apagado. Rode com --apagar para valer.");
    process.exit(0);
  }

  // Eventos primeiro: o projeto é referenciado por eles com ON DELETE CASCADE,
  // mas apagar explicitamente deixa o que aconteceu legível no log.
  await db
    .delete(schema.projetoEvento)
    .where(inArray(schema.projetoEvento.projetoId, idsProjeto));
  await db.delete(schema.projeto).where(inArray(schema.projeto.id, idsProjeto));
  if (clientesParaApagar.length) {
    await db.delete(schema.cliente).where(inArray(schema.cliente.id, clientesParaApagar));
  }

  console.log(
    `\nApagados: ${deExemplo.length} projetos e ${clientesParaApagar.length} clientes de exemplo.`,
  );
  process.exit(0);
}

main().catch((erro) => {
  console.error("Falhou:", erro instanceof Error ? erro.message : erro);
  process.exit(1);
});
