import { and, eq } from "drizzle-orm";

import { exigirApp } from "@/app-movel/autenticacao";
import { falha, json, lerJson, semConteudo, texto } from "@/app-movel/http";
import { db, schema } from "@/db";

export const dynamic = "force-dynamic";

/**
 * O celular conta o token de push dele.
 *
 *   PUT    { token, plataforma }   registra (ou atualiza) este aparelho
 *   DELETE { token }               tira — o técnico desligou os avisos
 *
 * O token é único no banco: se ele já existia com outra sessão ou outro usuário
 * (celular emprestado, troca de login), a linha passa a pertencer a quem está
 * logado agora. Sair do app apaga a sessão e, por cascata, o token.
 */
export async function PUT(req: Request) {
  const usuario = await exigirApp(req);
  if (usuario instanceof Response) return usuario;

  const corpo = await lerJson(req, 4_000);
  const token = texto(corpo?.token, 4096);
  const plataforma = texto(corpo?.plataforma, 10).toLowerCase();
  if (!token || (plataforma !== "android" && plataforma !== "ios")) {
    return falha(400, "validacao", "Faltou o token ou a plataforma.");
  }

  await db
    .insert(schema.aparelhoPush)
    .values({ usuarioId: usuario.id, sessaoId: usuario.sessaoId, token, plataforma })
    .onConflictDoUpdate({
      target: schema.aparelhoPush.token,
      set: { usuarioId: usuario.id, sessaoId: usuario.sessaoId, plataforma, atualizadoEm: new Date() },
    });
  return json({ ok: true });
}

export async function DELETE(req: Request) {
  const usuario = await exigirApp(req, { permitirSenhaProvisoria: true });
  if (usuario instanceof Response) return usuario;

  const corpo = await lerJson(req, 4_000);
  const token = texto(corpo?.token, 4096);
  if (token) {
    await db
      .delete(schema.aparelhoPush)
      .where(and(eq(schema.aparelhoPush.token, token), eq(schema.aparelhoPush.usuarioId, usuario.id)));
  }
  return semConteudo();
}
