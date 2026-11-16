import { exigirApp } from "@/app-movel/autenticacao";
import { json } from "@/app-movel/http";
import { quemUsaOApp } from "@/os/consultas";

export const dynamic = "force-dynamic";

/**
 * Quem pode ser escolhido para uma visita de volta. Qualquer pessoa do app lê —
 * quem faz a vistoria (técnico, vendedor) não vê a equipe, mas precisa dizer quem
 * volta.
 *
 * A mesma lista do site (`quemUsaOApp`): quem pode usar o app, com quem já usa
 * primeiro. Antes eram só os de papel "técnico", e o vendedor que faz vistoria e
 * as adms que também vão a campo não apareciam no celular.
 *
 * Só nome e id, no mesmo formato de antes (`tecnicos`): nada de CPF, e-mail ou papel.
 */
export async function GET(req: Request) {
  const usuario = await exigirApp(req);
  if (usuario instanceof Response) return usuario;
  const pessoas = await quemUsaOApp(usuario.empresaId);
  return json({ tecnicos: pessoas.map((p) => ({ id: p.id, nome: p.nome })) });
}
