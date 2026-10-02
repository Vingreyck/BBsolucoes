import "dotenv/config";

import { and, eq } from "drizzle-orm";

import { ehPapelApp } from "@/app-movel/permissoes";
import { db, schema } from "@/db";

import { cpfValido, formatarCpf, normalizarCpf } from "./cpf";

/**
 * Aprova um cadastro feito pelo app, direto no banco.
 *
 *   npm run usuario:aprovar -- --cpf 123.456.789-09 --papel adm
 *
 * Existe para o começo de tudo: o primeiro administrador se cadastra pelo app
 * como qualquer pessoa, e não há ainda ninguém com CPF para aprová-lo. Depois
 * dele, quem aprova os outros é ele, pela tela de equipe do app.
 */

function argumento(nome: string): string | undefined {
  const i = process.argv.indexOf(`--${nome}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const cpf = normalizarCpf(argumento("cpf") ?? "");
  const papel = argumento("papel") ?? "tecnico";

  if (!cpfValido(cpf)) {
    console.error("Passe um CPF válido: --cpf 123.456.789-09");
    process.exit(1);
  }
  if (!ehPapelApp(papel)) {
    console.error("Papel: adm, engenheiro, tecnico ou vendedor.");
    process.exit(1);
  }

  const pedida = argumento("empresa");
  const empresas = await db.query.empresa.findMany({ columns: { id: true, nome: true } });
  const empresa = pedida
    ? empresas.find((e) => e.id === pedida || e.nome.toLowerCase() === pedida.toLowerCase())
    : empresas.length === 1
      ? empresas[0]
      : undefined;
  if (!empresa) {
    console.error("Diga a empresa com --empresa \"Nome\". Há:", empresas.map((e) => e.nome).join(", "));
    process.exit(1);
  }

  const pessoa = await db.query.usuario.findFirst({
    where: and(eq(schema.usuario.empresaId, empresa.id), eq(schema.usuario.cpf, cpf)),
    columns: { id: true, nome: true, aprovadoEm: true },
  });
  if (!pessoa) {
    console.error(
      `Nenhum cadastro com o CPF ${formatarCpf(cpf)} na ${empresa.nome}. ` +
        "A pessoa precisa se cadastrar pelo app primeiro.",
    );
    process.exit(1);
  }

  await db
    .update(schema.usuario)
    .set({ ativo: true, papel, aprovadoEm: pessoa.aprovadoEm ?? new Date() })
    .where(eq(schema.usuario.id, pessoa.id));

  console.log(`${pessoa.nome} aprovado como ${papel} na ${empresa.nome}.`);
  process.exit(0);
}

main().catch((erro) => {
  console.error("Falhou:", erro instanceof Error ? erro.message : erro);
  process.exit(1);
});
