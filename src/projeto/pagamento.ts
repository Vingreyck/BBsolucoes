/**
 * As formas de pagamento que a BB Soluções negocia, as mesmas da antiga etapa
 * "Forma de pagamento": banco, cartão, cheque, boleto comercial ou à vista.
 *
 * Fica em `projeto.forma_pagamento` como texto (a chave daqui) e não como enum
 * do banco: acrescentar uma forma é mudar esta lista, sem migração.
 */
export const FORMAS_PAGAMENTO = {
  a_vista: "À vista (PIX ou transferência)",
  financiamento: "Financiamento bancário",
  cartao: "Cartão de crédito",
  boleto: "Boleto comercial",
  cheque: "Cheque",
  misto: "Entrada + parcelado",
} as const;

export type FormaPagamento = keyof typeof FORMAS_PAGAMENTO;

export function ehFormaPagamento(v: string | null | undefined): v is FormaPagamento {
  return !!v && v in FORMAS_PAGAMENTO;
}

export function rotuloPagamento(v: string | null | undefined): string | null {
  return ehFormaPagamento(v) ? FORMAS_PAGAMENTO[v] : null;
}
