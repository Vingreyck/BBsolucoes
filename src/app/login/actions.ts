"use server";

import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";

import { conferirSenha } from "@/auth/senha";
import { criarSessao, encerrarSessao } from "@/auth/sessao";
import { db } from "@/db";
import { usuario as usuarioTable } from "@/db/schema";

/**
 * Hash descartável usado quando o e-mail não existe.
 *
 * Sem isto, e-mail inexistente responderia na hora e senha errada demoraria o
 * tempo do scrypt — e essa diferença de tempo permitiria descobrir quais
 * e-mails estão cadastrados. Conferir contra um hash falso iguala os dois casos.
 */
const HASH_FANTASMA =
  "scrypt$AAAAAAAAAAAAAAAAAAAAAA==$" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

/**
 * Login sem depender de JavaScript.
 *
 * A primeira versão usava `useActionState` num componente cliente, e a mensagem
 * de erro nunca aparecia: enquanto o React não hidrata, o formulário faz um POST
 * nativo e o estado devolvido pela action se perde. Numa tela de login isso é
 * inaceitável — é a primeira coisa que carrega, muitas vezes em rede ruim, e
 * ficar sem resposta ao errar a senha faz o usuário achar que o sistema travou.
 *
 * Erro volta por redirecionamento com parâmetro na URL, que funciona hidratado
 * ou não.
 */
export async function entrar(dados: FormData): Promise<void> {
  const email = String(dados.get("email") ?? "").trim().toLowerCase();
  const senha = String(dados.get("senha") ?? "");

  if (!email || !senha) {
    redirect("/login?erro=vazio");
  }

  const encontrado = await db.query.usuario.findFirst({
    where: eq(usuarioTable.email, email),
  });

  const confere = await conferirSenha(senha, encontrado?.senhaHash ?? HASH_FANTASMA);

  // Mensagem única de propósito: dizer "usuário não existe" entregaria a quem
  // tenta adivinhar quais e-mails são válidos.
  if (!encontrado || !confere || !encontrado.ativo) {
    redirect("/login?erro=credenciais");
  }

  await criarSessao(encontrado.id);
  redirect("/");
}

export async function sair(): Promise<void> {
  await encerrarSessao();
  redirect("/login");
}
