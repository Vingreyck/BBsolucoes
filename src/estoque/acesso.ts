import { redirect } from "next/navigation";

import { exigirUsuario } from "@/auth/sessao";

import { podeVerEstoque } from "./estoque";

/** Sessão da web com acesso ao estoque (adm, estoque, engenheiro). Esconder o menu não protege; isto protege. */
export async function exigirEstoque() {
  const usuario = await exigirUsuario();
  if (!podeVerEstoque(usuario.papel)) redirect("/sem-acesso");
  return usuario;
}
