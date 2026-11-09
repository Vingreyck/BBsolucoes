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

const INTEIRO = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });
const TRES_DIGITOS = new Intl.NumberFormat("pt-BR", { maximumSignificantDigits: 3 });

/**
 * Energia na unidade que se lê de relance: 612 kWh, 1,61 MWh, 48,2 MWh, 1,2 GWh.
 * Número e unidade vêm separados para a tela desenhar a unidade menor.
 */
export function energia(kwh: number): { numero: string; unidade: string } {
  if (kwh >= 1_000_000) return { numero: TRES_DIGITOS.format(kwh / 1_000_000), unidade: "GWh" };
  if (kwh >= 1_000) return { numero: TRES_DIGITOS.format(kwh / 1_000), unidade: "MWh" };
  return { numero: INTEIRO.format(kwh), unidade: "kWh" };
}

export function energiaTexto(kwh: number): string {
  const e = energia(kwh);
  return `${e.numero} ${e.unidade}`;
}

/** "Vinícius Lima Santos" → "VS": a primeira letra do primeiro e do último nome. */
export function iniciais(nome: string): string {
  const partes = nome.trim().split(/\s+/);
  return ((partes[0]?.[0] ?? "") + (partes.length > 1 ? partes[partes.length - 1][0] : "")).toUpperCase();
}

/** Para comparar em busca: minúsculas e sem acento ("Conceição" acha "conceicao"). */
export function semAcento(texto: string): string {
  return texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}
