import { createHash, randomBytes } from "node:crypto";

import { and, eq, gt, lt } from "drizzle-orm";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { db } from "@/db";
import { sessao as sessaoTable, usuario as usuarioTable } from "@/db/schema";

import { COOKIE_SESSAO } from "./constantes";

export { COOKIE_SESSAO };

/** Quanto tempo o login dura sem precisar entrar de novo. */
const DURACAO_DIAS = 30;

/** O que vai para o banco é o hash do token, nunca o token. */
function digerir(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function criarSessao(usuarioId: string): Promise<void> {
  const token = randomBytes(32).toString("base64url");
  const expiraEm = new Date(Date.now() + DURACAO_DIAS * 86_400_000);

  await db.insert(sessaoTable).values({
    id: digerir(token),
    usuarioId,
    expiraEm,
  });

  const jar = await cookies();
  jar.set(COOKIE_SESSAO, token, {
    httpOnly: true,
    sameSite: "lax",
    // Em produção o cookie só trafega por HTTPS; em desenvolvimento o servidor
    // é HTTP e com `secure` ligado o navegador simplesmente não o guardaria.
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiraEm,
  });

  // Aproveita a escrita para limpar o que já venceu, evitando um cron só para isso.
  await db.delete(sessaoTable).where(lt(sessaoTable.expiraEm, new Date()));
}

export interface UsuarioSessao {
  id: string;
  nome: string;
  email: string;
  papel: string;
  empresaId: string;
}

/** Usuário da requisição atual, ou null se não há sessão válida. */
export async function usuarioAtual(): Promise<UsuarioSessao | null> {
  const jar = await cookies();
  const token = jar.get(COOKIE_SESSAO)?.value;
  if (!token) return null;

  const linha = await db
    .select({
      id: usuarioTable.id,
      nome: usuarioTable.nome,
      email: usuarioTable.email,
      papel: usuarioTable.papel,
      empresaId: usuarioTable.empresaId,
      ativo: usuarioTable.ativo,
    })
    .from(sessaoTable)
    .innerJoin(usuarioTable, eq(usuarioTable.id, sessaoTable.usuarioId))
    .where(and(eq(sessaoTable.id, digerir(token)), gt(sessaoTable.expiraEm, new Date())))
    .limit(1);

  const usuario = linha[0];
  // Desativar um usuário derruba o acesso na hora, sem esperar a sessão vencer.
  if (!usuario || !usuario.ativo) return null;

  return {
    id: usuario.id,
    nome: usuario.nome,
    email: usuario.email,
    papel: usuario.papel,
    empresaId: usuario.empresaId,
  };
}

/**
 * Exige sessão válida ou manda para o login.
 *
 * É esta função — e não o middleware — que de fato protege as páginas: ela
 * confere a sessão no banco. Toda página que mostra dado de cliente precisa
 * chamá-la.
 */
export async function exigirUsuario(): Promise<UsuarioSessao> {
  const usuario = await usuarioAtual();
  if (!usuario) redirect("/login");
  return usuario;
}

export async function encerrarSessao(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(COOKIE_SESSAO)?.value;
  if (token) {
    await db.delete(sessaoTable).where(eq(sessaoTable.id, digerir(token)));
  }
  jar.delete(COOKIE_SESSAO);
}
