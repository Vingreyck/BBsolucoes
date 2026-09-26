import { createHash } from "node:crypto";

import { and, eq } from "drizzle-orm";

import { db, schema } from "@/db";

/**
 * O código que cada empresa recebe do desenvolvedor para cadastrar a equipe.
 *
 * É ele que decide em qual empresa um cadastro feito pelo app vai cair. Não é
 * senha de ninguém — o cadastro ainda precisa ser aprovado por um
 * administrador —, mas é o portão, então só o hash vai para o banco.
 *
 * A normalização existe por causa do teclado do celular: o Android põe a
 * primeira letra em maiúscula sozinho, e o técnico pode digitar "Soluções"
 * com cedilha. Os três jeitos precisam dar no mesmo código.
 */

export function normalizarCodigo(bruto: string): string {
  return bruto
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, "");
}

export function hashDoCodigo(bruto: string): string {
  return createHash("sha256").update(normalizarCodigo(bruto)).digest("hex");
}

export const CODIGO_MINIMO = 6;
export const CODIGO_MAXIMO = 64;

/** A empresa ativa dona do código, ou null. */
export async function empresaPeloCodigo(
  bruto: string,
): Promise<{ id: string; nome: string } | null> {
  const normal = normalizarCodigo(bruto);
  if (normal.length < CODIGO_MINIMO || normal.length > CODIGO_MAXIMO) return null;

  const empresa = await db.query.empresa.findFirst({
    where: and(
      eq(schema.empresa.codigoAcessoHash, hashDoCodigo(normal)),
      eq(schema.empresa.ativa, true),
    ),
    columns: { id: true, nome: true },
  });
  return empresa ?? null;
}
