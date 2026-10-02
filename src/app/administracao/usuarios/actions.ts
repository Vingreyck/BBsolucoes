"use server";

import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { gerarHash, gerarSenhaProvisoria } from "@/auth/senha";
import { exigirUsuario } from "@/auth/sessao";
import { db, schema } from "@/db";

/**
 * Contas nominais, uma por pessoa.
 *
 * Até aqui o sistema tinha cinco contas genéricas — um `tecnico` para todos os
 * técnicos, um `vendas` para todas as atendentes — com a mesma senha, escrita
 * no SETUP.md de um repositório público.
 *
 * Isso quebrava duas coisas de uma vez. A óbvia: qualquer pessoa que achasse o
 * repositório entrava como administrador. A silenciosa: a trilha de
 * `documento_acesso` e o `registrado_por` do serial diziam só "Técnico", sem
 * dizer qual — e trilha que não identifica ninguém não serve para nada.
 */

/** Só quem responde pela empresa mexe em conta de gente. */
async function exigirAdm() {
  const usuario = await exigirUsuario();
  if (usuario.papel !== "adm") redirect("/sem-acesso");
  return usuario;
}

/** Sorteada em `@/auth/senha`, a mesma que o app usa. */
const senhaProvisoria = gerarSenhaProvisoria;

const PAPEIS = new Set(["adm", "vendedor", "engenheiro", "tecnico", "estoque"]);

export interface ResultadoUsuario {
  erro?: string;
  /** Mostrada uma vez na tela, para o adm entregar à pessoa. */
  senha?: string;
  nome?: string;
}

export async function criarUsuario(
  _anterior: ResultadoUsuario,
  dados: FormData,
): Promise<ResultadoUsuario> {
  const adm = await exigirAdm();

  const nome = String(dados.get("nome") ?? "").trim();
  const email = String(dados.get("email") ?? "").trim().toLowerCase();
  const papel = String(dados.get("papel") ?? "");

  if (!nome) return { erro: "Digite o nome da pessoa." };
  if (!email.includes("@")) return { erro: "Digite um e-mail válido." };
  if (!PAPEIS.has(papel)) return { erro: "Escolha o papel." };

  const jaTem = await db.query.usuario.findFirst({
    where: eq(schema.usuario.email, email),
    columns: { id: true },
  });
  if (jaTem) return { erro: "Já existe uma conta com esse e-mail." };

  const senha = senhaProvisoria();
  await db.insert(schema.usuario).values({
    empresaId: adm.empresaId,
    nome,
    email,
    senhaHash: await gerarHash(senha),
    papel: papel as never,
    telefone: String(dados.get("telefone") ?? "").trim() || null,
    deveTrocarSenha: true,
    // Foi o próprio administrador que criou: já nasce aprovada.
    aprovadoEm: new Date(),
    aprovadoPorId: adm.id,
  });

  revalidatePath("/administracao/usuarios");
  return { senha, nome };
}

/**
 * Desativa em vez de apagar.
 *
 * Apagar o usuário levaria junto quem enviou cada documento e quem anotou cada
 * serial — a trilha some justo quando alguém sai da empresa, que é quando ela
 * mais importa. Desativado não entra mais e continua nomeado no histórico.
 */
export async function alternarAtivo(usuarioId: string): Promise<void> {
  const adm = await exigirAdm();
  if (usuarioId === adm.id) return; // ninguém se tranca para fora

  const alvo = await db.query.usuario.findFirst({
    where: and(
      eq(schema.usuario.id, usuarioId),
      eq(schema.usuario.empresaId, adm.empresaId),
    ),
    columns: { id: true, ativo: true, aprovadoEm: true },
  });
  if (!alvo) return;

  // Pedido de acesso se aprova em `aprovarPedido`, escolhendo o papel. Se mesmo
  // assim chegar aqui, aprova com o papel que o cadastro traz (técnico).
  const aprovacao =
    !alvo.ativo && !alvo.aprovadoEm ? { aprovadoEm: new Date(), aprovadoPorId: adm.id } : {};

  await db
    .update(schema.usuario)
    .set({ ativo: !alvo.ativo, ...aprovacao })
    .where(eq(schema.usuario.id, usuarioId));

  // Desativar derruba a sessão na hora, sem esperar o cookie vencer.
  if (alvo.ativo) {
    await db.delete(schema.sessao).where(eq(schema.sessao.usuarioId, usuarioId));
  }

  revalidatePath("/administracao/usuarios");
}

