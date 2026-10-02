"use server";

import { headers } from "next/headers";

import { solicitarCadastro } from "@/auth/cadastro";
import { consumir, MINUTO } from "@/app-movel/limitador";

export interface EstadoPedido {
  ok?: boolean;
  empresa?: string;
  mensagem?: string;
  campos?: Record<string, string>;
  /** Devolvidos para o formulário não apagar o que a pessoa digitou. Senha nunca volta. */
  valores?: { codigo: string; nome: string; cpf: string; email: string };
}

/**
 * "Solicitar acesso" do site: a mesma regra do cadastro do app, em
 * `@/auth/cadastro`, e o mesmo freio por IP — a conta de tentativas é
 * compartilhada entre app e site, para ninguém dobrar o limite trocando de porta.
 */
export async function pedirAcesso(_anterior: EstadoPedido, dados: FormData): Promise<EstadoPedido> {
  const valores = {
    codigo: String(dados.get("codigo") ?? "").slice(0, 100),
    nome: String(dados.get("nome") ?? "").slice(0, 120),
    cpf: String(dados.get("cpf") ?? "").slice(0, 20),
    email: String(dados.get("email") ?? "").slice(0, 254),
  };
  const senha = String(dados.get("senha") ?? "");
  const repetida = String(dados.get("repetida") ?? "");

  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0].trim() ?? h.get("x-real-ip") ?? "local";
  const limite = consumir(`cadastro:${ip}`, 10, 60 * MINUTO);
  if (!limite.ok) {
    return {
      mensagem: `Muitos pedidos seguidos daqui. Tente de novo em ${Math.ceil(limite.tenteEmSegundos / 60)} min.`,
      valores,
    };
  }

  if (senha && senha !== repetida) {
    return {
      mensagem: "Confira os campos marcados.",
      campos: { repetida: "As duas senhas não são iguais." },
      valores,
    };
  }

  const resultado = await solicitarCadastro({ ...valores, senha });
  if (!resultado.ok) {
    return { mensagem: resultado.mensagem, campos: resultado.campos, valores };
  }
  return { ok: true, empresa: resultado.empresa.nome };
}
