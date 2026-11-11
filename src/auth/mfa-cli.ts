import "dotenv/config";

import { and, eq, isNotNull } from "drizzle-orm";

import { db, schema } from "@/db";

import { cpfValido, formatarCpf, normalizarCpf } from "./cpf";
import { redefinirMfa } from "./mfa";

/**
 * Apaga o segundo fator de uma pessoa, direto no banco.
 *
 *   npm run mfa:redefinir -- --email adm@empresa.com.br
 *   npm run mfa:redefinir -- --cpf 123.456.789-09
 *
 * Para quando o painel não serve: o **único administrador** perdeu o celular (o
 * painel não deixa ninguém redefinir o próprio 2FA, e não há outro adm para
 * fazer isso). Na VM:
 *
 *   docker compose exec -T coletor npm run mfa:redefinir -- --email ...
 *
 * A pessoa perde as sessões e os aparelhos conhecidos; no próximo login,
 * cadastra o aplicativo de novo.
 */

function argumento(nome: string): string | undefined {
  const i = process.argv.indexOf(`--${nome}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const email = argumento("email")?.trim().toLowerCase();
  const cpf = normalizarCpf(argumento("cpf") ?? "");

  if (!email && !cpfValido(cpf)) {
    console.error('Diga quem: --email "pessoa@empresa.com.br" ou --cpf 123.456.789-09');
    process.exit(1);
  }

  const achadas = await db.query.usuario.findMany({
    where: email ? eq(schema.usuario.email, email) : and(eq(schema.usuario.cpf, cpf), isNotNull(schema.usuario.cpf)),
    columns: { id: true, nome: true, cpf: true, email: true, mfaAtivadoEm: true },
  });
  if (achadas.length !== 1) {
    console.error(
      achadas.length === 0
        ? "Ninguém com esse e-mail ou CPF."
        : "Mais de uma conta com esse CPF (empresas diferentes): use --email.",
    );
    process.exit(1);
  }

  const pessoa = achadas[0];
  await redefinirMfa(pessoa.id);
  console.log(
    `2FA de ${pessoa.nome} (${pessoa.email ?? formatarCpf(pessoa.cpf ?? "")}) redefinido` +
      `${pessoa.mfaAtivadoEm ? "" : " (ela ainda não tinha cadastrado o aplicativo)"}. ` +
      "Sessões e aparelhos conhecidos apagados; no próximo login ela cadastra o aplicativo de novo.",
  );
  process.exit(0);
}

main().catch((erro) => {
  console.error("Falhou:", erro instanceof Error ? erro.message : erro);
  process.exit(1);
});
