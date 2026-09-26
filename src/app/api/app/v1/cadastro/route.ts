import { and, eq } from "drizzle-orm";

import { cpfValido, normalizarCpf } from "@/auth/cpf";
import { problemaNaSenha } from "@/auth/politica-senha";
import { gerarHash } from "@/auth/senha";
import { db } from "@/db";
import { usuario as usuarioTable } from "@/db/schema";
import { empresaPeloCodigo } from "@/empresa/codigo-acesso";
import { falha, ipDe, json, lerJson, muitasTentativas, texto } from "@/app-movel/http";
import { consumir, MINUTO } from "@/app-movel/limitador";

/**
 * Cadastro feito pelo próprio técnico, no celular.
 *
 * Pede o que o dono do sistema definiu: nome completo, CPF, e-mail opcional e
 * o código da empresa — mais a senha, que é o que impede qualquer um que saiba
 * o CPF de outra pessoa (e CPF está em todo projeto, contrato e grupo de
 * WhatsApp) de entrar no lugar dela.
 *
 * O cadastro nasce desativado e **sem papel escolhido pela pessoa**: o
 * administrador da empresa aprova e decide se ela é técnico, engenheiro ou
 * administrador. Quem escolhesse o próprio papel no cadastro escolheria "adm".
 */

const PARTICULAS = new Set(["da", "das", "de", "di", "do", "dos", "e"]);

/** "vinícius LIMA dos santos" → "Vinícius Lima dos Santos" */
function capitalizarNome(nome: string): string {
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

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export async function POST(req: Request) {
  const limite = consumir(`cadastro:${ipDe(req)}`, 10, 60 * MINUTO);
  if (!limite.ok) return muitasTentativas(limite.tenteEmSegundos);

  const corpo = await lerJson(req);
  if (!corpo) return falha(400, "requisicao_invalida", "Não entendi o que foi enviado.");

  const codigo = texto(corpo.codigo, 100);
  const nome = texto(corpo.nome, 120).replace(/\s+/g, " ");
  const cpf = normalizarCpf(texto(corpo.cpf, 20));
  const email = texto(corpo.email, 254).toLowerCase();
  const senha = typeof corpo.senha === "string" ? corpo.senha : "";

  const campos: Record<string, string> = {};
  if (nome.length < 5 || !nome.includes(" ")) campos.nome = "Digite o nome completo.";
  if (!cpfValido(cpf)) campos.cpf = "Esse CPF não é válido. Confira os números.";
  if (email && !EMAIL.test(email)) campos.email = "Esse e-mail não parece certo.";
  const problemaSenha = problemaNaSenha(senha, { cpf });
  if (problemaSenha) campos.senha = problemaSenha;
  if (!codigo) campos.codigo = "Falta o código da empresa.";

  if (Object.keys(campos).length) {
    return falha(400, "validacao", "Confira os campos marcados.", { campos });
  }

  const empresa = await empresaPeloCodigo(codigo);
  if (!empresa) {
    return falha(404, "codigo_invalido", "O código da empresa não confere.", {
      campos: { codigo: "Código não encontrado." },
    });
  }

  const existente = await db.query.usuario.findFirst({
    where: and(eq(usuarioTable.empresaId, empresa.id), eq(usuarioTable.cpf, cpf)),
    columns: { ativo: true, aprovadoEm: true },
  });
  if (existente) {
    if (!existente.aprovadoEm) {
      return falha(
        409,
        "cadastro_pendente",
        `Você já se cadastrou. Agora falta um administrador da ${empresa.nome} liberar.`,
      );
    }
    if (existente.ativo) {
      return falha(409, "cpf_cadastrado", "Esse CPF já tem conta. Entre com a sua senha.");
    }
    return falha(
      409,
      "conta_desativada",
      "Esse CPF tem uma conta desativada. Fale com o administrador.",
    );
  }

  if (email) {
    const emailEmUso = await db.query.usuario.findFirst({
      where: eq(usuarioTable.email, email),
      columns: { id: true },
    });
    if (emailEmUso) {
      return falha(409, "email_em_uso", "Esse e-mail já está numa outra conta.", {
        campos: { email: "Já está em uso. Use outro ou deixe em branco." },
      });
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
      return falha(409, "cpf_cadastrado", "Esse CPF acabou de ser cadastrado.");
    }
    throw erro;
  }

  return json(
    {
      situacao: "pendente",
      empresa: { nome: empresa.nome },
      mensagem: `Agora falta um administrador da ${empresa.nome} liberar o seu acesso.`,
    },
    201,
  );
}
