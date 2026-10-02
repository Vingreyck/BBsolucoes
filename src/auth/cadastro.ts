import { and, eq } from "drizzle-orm";

import { cpfValido, normalizarCpf } from "@/auth/cpf";
import { problemaNaSenha } from "@/auth/politica-senha";
import { gerarHash } from "@/auth/senha";
import { db } from "@/db";
import { usuario as usuarioTable } from "@/db/schema";
import { empresaPeloCodigo } from "@/empresa/codigo-acesso";

/**
 * Pedido de acesso feito pela própria pessoa — pelo celular ou pelo site.
 *
 * Pede o que o dono do sistema definiu: nome completo, CPF, e-mail opcional e
 * o código da empresa — mais a senha, que é o que impede qualquer um que saiba
 * o CPF de outra pessoa (e CPF está em todo projeto, contrato e grupo de
 * WhatsApp) de entrar no lugar dela.
 *
 * O cadastro nasce desativado e **sem papel escolhido pela pessoa**: o
 * administrador da empresa aprova e decide o papel. Quem escolhesse o próprio
 * papel no cadastro escolheria "adm".
 *
 * Mora aqui, e não na rota do app, para o site e o app seguirem a mesma regra.
 */

const PARTICULAS = new Set(["da", "das", "de", "di", "do", "dos", "e"]);

/** "vinícius LIMA dos santos" → "Vinícius Lima dos Santos" */
export function capitalizarNome(nome: string): string {
  return nome
    .toLocaleLowerCase("pt-BR")
    .split(" ")
    .map((parte, i) =>
      i > 0 && PARTICULAS.has(parte)
        ? parte
        : parte.charAt(0).toLocaleUpperCase("pt-BR") + parte.slice(1),
    )
    .join(" ");
}

export const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export interface PedidoCadastro {
  codigo: string;
  nome: string;
  cpf: string;
  email: string;
  senha: string;
}

export type ResultadoCadastro =
  | { ok: true; empresa: { nome: string } }
  | {
      ok: false;
      status: number;
      codigo: string;
      mensagem: string;
      campos?: Record<string, string>;
    };

export async function solicitarCadastro(pedido: PedidoCadastro): Promise<ResultadoCadastro> {
  const codigo = pedido.codigo.trim();
  const nome = pedido.nome.trim().replace(/\s+/g, " ");
  const cpf = normalizarCpf(pedido.cpf);
  const email = pedido.email.trim().toLowerCase();
  const senha = pedido.senha;

  const campos: Record<string, string> = {};
  if (nome.length < 5 || !nome.includes(" ")) campos.nome = "Digite o nome completo.";
  if (!cpfValido(cpf)) campos.cpf = "Esse CPF não é válido. Confira os números.";
  if (email && !EMAIL.test(email)) campos.email = "Esse e-mail não parece certo.";
  const problemaSenha = problemaNaSenha(senha, { cpf });
  if (problemaSenha) campos.senha = problemaSenha;
  if (!codigo) campos.codigo = "Falta o código da empresa.";

  if (Object.keys(campos).length) {
    return { ok: false, status: 400, codigo: "validacao", mensagem: "Confira os campos marcados.", campos };
  }

  const empresa = await empresaPeloCodigo(codigo);
  if (!empresa) {
    return {
      ok: false,
      status: 404,
      codigo: "codigo_invalido",
      mensagem: "O código da empresa não confere.",
      campos: { codigo: "Código não encontrado." },
    };
  }

  const existente = await db.query.usuario.findFirst({
    where: and(eq(usuarioTable.empresaId, empresa.id), eq(usuarioTable.cpf, cpf)),
    columns: { ativo: true, aprovadoEm: true },
  });
  if (existente) {
    if (!existente.aprovadoEm) {
      return {
        ok: false,
        status: 409,
        codigo: "cadastro_pendente",
        mensagem: `Você já se cadastrou. Agora falta um administrador da ${empresa.nome} liberar.`,
      };
    }
    if (existente.ativo) {
      return { ok: false, status: 409, codigo: "cpf_cadastrado", mensagem: "Esse CPF já tem conta. Entre com a sua senha." };
    }
    return {
      ok: false,
      status: 409,
      codigo: "conta_desativada",
      mensagem: "Esse CPF tem uma conta desativada. Fale com o administrador.",
    };
  }

  if (email) {
    const emailEmUso = await db.query.usuario.findFirst({
      where: eq(usuarioTable.email, email),
      columns: { id: true },
    });
    if (emailEmUso) {
      return {
        ok: false,
        status: 409,
        codigo: "email_em_uso",
        mensagem: "Esse e-mail já está numa outra conta.",
        campos: { email: "Já está em uso. Use outro ou deixe em branco." },
      };
    }
  }

  try {
    await db.insert(usuarioTable).values({
      empresaId: empresa.id,
      nome: capitalizarNome(nome),
      cpf,
      email: email || null,
      senhaHash: await gerarHash(senha),
      // Provisório: quem decide é o administrador, na aprovação.
      papel: "tecnico",
      ativo: false,
      aprovadoEm: null,
    });
  } catch (erro) {
    // Dois cadastros do mesmo CPF ao mesmo tempo: o índice único barra o segundo.
    if (erro instanceof Error && /usuario_cpf_uq|usuario_email_uq/.test(erro.message)) {
      return { ok: false, status: 409, codigo: "cpf_cadastrado", mensagem: "Esse CPF acabou de ser cadastrado." };
    }
    throw erro;
  }

  return { ok: true, empresa: { nome: empresa.nome } };
}
