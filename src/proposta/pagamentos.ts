/**
 * As formas de pagamento com as parcelas já calculadas: à vista, cartão e cada
 * financiamento configurado. Sem banco — conferido pelo `testar-regras.ts`.
 *
 * A parcela é a da tabela Price: PMT = PV · i ÷ (1 − (1 + i)^−n). No
 * financiamento, os juros da carência entram no saldo antes da primeira
 * parcela. É simulação: a proposta diz que o banco aprova e confirma.
 */

import type { Premissas } from "./premissas";

/** A parcela da tabela Price. Juros zero: o valor dividido por igual. */
export function parcelaPrice(valor: number, taxaMes: number, parcelas: number): number {
  if (!(parcelas > 0)) return valor;
  if (!(taxaMes > 0)) return valor / parcelas;
  return (valor * taxaMes) / (1 - (1 + taxaMes) ** -parcelas);
}

export interface OpcaoDeParcela {
  parcelas: number;
  valorParcela: number;
  total: number;
}

export interface FormasDePagamento {
  aVista: { valor: number; desconto: number };
  cartao: { taxaMes: number; opcoes: OpcaoDeParcela[] } | null;
  financiamentos: { nome: string; taxaMes: number; carenciaDias: number; opcoes: OpcaoDeParcela[] }[];
}

/** As parcelas do cartão que valem mostrar: algumas até o máximo configurado. */
export function parcelasDoCartao(maximo: number): number[] {
  const base = [1, 3, 6, 10, 12, 18, 21, 24];
  const lista = base.filter((n) => n <= maximo);
  if (!lista.includes(maximo)) lista.push(maximo);
  return lista.filter((n) => n >= 2).slice(-4);
}

export function formasDePagamento(preco: number, p: Pick<Premissas, "cartao" | "pagamento">): FormasDePagamento {
  const desconto = p.pagamento.aVistaDesconto;
  const cartao =
    p.cartao.parcelas >= 2
      ? {
          taxaMes: p.cartao.taxaMes,
          opcoes: parcelasDoCartao(p.cartao.parcelas).map((n) => {
            const valorParcela = parcelaPrice(preco, p.cartao.taxaMes, n);
            return { parcelas: n, valorParcela, total: valorParcela * n };
          }),
        }
      : null;
  const financiamentos = p.pagamento.financiamentos.map((f) => {
    // Juros da carência: o saldo cresce até a primeira parcela (um mês já é o normal da Price).
    const mesesDeCarencia = Math.max(0, f.carenciaDias / 30 - 1);
    const saldo = preco * (1 + f.taxaMes) ** mesesDeCarencia;
    return {
      nome: f.nome,
      taxaMes: f.taxaMes,
      carenciaDias: f.carenciaDias,
      opcoes: f.prazos.map((n) => {
        const valorParcela = parcelaPrice(saldo, f.taxaMes, n);
        return { parcelas: n, valorParcela, total: valorParcela * n };
      }),
    };
  });
  return { aVista: { valor: preco * (1 - desconto), desconto }, cartao, financiamentos };
}
