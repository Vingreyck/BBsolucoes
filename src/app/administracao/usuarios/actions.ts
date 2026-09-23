"use server";

import { randomBytes } from "node:crypto";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { gerarHash } from "@/auth/senha";
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

/**
 * Senha provisória legível, gerada por sorteio.
 *
 * Sem `0/O` e `1/l/I`, porque ela vai ser lida em voz alta ou mandada por
 * mensagem, e confundir zero com ó é o jeito mais rápido de gerar um chamado.
 * Ela vale uma vez: a pessoa é obrigada a trocar no primeiro acesso.
 */
function senhaProvisoria(): string {
  const letras = "abcdefghjkmnpqrstuvwxyz";
  const numeros = "23456789";
  const alfabeto = letras + letras.toUpperCase() + numeros;
  const bytes = randomBytes(10);
  return [...bytes].map((b) => alfabeto[b % alfabeto.length]).join("");
}

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
    columns: { id: true, ativo: true },
  });
  if (!alvo) return;

  await db
    .update(schema.usuario)
    .set({ ativo: !alvo.ativo })
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
