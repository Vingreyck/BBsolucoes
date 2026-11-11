import { createHash, randomBytes } from "node:crypto";

import { and, eq, gt, lt } from "drizzle-orm";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { db } from "@/db";
import { sessao as sessaoTable, usuario as usuarioTable } from "@/db/schema";

import { COOKIE_SESSAO } from "./constantes";
import { mfaAtivo } from "./mfa";

export { COOKIE_SESSAO };

/** Quanto tempo o login dura sem precisar entrar de novo. */
const DURACAO_DIAS = 30;

/** O que vai para o banco é o hash do token, nunca o token. */
function digerir(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * `mfaValidaAte`: até quando o código do aplicativo autenticador vale para esta
 * sessão. A sessão **nunca passa disso**: é o que faz o código voltar a ser pedido
 * ao fim de 30 dias (ou das 12 horas, para quem não confiou no aparelho). Sem ele,
 * a sessão é de antes do 2FA e só vale enquanto ele estiver desligado.
 */
export async function criarSessao(usuarioId: string, opcoes: { mfaValidaAte?: Date } = {}): Promise<void> {
  const token = randomBytes(32).toString("base64url");
  const limite = Date.now() + DURACAO_DIAS * 86_400_000;
  const expiraEm = new Date(opcoes.mfaValidaAte ? Math.min(limite, opcoes.mfaValidaAte.getTime()) : limite);

  await db.insert(sessaoTable).values({
    id: digerir(token),
    usuarioId,
    expiraEm,
    origem: "web",
    mfaValidaAte: opcoes.mfaValidaAte ?? null,
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
  /** Nulo para quem se cadastrou pelo app sem e-mail — esse não entra por aqui. */
  email: string | null;
  papel: string;
  empresaId: string;
  /** Senha provisória: não pode ver nada antes de trocar. */
  deveTrocarSenha: boolean;
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
      deveTrocarSenha: usuarioTable.deveTrocarSenha,
      ativo: usuarioTable.ativo,
      aprovadoEm: usuarioTable.aprovadoEm,
      mfaValidaAte: sessaoTable.mfaValidaAte,
    })
    .from(sessaoTable)
    .innerJoin(usuarioTable, eq(usuarioTable.id, sessaoTable.usuarioId))
    .where(
      and(
        eq(sessaoTable.id, digerir(token)),
        // Token do app não vale como cookie do navegador, e vice-versa.
        eq(sessaoTable.origem, "web"),
        gt(sessaoTable.expiraEm, new Date()),
      ),
    )
    .limit(1);

  const usuario = linha[0];
  // Desativar um usuário derruba o acesso na hora, sem esperar a sessão vencer.
  // Cadastro do app ainda não aprovado também não passa, mesmo que um dia tenha
  // sessão — é a segunda tranca, além do `ativo`.
  if (!usuario || !usuario.ativo || !usuario.aprovadoEm) return null;

  // Segundo fator ligado: sessão sem código válido não vale — nem a de antes de
  // ele existir (ligar o 2FA deixa todo mundo entrar de novo, uma vez) nem a que
  // passou dos 30 dias.
  if (mfaAtivo() && (!usuario.mfaValidaAte || usuario.mfaValidaAte.getTime() <= Date.now())) return null;

  return {
    id: usuario.id,
    nome: usuario.nome,
    email: usuario.email,
    papel: usuario.papel,
    empresaId: usuario.empresaId,
    deveTrocarSenha: usuario.deveTrocarSenha,
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

  /**
   * Senha provisória barra tudo, e é aqui que barra.
   *
   * Podia ser no middleware, e não seria suficiente: o middleware do Next roda
   * no Edge e só olha se o cookie existe, sem falar com o banco. Quem precisa
   * decidir isso é quem já tem o usuário em mãos — e é esta função que toda
   * tela chama.
   *
   * A própria tela de troca usa `usuarioAtual()` em vez desta, senão ela
   * redirecionaria para si mesma para sempre.
   */
  if (usuario.deveTrocarSenha) redirect("/trocar-senha");
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
