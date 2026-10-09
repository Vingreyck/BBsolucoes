import { eq } from "drizzle-orm";

import { excluirConta } from "@/auth/excluir-conta";
import { conferirSenha } from "@/auth/senha";
import { db } from "@/db";
import { usuario as usuarioTable } from "@/db/schema";
import { exigirApp } from "@/app-movel/autenticacao";
import { falha, json, lerJson, muitasTentativas } from "@/app-movel/http";
import { consumir, MINUTO } from "@/app-movel/limitador";

/**
 * "Excluir minha conta", de dentro do app — exigido pela Apple e pela Google.
 *
 * Pede a senha de novo: com o celular destravado na mão de outra pessoa, um
 * toque não pode apagar a conta de ninguém. O que é apagado e o que fica está
 * em `@/auth/excluir-conta`.
 */
export async function POST(req: Request) {
  const usuario = await exigirApp(req, { permitirSenhaProvisoria: true });
  if (usuario instanceof Response) return usuario;

  const limite = consumir(`excluir:${usuario.id}`, 5, 15 * MINUTO);
  if (!limite.ok) return muitasTentativas(limite.tenteEmSegundos);

  const corpo = await lerJson(req);
  const senha = typeof corpo?.senha === "string" ? corpo.senha : "";

  const registro = await db.query.usuario.findFirst({
    where: eq(usuarioTable.id, usuario.id),
    columns: { senhaHash: true },
  });
  if (!registro || !senha || !(await conferirSenha(senha, registro.senhaHash))) {
    return falha(400, "senha_incorreta", "A senha não confere.", { campos: { senha: "Não confere." } });
  }

  const resultado = await excluirConta(usuario.id, usuario.empresaId);
  if (!resultado.ok) return falha(409, resultado.codigo, resultado.mensagem);

  return json({ excluida: true });
}
