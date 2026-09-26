import { eq } from "drizzle-orm";

import { problemaNaSenha } from "@/auth/politica-senha";
import { conferirSenha, gerarHash } from "@/auth/senha";
import { encerrarOutrasSessoes } from "@/auth/sessao-app";
import { db } from "@/db";
import { usuario as usuarioTable } from "@/db/schema";
import { exigirApp, perfilDoUsuario } from "@/app-movel/autenticacao";
import { falha, json, lerJson, muitasTentativas } from "@/app-movel/http";
import { consumir, MINUTO } from "@/app-movel/limitador";

/**
 * Trocar a própria senha — obrigatório quando ela é provisória.
 *
 * Derruba as outras sessões da pessoa e mantém a atual: quem troca a senha por
 * desconfiar que alguém sabe a antiga precisa que esse alguém caia, e não
 * precisa ser jogado para fora do próprio celular.
 */
export async function POST(req: Request) {
  const usuario = await exigirApp(req, { permitirSenhaProvisoria: true });
  if (usuario instanceof Response) return usuario;

  // Com um token roubado, isto viraria máquina de adivinhar a senha atual.
  const limite = consumir(`senha:${usuario.id}`, 10, 15 * MINUTO);
  if (!limite.ok) return muitasTentativas(limite.tenteEmSegundos);

  const corpo = await lerJson(req);
  const atual = typeof corpo?.atual === "string" ? corpo.atual : "";
  const nova = typeof corpo?.nova === "string" ? corpo.nova : "";

  const problema = problemaNaSenha(nova, { cpf: usuario.cpf });
  if (problema) return falha(400, "validacao", problema, { campos: { nova: problema } });
  if (nova === atual) {
    const mensagem = "A senha nova precisa ser diferente da atual.";
    return falha(400, "validacao", mensagem, { campos: { nova: mensagem } });
  }

  const registro = await db.query.usuario.findFirst({
    where: eq(usuarioTable.id, usuario.id),
    columns: { senhaHash: true },
  });
  if (!registro || !(await conferirSenha(atual, registro.senhaHash))) {
    return falha(400, "senha_atual_incorreta", "A senha atual não confere.", {
      campos: { atual: "Não confere." },
    });
  }

  await db
    .update(usuarioTable)
    .set({ senhaHash: await gerarHash(nova), deveTrocarSenha: false })
    .where(eq(usuarioTable.id, usuario.id));
  await encerrarOutrasSessoes(usuario.id, usuario.sessaoId);

  return json({ usuario: perfilDoUsuario({ ...usuario, deveTrocarSenha: false }) });
}
