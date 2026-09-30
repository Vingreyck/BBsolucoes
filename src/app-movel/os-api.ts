import { ErroOs } from "@/os/acesso";

import { falha } from "./http";

/**
 * O que as rotas de execução da OS têm em comum: a recusa de regra vira a
 * resposta de erro padrão do app (`{ erro, mensagem }`), com o status certo;
 * qualquer outra coisa sobe como erro de servidor.
 */
export function respostaDoErro(e: unknown): Response {
  if (e instanceof ErroOs) return falha(e.status, e.codigo, e.message);
  throw e;
}

/** Data ISO vinda do celular, ou nulo se não veio ou não presta. */
export function dataDoApp(valor: unknown): Date | null {
  if (typeof valor !== "string" || !valor) return null;
  const d = new Date(valor);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function numeroDoApp(valor: unknown): number | null {
  if (valor === null || valor === undefined || valor === "") return null;
  const n = typeof valor === "number" ? valor : Number(valor);
  return Number.isFinite(n) ? n : null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** O id que o celular dá a cada ação e a cada foto. Obrigatório no app. */
export function idClienteDoApp(valor: unknown): string | null {
  return typeof valor === "string" && UUID.test(valor) ? valor.toLowerCase() : null;
}
