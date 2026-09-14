import { redirect } from "next/navigation";

import { exigirUsuario, type UsuarioSessao } from "./sessao";

/**
 * Quem pode ver o dossiê de documentos do cliente.
 *
 * A tabela `documento` guarda CNH, RG, CPF, conta de luz e endereço de 169
 * pessoas. Técnico e estoque não precisam disso para fazer o trabalho deles —
 * o técnico precisa da OS e da usina, o estoque precisa do equipamento — e
 * acesso que não é necessário é risco sem contrapartida.
 *
 * Isso não é zelo excessivo: é o princípio da necessidade do art. 6º da LGPD,
 * que manda limitar o tratamento ao mínimo necessário para a finalidade. Vale
 * junto com a trilha de `documento_acesso`: uma diz quem **pode**, a outra
 * registra quem **foi**.
 */
export const PAPEIS_COM_DOCUMENTOS = new Set(["adm", "vendedor", "engenheiro"]);

export function podeVerDocumentos(papel: string): boolean {
  return PAPEIS_COM_DOCUMENTOS.has(papel);
}

/**
 * Exige sessão **e** papel com acesso a documento.
 *
 * Esconder o link no menu não protege nada — quem digitar o endereço entra. É
 * esta função, chamada dentro da página, que de fato barra.
 */
export async function exigirAcessoDocumentos(): Promise<UsuarioSessao> {
  const usuario = await exigirUsuario();
  if (!podeVerDocumentos(usuario.papel)) redirect("/sem-acesso");
  return usuario;
}
