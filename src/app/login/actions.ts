"use server";

import { and, eq, isNotNull } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { cpfValido, normalizarCpf } from "@/auth/cpf";
import { conferirSenha, HASH_FANTASMA } from "@/auth/senha";
import { criarSessao, encerrarSessao } from "@/auth/sessao";
import { consumir, MINUTO, zerar } from "@/app-movel/limitador";
import { db } from "@/db";
import { usuario as usuarioTable } from "@/db/schema";

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

/** O IP de quem tenta, que o Caddy escreve no `x-forwarded-for`. */
async function ipAtual(): Promise<string> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0].trim() ?? h.get("x-real-ip") ?? "local";
}

/**
 * E-mail ou CPF: quem se cadastrou pelo celular entrou por CPF e muitas vezes
 * não tem e-mail — sem isto, essa pessoa nunca conseguiria abrir o site.
 *
 * CPF é único dentro da empresa, não no sistema todo. Se o mesmo CPF existir em
 * duas empresas (não acontece hoje, mas o banco permite), não há como saber qual
 * é a conta; aí só o e-mail serve.
 */
async function acharConta(identificador: string) {
  if (identificador.includes("@")) {
    return db.query.usuario.findFirst({ where: eq(usuarioTable.email, identificador) });
  }
  const cpf = normalizarCpf(identificador);
  if (!cpfValido(cpf)) return undefined;
  const contas = await db.query.usuario.findMany({
    where: and(eq(usuarioTable.cpf, cpf), isNotNull(usuarioTable.cpf)),
    limit: 2,
  });
  return contas.length === 1 ? contas[0] : undefined;
}

export async function entrar(dados: FormData): Promise<void> {
  const identificador = String(dados.get("email") ?? "").trim().toLowerCase();
  const senha = String(dados.get("senha") ?? "");

  if (!identificador || !senha) {
    redirect("/login?erro=vazio");
  }

  /**
   * Dois freios: por conta (quem tenta adivinhar a senha de uma pessoa) e por
   * IP (quem varre várias contas). O de IP é largo de propósito — o escritório
   * inteiro sai pelo mesmo IP e não pode ser trancado por uma pessoa distraída.
   */
  const ip = await ipAtual();
  const porConta = consumir(`login:${identificador}`, 8, 15 * MINUTO);
  const porIp = consumir(`login-ip:${ip}`, 40, 15 * MINUTO);
  if (!porConta.ok || !porIp.ok) {
    redirect("/login?erro=tentativas");
  }

  const encontrado = await acharConta(identificador);
  const confere = await conferirSenha(senha, encontrado?.senhaHash ?? HASH_FANTASMA);

  // Mensagem única de propósito: dizer "usuário não existe" entregaria a quem
  // tenta adivinhar quais e-mails são válidos.
  if (!encontrado || !confere) {
    redirect("/login?erro=credenciais");
  }

  // Daqui em diante a senha confere, então dizer a situação da conta não
  // entrega nada a um estranho — e poupa a pessoa de achar que errou a senha.
  if (!encontrado.aprovadoEm) redirect("/login?erro=pendente");
  if (!encontrado.ativo) redirect("/login?erro=desativada");

  zerar(`login:${identificador}`);
  await criarSessao(encontrado.id);
  redirect("/");
}

export async function sair(): Promise<void> {
  await encerrarSessao();
  redirect("/login");
}
