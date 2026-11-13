import "dotenv/config";

import { and, eq, inArray, like } from "drizzle-orm";

import { db, schema } from "@/db";

/**
 * Desativa as cinco contas genéricas que o `db:seed` criou (`*@bbsolucoes.local`).
 *
 *   npm run usuario:desativar-genericas              (só mostra o que faria)
 *   npm run usuario:desativar-genericas -- --confirmar
 *
 * A senha delas está publicada no repositório, que é público: enquanto estiverem
 * ativas, qualquer pessoa que ache o repositório entra como administrador, e a
 * trilha de quem baixou documento ou anotou serial não identifica ninguém.
 *
 * Desativa em vez de apagar, como a tela de Usuários: apagar levaria junto o
 * nome de quem enviou cada documento. As sessões caem na hora, e os celulares
 * (push) saem junto com elas.
 *
 * Recusa se isso deixar a empresa sem nenhum administrador nominal ativo —
 * senão ninguém mais entra, e a saída seria mexer no banco à mão.
 */

const PADRAO_EMAIL = "%@bbsolucoes.local";

async function main() {
  const confirmar = process.argv.includes("--confirmar");

  const genericas = await db.query.usuario.findMany({
    where: like(schema.usuario.email, PADRAO_EMAIL),
    columns: { id: true, empresaId: true, nome: true, email: true, papel: true, ativo: true },
  });
  const ativas = genericas.filter((u) => u.ativo);

  if (genericas.length === 0) {
    console.log("Nenhuma conta genérica no banco. Nada a fazer.");
    process.exit(0);
  }
  if (ativas.length === 0) {
    console.log(`As ${genericas.length} contas genéricas já estão desativadas. Nada a fazer.`);
    process.exit(0);
  }

  console.log("Contas genéricas ativas:");
  for (const u of ativas) console.log(`  ${(u.email ?? "").padEnd(32)} ${u.papel}`);

  // Cada empresa precisa continuar com pelo menos um adm de verdade.
  const empresas = [...new Set(ativas.map((u) => u.empresaId))];
  for (const empresaId of empresas) {
    const adms = await db.query.usuario.findMany({
      where: and(
        eq(schema.usuario.empresaId, empresaId),
        eq(schema.usuario.papel, "adm"),
        eq(schema.usuario.ativo, true),
      ),
      columns: { email: true, aprovadoEm: true },
    });
    const nominais = adms.filter((a) => a.aprovadoEm && !a.email?.endsWith("@bbsolucoes.local"));
    if (nominais.length === 0) {
      console.error(
        "\nRecusado: depois disto a empresa ficaria sem nenhum administrador nominal ativo.\n" +
          "Crie antes a conta de uma pessoa (Administração → Usuários, ou `npm run usuario:aprovar`)\n" +
          "com papel adm, entre com ela e só então rode este comando.",
      );
      process.exit(1);
    }
  }

  if (!confirmar) {
    console.log(`\nNada foi alterado. Rode com --confirmar para desativar as ${ativas.length}.`);
    process.exit(0);
  }

  const ids = ativas.map((u) => u.id);
  await db.update(schema.usuario).set({ ativo: false }).where(inArray(schema.usuario.id, ids));
  // Derruba na hora; o aparelho_push cai junto (ON DELETE CASCADE na sessão).
  await db.delete(schema.sessao).where(inArray(schema.sessao.usuarioId, ids));

  console.log(`\nDesativadas ${ids.length} contas genéricas e derrubadas as sessões delas.`);
  process.exit(0);
}

main().catch((erro) => {
  console.error("Falhou:", erro instanceof Error ? erro.message : erro);
  process.exit(1);
});
