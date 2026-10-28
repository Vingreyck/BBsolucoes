import { and, asc, eq } from "drizzle-orm";

import { exigirApp } from "@/app-movel/autenticacao";
import { json } from "@/app-movel/http";
import { db } from "@/db";
import { usuario as usuarioTable } from "@/db/schema";

export const dynamic = "force-dynamic";

/**
 * Quem pode ser escolhido para uma visita de volta: os técnicos ativos da
 * empresa. Qualquer pessoa do app lê — quem faz a vistoria (técnico, vendedor)
 * não vê a equipe, mas precisa dizer quem volta.
 *
 * Só nome e id: nada de CPF, e-mail ou papel além do necessário.
 */
export async function GET(req: Request) {
  const usuario = await exigirApp(req);
  if (usuario instanceof Response) return usuario;

  const tecnicos = await db.query.usuario.findMany({
    where: and(
      eq(usuarioTable.empresaId, usuario.empresaId),
      eq(usuarioTable.papel, "tecnico"),
      eq(usuarioTable.ativo, true),
    ),
    orderBy: asc(usuarioTable.nome),
    columns: { id: true, nome: true },
  });
  return json({ tecnicos });
}
