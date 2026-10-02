import { and, asc, eq, isNotNull, isNull, ne } from "drizzle-orm";

import { formatarCpf, ocultarCpf } from "@/auth/cpf";
import { gerarHash, gerarSenhaProvisoria } from "@/auth/senha";
import type { UsuarioApp } from "@/auth/sessao-app";
import { db } from "@/db";
import { sessao as sessaoTable, usuario as usuarioTable } from "@/db/schema";

import { ehPapelApp, type PapelApp } from "./permissoes";

/**
 * A equipe vista pelo administrador no app.
 *
 * Tudo aqui é da empresa de quem pede — o `empresaId` vem da sessão, nunca do
 * corpo da requisição. Um administrador da BB não enxerga nem por acidente a
 * equipe de outra integradora.
 *
 * Ninguém mexe na própria conta por aqui (o próprio perfil tem a troca de
 * senha), e a empresa nunca fica sem um administrador ativo: é o que impede o
 * último adm de se trancar para fora, junto com todo mundo.
 */

export type ResultadoEquipe =
  | { ok: true; senhaProvisoria?: string }
  | { ok: false; status: number; erro: string; mensagem: string };

function negar(status: number, erro: string, mensagem: string): ResultadoEquipe {
  return { ok: false, status, erro, mensagem };
}

export async function equipeDaEmpresa(empresaId: string) {
  const todos = await db.query.usuario.findMany({
    where: eq(usuarioTable.empresaId, empresaId),
    orderBy: asc(usuarioTable.nome),
    columns: {
      id: true,
      nome: true,
      cpf: true,
      email: true,
      papel: true,
      ativo: true,
      deveTrocarSenha: true,
      aprovadoEm: true,
      criadoEm: true,
    },
  });

  const serializar = (u: (typeof todos)[number]) => ({
    id: u.id,
    nome: u.nome,
    cpf: u.cpf ? formatarCpf(u.cpf) : null,
    cpfOculto: u.cpf ? ocultarCpf(u.cpf) : null,
    email: u.email,
    papel: u.papel,
    ativo: u.ativo,
    senhaProvisoria: u.deveTrocarSenha,
    /** Tem CPF e um papel que entra no app. Os outros usam só o navegador. */
    usaApp: Boolean(u.cpf) && ehPapelApp(u.papel),
    criadoEm: u.criadoEm.toISOString(),
    aprovadoEm: u.aprovadoEm?.toISOString() ?? null,
  });

  return {
    pendentes: todos.filter((u) => !u.aprovadoEm).map(serializar),
    membros: todos.filter((u) => u.aprovadoEm).map(serializar),
  };
}

async function alvoDaEmpresa(adm: UsuarioApp, id: string) {
  return db.query.usuario.findFirst({
    where: and(eq(usuarioTable.id, id), eq(usuarioTable.empresaId, adm.empresaId)),
    columns: { id: true, nome: true, papel: true, ativo: true, aprovadoEm: true },
  });
}

/** Sobra algum outro administrador ativo além de `excetoId`? */
async function temOutroAdm(empresaId: string, excetoId: string): Promise<boolean> {
  const outro = await db.query.usuario.findFirst({
    where: and(
      eq(usuarioTable.empresaId, empresaId),
      eq(usuarioTable.papel, "adm"),
      eq(usuarioTable.ativo, true),
      isNotNull(usuarioTable.aprovadoEm),
      ne(usuarioTable.id, excetoId),
    ),
    columns: { id: true },
  });
  return Boolean(outro);
}

export async function aprovarCadastro(
  adm: UsuarioApp,
  id: string,
  papel: string,
): Promise<ResultadoEquipe> {
  if (!ehPapelApp(papel)) return negar(400, "validacao", "Escolha técnico, vendedor, engenheiro ou administrador.");

  const alvo = await alvoDaEmpresa(adm, id);
  if (!alvo) return negar(404, "nao_encontrado", "Cadastro não encontrado.");
  if (alvo.aprovadoEm) return negar(409, "ja_aprovado", `${alvo.nome} já foi aprovado.`);

  await db
    .update(usuarioTable)
    .set({ ativo: true, papel, aprovadoEm: new Date(), aprovadoPorId: adm.id })
    .where(eq(usuarioTable.id, id));
  return { ok: true };
}

/**
 * Recusar apaga o pedido.
 *
 * Pode apagar porque um cadastro que nunca foi aprovado não deixou rastro em
 * nada — não enviou documento, não anotou serial. Conta aprovada nunca é
 * apagada, só desativada.
 */
export async function recusarCadastro(adm: UsuarioApp, id: string): Promise<ResultadoEquipe> {
  const apagados = await db
    .delete(usuarioTable)
    .where(
      and(
        eq(usuarioTable.id, id),
        eq(usuarioTable.empresaId, adm.empresaId),
        isNull(usuarioTable.aprovadoEm),
      ),
    )
    .returning({ id: usuarioTable.id });
  if (!apagados.length) return negar(404, "nao_encontrado", "Cadastro não encontrado.");
  return { ok: true };
}

export async function alterarMembro(
  adm: UsuarioApp,
  id: string,
  mudanca: { papel?: string; ativo?: boolean },
): Promise<ResultadoEquipe> {
  if (id === adm.id) {
    return negar(409, "propria_conta", "Você não pode mudar a própria conta por aqui.");
  }
  if (mudanca.papel !== undefined && !ehPapelApp(mudanca.papel)) {
    return negar(400, "validacao", "Escolha técnico, vendedor, engenheiro ou administrador.");
  }

  const alvo = await alvoDaEmpresa(adm, id);
  if (!alvo || !alvo.aprovadoEm) return negar(404, "nao_encontrado", "Pessoa não encontrada.");

  const deixaDeSerAdm =
    alvo.papel === "adm" &&
    ((mudanca.papel !== undefined && mudanca.papel !== "adm") || mudanca.ativo === false);
  if (deixaDeSerAdm && !(await temOutroAdm(adm.empresaId, alvo.id))) {
    return negar(409, "ultimo_adm", "A empresa precisa de pelo menos um administrador ativo.");
  }

  const novo: { papel?: PapelApp; ativo?: boolean } = {};
  if (mudanca.papel !== undefined) novo.papel = mudanca.papel as PapelApp;
  if (mudanca.ativo !== undefined) novo.ativo = mudanca.ativo;
  if (!Object.keys(novo).length) return { ok: true };

  await db.update(usuarioTable).set(novo).where(eq(usuarioTable.id, id));

  // Desativar derruba as sessões na hora — app e navegador.
  if (mudanca.ativo === false) {
    await db.delete(sessaoTable).where(eq(sessaoTable.usuarioId, id));
  }
  return { ok: true };
}

/** Esqueceu a senha: sorteia uma provisória, que só vale até o próximo login. */
export async function redefinirSenha(adm: UsuarioApp, id: string): Promise<ResultadoEquipe> {
  if (id === adm.id) {
    return negar(409, "propria_conta", "Para trocar a sua senha, use o seu perfil.");
  }
  const alvo = await alvoDaEmpresa(adm, id);
  if (!alvo || !alvo.aprovadoEm) return negar(404, "nao_encontrado", "Pessoa não encontrada.");

  const senha = gerarSenhaProvisoria();
  await db
    .update(usuarioTable)
    .set({ senhaHash: await gerarHash(senha), deveTrocarSenha: true })
    .where(eq(usuarioTable.id, id));
  await db.delete(sessaoTable).where(eq(sessaoTable.usuarioId, id));

  return { ok: true, senhaProvisoria: senha };
}
