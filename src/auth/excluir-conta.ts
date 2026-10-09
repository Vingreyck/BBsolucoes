import { randomBytes } from "node:crypto";

import { and, count, eq, ne } from "drizzle-orm";

import { gerarHash } from "@/auth/senha";
import { db, schema } from "@/db";

/**
 * A pessoa apaga a própria conta — exigência da Apple (regra 5.1.1) e da Google
 * para app em que se cria conta.
 *
 * Apaga o que é dela: nome, CPF, e-mail, telefone, senha e o histórico de GPS.
 * O que é do serviço prestado ao cliente (OS, fotos, checklist, relatório)
 * fica, porque é a prova do atendimento — só que assinado por "Conta excluída",
 * e não mais por ela. É o que a página pública `/excluir-conta` promete.
 *
 * Não é o "desativar" da tela de Usuários: aquele guarda o nome no histórico de
 * propósito, para a trilha continuar dizendo quem fez o quê. Aqui a pessoa
 * pediu para sair dos registros, e sai.
 */

export type ResultadoExclusao = { ok: true } | { ok: false; codigo: string; mensagem: string };

export async function excluirConta(usuarioId: string, empresaId: string): Promise<ResultadoExclusao> {
  const pessoa = await db.query.usuario.findFirst({
    where: and(eq(schema.usuario.id, usuarioId), eq(schema.usuario.empresaId, empresaId)),
    columns: { id: true, papel: true, ativo: true },
  });
  if (!pessoa) return { ok: false, codigo: "nao_encontrado", mensagem: "Conta não encontrada." };

  // O último administrador não pode sair sozinho: a empresa ficaria sem ninguém
  // para aprovar a equipe nem trocar senha.
  if (pessoa.papel === "adm") {
    const [outros] = await db
      .select({ n: count() })
      .from(schema.usuario)
      .where(
        and(
          eq(schema.usuario.empresaId, empresaId),
          eq(schema.usuario.papel, "adm"),
          eq(schema.usuario.ativo, true),
          ne(schema.usuario.id, usuarioId),
        ),
      );
    if (Number(outros?.n ?? 0) === 0) {
      return {
        ok: false,
        codigo: "ultimo_adm",
        mensagem: "Você é o único administrador da empresa. Passe o papel de administrador a outra pessoa antes de excluir a sua conta.",
      };
    }
  }

  await db.transaction(async (tx) => {
    await tx.delete(schema.posicaoTrilha).where(eq(schema.posicaoTrilha.usuarioId, usuarioId));
    await tx.delete(schema.posicaoAtual).where(eq(schema.posicaoAtual.usuarioId, usuarioId));
    await tx.delete(schema.sessao).where(eq(schema.sessao.usuarioId, usuarioId));
    await tx
      .update(schema.usuario)
      .set({
        nome: "Conta excluída",
        email: null,
        cpf: null,
        telefone: null,
        // Senha sorteada e jogada fora: ninguém mais entra nesta conta.
        senhaHash: await gerarHash(randomBytes(32).toString("base64url")),
        deveTrocarSenha: false,
        ativo: false,
      })
      .where(eq(schema.usuario.id, usuarioId));
  });

  return { ok: true };
}
