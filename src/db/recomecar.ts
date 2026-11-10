import "dotenv/config";

import { and, desc, eq, inArray, isNull, lt, notInArray, sql } from "drizzle-orm";

import { db, schema } from "./index";

/**
 * Recomeço da operação: a empresa passa a usar o Selebi do zero, só com os
 * clientes novos que forem entrando.
 *
 *   npm run recomecar                                  só mostra o que faria (não mexe em nada)
 *   npm run recomecar -- --confirmar                   faz, numa transação só
 *   npm run recomecar -- --manter-desde="2026-11-10 08:00"
 *                                                      não toca no que foi criado a partir daí
 *   npm run recomecar -- --empresa="BB Soluções"       se o banco tiver mais de uma empresa
 *
 * O que acontece com o que existe hoje:
 * - **apagado de vez:** projetos da esteira (com histórico, seriais e cobranças),
 *   documentos dos dossiês, ordens de serviço (com checklist, fotos,
 *   eventos e trilha do GPS), comentários deles, a lista da Energisa,
 *   mensagens de WhatsApp ainda na fila, e os clientes que não têm usina;
 * - **arquivado:** as usinas. A coleta continua e a geração fica guardada
 *   para análise, mas elas saem da tela, dos alertas, da OS automática e do
 *   relatório mensal (ver `usina.arquivada_em`);
 * - **fica como está:** usuários, etapas, modelos de OS, tarifas, contas dos
 *   portais, leituras de geração, alertas antigos (escondidos com a usina) e
 *   os links de relatório já mandados. Os arquivos no Google Drive não são
 *   apagados: só o registro deles no Selebi.
 *
 * Cliente que tem usina continua cadastrado, porque é dono dela; se voltar a
 * comprar, o projeto novo usa o cadastro que já existe.
 *
 * Antes de confirmar, faça a cópia de segurança:
 *   docker compose exec -T coletor npm run backup
 */

