import { createHash, randomBytes } from "node:crypto";

import { and, eq, gt, lt, ne } from "drizzle-orm";

import { ehPapelApp, type PapelApp } from "@/app-movel/permissoes";
import { db } from "@/db";
import {
  empresa as empresaTable,
  sessao as sessaoTable,
  usuario as usuarioTable,
} from "@/db/schema";

/**
 * Sessão do app: a mesma tabela do navegador, com outro portador.
 *
 * O navegador leva o token num cookie; o app leva no cabeçalho
 * `Authorization: Bearer`. No banco fica o SHA-256 do token, como sempre — se
 * o banco vazar, ninguém monta um token válido a partir dele. E continua
 * revogável: desativar alguém é apagar as linhas dele aqui.
 *
 * A duração é deslizante. Enquanto o técnico usa o app, a sessão se renova
 * sozinha; só pede senha de novo quem ficou 60 dias sem abrir. O SeeNet ensinou
 * o preço de pedir login toda hora: o técnico passa a anotar a senha no celular.
 */

const DURACAO_DIAS = 60;
/** Só regrava a validade quando faltar menos que isto — evita escrita a cada tela. */
const RENOVAR_QUANDO_FALTAR_DIAS = 30;
const DIA = 86_400_000;
const HORA = 3_600_000;

function digerir(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function criarSessaoApp(
  usuarioId: string,
  dispositivo: string | null,
): Promise<{ token: string; expiraEm: Date }> {
  const token = randomBytes(32).toString("base64url");
  const agora = new Date();
  const expiraEm = new Date(agora.getTime() + DURACAO_DIAS * DIA);

  await db.insert(sessaoTable).values({
    id: digerir(token),
    usuarioId,
    expiraEm,
    origem: "app",
    dispositivo,
    ultimoUsoEm: agora,
  });

  // Aproveita a escrita para limpar o que já venceu, sem cron só para isso.
  await db.delete(sessaoTable).where(lt(sessaoTable.expiraEm, agora));

  return { token, expiraEm };
}

export interface UsuarioApp {
  id: string;
  nome: string;
  cpf: string;
  email: string | null;
  papel: PapelApp;
  empresaId: string;
  empresaNome: string;
  deveTrocarSenha: boolean;
  /** Hash do token desta sessão — para trocar a senha sem derrubar a própria. */
  sessaoId: string;
}

/** O token do cabeçalho, se ele tiver a cara de um token nosso. */
export function tokenDaRequisicao(req: Request): string | null {
  const cabecalho = req.headers.get("authorization") ?? "";
  const achado = /^Bearer\s+([A-Za-z0-9_-]{20,200})$/.exec(cabecalho.trim());
  return achado ? achado[1] : null;
}

/**
 * Quem está chamando, ou null.
 *
 * Confere tudo a cada chamada, direto no banco: sessão válida e do app, pessoa
 * ativa **e** aprovada, papel que usa o app, empresa ativa. Desativar alguém
 * derruba o acesso na próxima tela, sem esperar o token vencer.
 */
export async function autenticarApp(req: Request): Promise<UsuarioApp | null> {
  const token = tokenDaRequisicao(req);
  if (!token) return null;

  const id = digerir(token);
  const agora = new Date();

  const [linha] = await db
    .select({
      id: usuarioTable.id,
      nome: usuarioTable.nome,
      cpf: usuarioTable.cpf,
      email: usuarioTable.email,
      papel: usuarioTable.papel,
      ativo: usuarioTable.ativo,
      aprovadoEm: usuarioTable.aprovadoEm,
      deveTrocarSenha: usuarioTable.deveTrocarSenha,
      empresaId: empresaTable.id,
      empresaNome: empresaTable.nome,
      empresaAtiva: empresaTable.ativa,
      expiraEm: sessaoTable.expiraEm,
      ultimoUsoEm: sessaoTable.ultimoUsoEm,
    })
    .from(sessaoTable)
    .innerJoin(usuarioTable, eq(usuarioTable.id, sessaoTable.usuarioId))
    .innerJoin(empresaTable, eq(empresaTable.id, usuarioTable.empresaId))
    .where(
      and(
        eq(sessaoTable.id, id),
        eq(sessaoTable.origem, "app"),
        gt(sessaoTable.expiraEm, agora),
      ),
    )
    .limit(1);

  if (!linha) return null;
  if (!linha.ativo || !linha.aprovadoEm || !linha.empresaAtiva) return null;
  if (!linha.cpf || !ehPapelApp(linha.papel)) return null;

  const falta = linha.expiraEm.getTime() - agora.getTime();
  if (falta < RENOVAR_QUANDO_FALTAR_DIAS * DIA) {
    await db
      .update(sessaoTable)
      .set({ expiraEm: new Date(agora.getTime() + DURACAO_DIAS * DIA), ultimoUsoEm: agora })
      .where(eq(sessaoTable.id, id));
  } else if (!linha.ultimoUsoEm || agora.getTime() - linha.ultimoUsoEm.getTime() > HORA) {
    await db.update(sessaoTable).set({ ultimoUsoEm: agora }).where(eq(sessaoTable.id, id));
  }

  return {
    id: linha.id,
    nome: linha.nome,
    cpf: linha.cpf,
    email: linha.email,
    papel: linha.papel,
    empresaId: linha.empresaId,
    empresaNome: linha.empresaNome,
    deveTrocarSenha: linha.deveTrocarSenha,
    sessaoId: id,
  };
}

/** Sair: apaga a sessão deste token, e só dela. */
export async function encerrarSessaoApp(req: Request): Promise<void> {
  const token = tokenDaRequisicao(req);
  if (!token) return;
  await db
    .delete(sessaoTable)
    .where(and(eq(sessaoTable.id, digerir(token)), eq(sessaoTable.origem, "app")));
}

/** Derruba todas as sessões da pessoa, menos a que está pedindo. */
export async function encerrarOutrasSessoes(
  usuarioId: string,
  manterSessaoId: string,
): Promise<void> {
  await db
    .delete(sessaoTable)
    .where(and(eq(sessaoTable.usuarioId, usuarioId), ne(sessaoTable.id, manterSessaoId)));
}
