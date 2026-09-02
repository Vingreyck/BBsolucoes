/**
 * Os cinco passos da ficha de cadastro de usina.
 *
 * A ordem é a que o cliente pediu depois de ver a tela do Seenet. Não é a ordem
 * do processo — contrato acontece cedo e monitoramento no fim da vida do
 * projeto — é a ordem de preenchimento de uma ficha só, que junta tudo o que se
 * sabe sobre uma usina.
 */
export const PASSOS = [
  {
    numero: 1,
    slug: "monitoramento",
    titulo: "Cliente e monitoramento",
    resumo: "Quem é o cliente e em qual portal esta usina é monitorada.",
  },
  {
    numero: 2,
    slug: "vistoria",
    titulo: "Vistoria",
    resumo: "O que o técnico encontrou no local.",
  },
  {
    numero: 3,
    slug: "inversor",
    titulo: "Inversor",
    resumo: "Marca, modelo e número de série do que foi instalado.",
  },
  {
    numero: 4,
    slug: "estoque",
    titulo: "Estoque",
    resumo: "O material que saiu da prateleira para esta obra.",
  },
  {
    numero: 5,
    slug: "contrato",
    titulo: "Contrato",
    resumo: "Valor, ART e onde os documentos estão guardados.",
  },
] as const;

export const TOTAL_PASSOS = PASSOS.length;

export function passoPorNumero(numero: number) {
  return PASSOS.find((p) => p.numero === numero);
}
