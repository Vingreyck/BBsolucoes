/**
 * Formatação de números para exibição.
 *
 * O Postgres devolve `numeric(10,3)` como string com as três casas sempre
 * presentes: uma usina de 5,4 kWp chega como "5.400". Jogar isso na tela em
 * português vira "5.400 kWp", que se lê como cinco mil e quatrocentos — um erro
 * de mil vezes num sistema que já tem problema de unidade no cadastro de
 * origem. Aqui as casas decimais inúteis somem e o separador vira o nosso.
 */

const KWP = new Intl.NumberFormat("pt-BR", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

const KWH = new Intl.NumberFormat("pt-BR", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 1,
});

export function kWp(valor: string | number | null | undefined): string | null {
  if (valor === null || valor === undefined || valor === "") return null;
  const n = Number(valor);
  return Number.isFinite(n) ? `${KWP.format(n)} kWp` : null;
}

export function kWh(valor: string | number | null | undefined): string | null {
  if (valor === null || valor === undefined || valor === "") return null;
  const n = Number(valor);
  return Number.isFinite(n) ? `${KWH.format(n)} kWh` : null;
}
