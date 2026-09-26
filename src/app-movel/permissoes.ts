/**
 * Quem entra no app e o que cada um vê.
 *
 * O app nasce para três papéis. Vendedor e estoque continuam no navegador —
 * mas as vistorias de julho a setembro mostraram que 6 de 9 foram feitas pelo
 * Luan, que é do comercial. Quando a vistoria vier para o app, acrescentar
 * `vendedor` aqui é o que basta para ele entrar.
 *
 * O app não decide nada pelo nome do papel: recebe a lista de permissões no
 * login e mostra ou esconde telas por ela. Mudar o que um papel pode é mexer
 * só aqui, sem publicar versão nova do app.
 */

export const PAPEIS_APP = ["adm", "engenheiro", "tecnico"] as const;
export type PapelApp = (typeof PAPEIS_APP)[number];

export function ehPapelApp(papel: string): papel is PapelApp {
  return (PAPEIS_APP as readonly string[]).includes(papel);
}

export type Permissao =
  /** Ver as OS da empresa inteira, e não só as que são suas. */
  | "os.ver_todas"
  /** Aprovar cadastros, trocar papel, desativar, redefinir senha. */
  | "equipe.gerir";

const PERMISSOES: Record<PapelApp, readonly Permissao[]> = {
  adm: ["os.ver_todas", "equipe.gerir"],
  engenheiro: ["os.ver_todas"],
  tecnico: [],
};

export function permissoesDe(papel: PapelApp): readonly Permissao[] {
  return PERMISSOES[papel];
}

export function pode(usuario: { papel: PapelApp }, permissao: Permissao): boolean {
  return PERMISSOES[usuario.papel].includes(permissao);
}