/** Esqueceu a senha: gera outra provisória e obriga a trocar de novo. */
export async function reiniciarSenha(
  _anterior: ResultadoUsuario,
  dados: FormData,
): Promise<ResultadoUsuario> {
  const adm = await exigirAdm();
  const usuarioId = String(dados.get("usuarioId") ?? "");

  const alvo = await db.query.usuario.findFirst({
    where: and(
      eq(schema.usuario.id, usuarioId),
      eq(schema.usuario.empresaId, adm.empresaId),
    ),
    columns: { id: true, nome: true },
  });
  if (!alvo) return { erro: "Usuário não encontrado." };

  const senha = senhaProvisoria();
  await db
    .update(schema.usuario)
    .set({ senhaHash: await gerarHash(senha), deveTrocarSenha: true })
    .where(eq(schema.usuario.id, usuarioId));

  await db.delete(schema.sessao).where(eq(schema.sessao.usuarioId, usuarioId));

  revalidatePath("/administracao/usuarios");
  return { senha, nome: alvo.nome };
}

/**
 * Pedido de acesso (do app ou do site): o administrador libera e escolhe o
 * papel na mesma hora. A pessoa nunca escolhe o próprio papel.
 */
export async function aprovarPedido(dados: FormData): Promise<void> {
  const adm = await exigirAdm();
  const usuarioId = String(dados.get("usuarioId") ?? "");
  const papel = String(dados.get("papel") ?? "");
  if (!PAPEIS.has(papel)) return;

  await db
    .update(schema.usuario)
    .set({ papel: papel as never, ativo: true, aprovadoEm: new Date(), aprovadoPorId: adm.id })
    .where(
      and(
        eq(schema.usuario.id, usuarioId),
        eq(schema.usuario.empresaId, adm.empresaId),
        isNull(schema.usuario.aprovadoEm),
      ),
    );

  revalidatePath("/administracao/usuarios");
  revalidatePath("/", "layout");
}

/**
 * Recusar apaga o pedido — e só o pedido.
 *
 * Conta que já foi aprovada nunca se apaga (ver `alternarAtivo`), mas um pedido
 * nunca liberado não fez nada no sistema: não há trilha para preservar, e
 * guardá-lo só deixaria o CPF de um estranho parado no banco.
 */
export async function recusarPedido(dados: FormData): Promise<void> {
  const adm = await exigirAdm();
  const usuarioId = String(dados.get("usuarioId") ?? "");

  await db
    .delete(schema.usuario)
    .where(
      and(
        eq(schema.usuario.id, usuarioId),
        eq(schema.usuario.empresaId, adm.empresaId),
        isNull(schema.usuario.aprovadoEm),
      ),
    );

  revalidatePath("/administracao/usuarios");
  revalidatePath("/", "layout");
}

/** Troca o papel de quem já tem conta. O próprio adm não troca o seu: não se tranca para fora. */
export async function mudarPapel(dados: FormData): Promise<void> {
  const adm = await exigirAdm();
  const usuarioId = String(dados.get("usuarioId") ?? "");
  const papel = String(dados.get("papel") ?? "");
  if (!PAPEIS.has(papel) || usuarioId === adm.id) return;

  await db
    .update(schema.usuario)
    .set({ papel: papel as never })
    .where(and(eq(schema.usuario.id, usuarioId), eq(schema.usuario.empresaId, adm.empresaId)));

  // As permissões do app vêm no login: derrubar as sessões faz a pessoa entrar
  // de novo já com o papel novo, em vez de seguir com o antigo até sair.
  await db.delete(schema.sessao).where(eq(schema.sessao.usuarioId, usuarioId));

  revalidatePath("/administracao/usuarios");
}