function opcao(nome: string): string | null {
  const achada = process.argv.find((a) => a.startsWith(`--${nome}=`));
  return achada ? achada.slice(nome.length + 3).replace(/^["']|["']$/g, "") : null;
}

const fmt = (d: Date) => d.toLocaleString("pt-BR", { timeZone: "America/Maceio" });

async function main() {
  const confirmar = process.argv.includes("--confirmar");
  const manterTexto = opcao("manter-desde");
  const manterDesde = manterTexto ? new Date(manterTexto.replace(" ", "T") + (/[zZ]|[+-]\d\d:?\d\d$/.test(manterTexto) ? "" : "-03:00")) : null;
  if (manterTexto && (!manterDesde || Number.isNaN(manterDesde.getTime()))) {
    throw new Error(`--manter-desde inválido: "${manterTexto}". Use, por exemplo, --manter-desde="2026-11-10 08:00".`);
  }
  // O corte: o que foi criado antes dele é "de antes". Sem --manter-desde, tudo o que existe agora.
  const corte = manterDesde ?? new Date();

  const empresas = await db.query.empresa.findMany({ columns: { id: true, nome: true, recomecoEm: true } });
  const nomeEmpresa = opcao("empresa");
  const empresa = nomeEmpresa ? empresas.find((e) => e.nome === nomeEmpresa || e.id === nomeEmpresa) : empresas.length === 1 ? empresas[0] : null;
  if (!empresa) {
    throw new Error(
      nomeEmpresa
        ? `Empresa "${nomeEmpresa}" não encontrada.`
        : `Há ${empresas.length} empresas no banco: diga qual com --empresa="Nome" (${empresas.map((e) => e.nome).join(", ")}).`,
    );
  }
  const empresaId = empresa.id;

  // ---- o que entra no recomeço ------------------------------------------------
  const os = await db
    .select({ id: schema.ordemServico.id })
    .from(schema.ordemServico)
    .where(and(eq(schema.ordemServico.empresaId, empresaId), lt(schema.ordemServico.criadoEm, corte)));
  const projetos = await db
    .select({ id: schema.projeto.id })
    .from(schema.projeto)
    .where(and(eq(schema.projeto.empresaId, empresaId), lt(schema.projeto.criadoEm, corte)));
  const documentos = await db
    .select({ id: schema.documento.id })
    .from(schema.documento)
    .where(and(eq(schema.documento.empresaId, empresaId), lt(schema.documento.criadoEm, corte)));
  const energisa = await db
    .select({ id: schema.energisaProjeto.id })
    .from(schema.energisaProjeto)
    .where(and(eq(schema.energisaProjeto.empresaId, empresaId), lt(schema.energisaProjeto.criadoEm, corte)));
  const usinas = await db
    .select({ id: schema.usina.id, clienteId: schema.usina.clienteId })
    .from(schema.usina)
    .where(and(eq(schema.usina.empresaId, empresaId), isNull(schema.usina.arquivadaEm), lt(schema.usina.criadoEm, corte)));
  // Cliente com usina (qualquer uma) fica: é o dono dela.
  const donos = await db
    .selectDistinct({ id: schema.usina.clienteId })
    .from(schema.usina)
    .where(and(eq(schema.usina.empresaId, empresaId), sql`${schema.usina.clienteId} is not null`));
  const idsDonos = donos.map((d) => d.id!).filter(Boolean);
  const clientes = await db
    .select({ id: schema.cliente.id })
    .from(schema.cliente)
    .where(
      and(
        eq(schema.cliente.empresaId, empresaId),
        lt(schema.cliente.criadoEm, corte),
        ...(idsDonos.length ? [notInArray(schema.cliente.id, idsDonos)] : []),
      ),
    );
  const [{ n: whatsapp }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.notificacao)
    .where(and(eq(schema.notificacao.empresaId, empresaId), eq(schema.notificacao.status, "pendente"), lt(schema.notificacao.criadoEm, corte)));

  const idsOs = os.map((o) => o.id);
  const idsProjetos = projetos.map((p) => p.id);
  const idsClientes = clientes.map((c) => c.id);

  console.log(`\n${empresa.nome} — recomeço ${confirmar ? "" : "(SIMULAÇÃO: nada foi mexido)"}`);
  console.log(`Corte: tudo o que foi criado antes de ${fmt(corte)}.`);
  if (empresa.recomecoEm) console.log(`Atenção: esta empresa já recomeçou uma vez, em ${fmt(empresa.recomecoEm)}.`);
  console.log(`\nApagar de vez:`);
  console.log(`  ${idsProjetos.length} projetos da esteira (com histórico, seriais e cobranças)`);
  console.log(`  ${documentos.length} documentos dos dossiês (os arquivos no Drive ficam)`);
  console.log(`  ${idsOs.length} ordens de serviço (com checklist, fotos, eventos e trilha do GPS)`);
  console.log(`  ${energisa.length} projetos da lista da Energisa`);
  console.log(`  ${idsClientes.length} clientes sem usina`);
  console.log(`  ${whatsapp} mensagens de WhatsApp ainda na fila`);
  console.log(`Arquivar (seguem coletando, só para análise):`);
  console.log(`  ${usinas.length} usinas`);
  console.log(`Ficam: ${idsDonos.length} clientes donos de usina, usuários, etapas, modelos de OS, leituras e alertas antigos.`);

  // Para conferir que nada da fase nova vai junto: os últimos cadastros com data.
  const ultimos = await db
    .select({ nome: schema.cliente.nome, criadoEm: schema.cliente.criadoEm })
    .from(schema.cliente)
    .where(eq(schema.cliente.empresaId, empresaId))
    .orderBy(desc(schema.cliente.criadoEm))
    .limit(5);
  console.log(`\nOs 5 últimos clientes cadastrados (confira se algum já é da fase nova):`);
  for (const c of ultimos) console.log(`  ${fmt(c.criadoEm)}  ${c.nome}${c.criadoEm < corte ? "" : "  ← fica (depois do corte)"}`);
  console.log(`Se algum desses já for cliente novo, rode de novo com --manter-desde="AAAA-MM-DD HH:MM" (a hora em que a fase nova começou).`);

  if (!confirmar) {
    console.log(`\nPara fazer de verdade: faça a cópia de segurança e rode com --confirmar.\n`);
    process.exit(0);
  }

  const agora = new Date();
  await db.transaction(async (tx) => {
    // Comentários não têm chave estrangeira: saem à mão, junto com o que comentam.
    if (idsProjetos.length)
      await tx.delete(schema.comentario).where(and(eq(schema.comentario.entidade, "projeto"), inArray(schema.comentario.entidadeId, idsProjetos)));
    if (idsOs.length)
      await tx.delete(schema.comentario).where(and(eq(schema.comentario.entidade, "ordem_servico"), inArray(schema.comentario.entidadeId, idsOs)));
    if (idsClientes.length)
      await tx.delete(schema.comentario).where(and(eq(schema.comentario.entidade, "cliente"), inArray(schema.comentario.entidadeId, idsClientes)));

    // OS: checklist, fotos, eventos e trilha do GPS vão junto (ON DELETE CASCADE).
    if (idsOs.length) await tx.delete(schema.ordemServico).where(inArray(schema.ordemServico.id, idsOs));
    // Projetos: histórico, seriais e cobranças vão junto.
    if (idsProjetos.length) await tx.delete(schema.projeto).where(inArray(schema.projeto.id, idsProjetos));
    if (documentos.length)
      await tx.delete(schema.documento).where(inArray(schema.documento.id, documentos.map((d) => d.id)));
    if (energisa.length)
      await tx.delete(schema.energisaProjeto).where(inArray(schema.energisaProjeto.id, energisa.map((e) => e.id)));
    if (idsClientes.length) {
      await tx.delete(schema.unidadeConsumidora).where(inArray(schema.unidadeConsumidora.clienteId, idsClientes));
      await tx.delete(schema.cliente).where(inArray(schema.cliente.id, idsClientes));
    }
    await tx
      .delete(schema.notificacao)
      .where(and(eq(schema.notificacao.empresaId, empresaId), eq(schema.notificacao.status, "pendente"), lt(schema.notificacao.criadoEm, corte)));
    if (usinas.length)
      await tx.update(schema.usina).set({ arquivadaEm: agora }).where(inArray(schema.usina.id, usinas.map((u) => u.id)));
    await tx.update(schema.empresa).set({ recomecoEm: corte }).where(eq(schema.empresa.id, empresaId));
  });

  console.log(`\nFeito. A empresa recomeçou em ${fmt(corte)}.`);
  console.log(`As usinas arquivadas aparecem em Usinas → filtro "Arquivadas".\n`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
