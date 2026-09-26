import "dotenv/config";

import { createInterface } from "node:readline/promises";

import { and, eq, ne } from "drizzle-orm";

import { db, schema } from "@/db";

import {
  CODIGO_MAXIMO,
  CODIGO_MINIMO,
  hashDoCodigo,
  normalizarCodigo,
} from "./codigo-acesso";

/**
 * Define o código de acesso de uma empresa. Só o desenvolvedor roda isto.
 *
 *   npm run empresa:codigo
 *   npm run empresa:codigo -- --empresa "BB Soluções"
 *
 * O código é perguntado no terminal em vez de ir como argumento, para não
 * ficar no histórico do shell. Ele não é salvo em arquivo nenhum — no banco
 * vai só o hash —, então guarde-o com quem vai entregá-lo à empresa. Esqueceu?
 * Rode de novo com outro: quem já está logado continua logado, só os cadastros
 * novos passam a precisar do novo código.
 */

function argumento(nome: string): string | undefined {
  const i = process.argv.indexOf(`--${nome}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function perguntar(texto: string): Promise<string> {
  const leitor = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await leitor.question(texto)).trim();
  } finally {
    leitor.close();
  }
}

async function main() {
  const empresas = await db.query.empresa.findMany({ columns: { id: true, nome: true } });
  if (!empresas.length) throw new Error("Nenhuma empresa cadastrada. Rode o seed antes.");

  const pedida = argumento("empresa");
  const empresa = pedida
    ? empresas.find(
        (e) => e.id === pedida || e.nome.toLowerCase() === pedida.toLowerCase(),
      )
    : empresas.length === 1
      ? empresas[0]
      : undefined;

  if (!empresa) {
    console.error(
      pedida
        ? `Empresa "${pedida}" não encontrada.`
        : "Há mais de uma empresa. Diga qual com --empresa \"Nome\".",
    );
    console.error("Empresas:", empresas.map((e) => e.nome).join(", "));
    process.exit(1);
  }

  const codigo = argumento("codigo") ?? (await perguntar(`Código novo para ${empresa.nome}: `));
  const normal = normalizarCodigo(codigo);
  if (normal.length < CODIGO_MINIMO || normal.length > CODIGO_MAXIMO) {
    console.error(`O código precisa ter de ${CODIGO_MINIMO} a ${CODIGO_MAXIMO} caracteres.`);
    process.exit(1);
  }

  const hash = hashDoCodigo(normal);
  const repetido = await db.query.empresa.findFirst({
    where: and(eq(schema.empresa.codigoAcessoHash, hash), ne(schema.empresa.id, empresa.id)),
    columns: { nome: true },
  });
  if (repetido) {
    console.error(`Esse código já é de outra empresa (${repetido.nome}). Escolha outro.`);
    process.exit(1);
  }

  await db
    .update(schema.empresa)
    .set({ codigoAcessoHash: hash })
    .where(eq(schema.empresa.id, empresa.id));

  console.log(`Código definido para ${empresa.nome}.`);
  console.log("Ele não fica salvo em lugar nenhum — só o hash, no banco. Guarde-o.");
  process.exit(0);
}

main().catch((erro) => {
  console.error("Falhou:", erro instanceof Error ? erro.message : erro);
  process.exit(1);
});
