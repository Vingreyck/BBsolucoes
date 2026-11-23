import { FUSO } from "./os/relogio";

/**
 * Data na tela, do jeito brasileiro: "21/11/2026", ou "21/11" onde o espaço é
 * curto e o ano é óbvio.
 *
 * Duas origens, dois cuidados:
 * - **texto "2026-11-21"** (coluna `date`, `::date::text`, o dia de uma
 *   leitura): só se reescreve o texto. `new Date("2026-11-21")` lê meia-noite
 *   UTC, e no fuso de Sergipe isso ainda é o dia 20.
 * - **`Date`** (um instante, `timestamptz`): o dia em Sergipe, e não no fuso do
 *   servidor, que roda em UTC — às 22h daqui lá já é amanhã.
 *
 * O relógio de parede (`timestamp without time zone`, ver `os/relogio.ts`)
 * carrega a hora local nos campos UTC: para ele, `formatarRelogio`.
 */

const ISO = /^(\d{4})-(\d{2})-(\d{2})/;

const NO_FUSO = new Intl.DateTimeFormat("pt-BR", {
  timeZone: FUSO,
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

/** [dia, mês, ano], ou nulo se não for data. Texto que não é ISO volta como veio. */
function partes(valor: string | Date): [string, string, string] | string | null {
  if (typeof valor === "string") {
    const texto = valor.trim();
    const m = texto.match(ISO);
    return m ? [m[3], m[2], m[1]] : texto || null;
  }
  if (Number.isNaN(valor.getTime())) return null;
  const p = NO_FUSO.formatToParts(valor);
  const v = (tipo: string) => p.find((x) => x.type === tipo)?.value ?? "";
  return [v("day"), v("month"), v("year")];
}

/** "21/11/2026". Vazio, nulo ou data inválida vira "—". */
export function dataBr(valor: string | Date | null | undefined): string {
  const p = valor ? partes(valor) : null;
  if (!p) return "—";
  return typeof p === "string" ? p : `${p[0]}/${p[1]}/${p[2]}`;
}

/** "21/11", para onde o espaço é curto e o ano já se sabe. */
export function diaMesBr(valor: string | Date | null | undefined): string {
  const p = valor ? partes(valor) : null;
  if (!p) return "—";
  return typeof p === "string" ? p : `${p[0]}/${p[1]}`;
}

/**
 * Toda data "2026-11-21" no meio de um texto vira "21/11/2026". Para texto já
 * gravado assim — as mensagens de alerta do detector até 23/11 — sem mexer no
 * banco. Número que não é data (mês 13, dia 32, serial colado) fica como está.
 */
export function datasIsoNoTexto(texto: string): string {
  return texto.replace(/\b(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])\b/g, "$3/$2/$1");
}
