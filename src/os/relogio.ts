/**
 * Hora "de relógio de parede" em Sergipe.
 *
 * `agendada_para` e `prazo_sla` são `timestamp without time zone`: "dia 28 às
 * 9h", e não um instante. O Drizzle grava e lê esse tipo pelos componentes UTC
 * do `Date`, então a convenção do projeto é: **o `Date` de um relógio carrega a
 * hora local nos campos UTC**. `iniciada_em`, `concluida_em` e os eventos, ao
 * contrário, são instantes de verdade (`timestamptz`).
 *
 * Sergipe não tem horário de verão desde 2019, mas o fuso vem do Intl e não de
 * um "-3" fixo: se o governo voltar com o horário de verão, isto continua certo.
 */

export const FUSO = "America/Maceio";

const partesFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: FUSO,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

/** O relógio de Sergipe num instante. */
export function relogioDe(instante: Date): Date {
  const partes = partesFmt.formatToParts(instante);
  const v = (tipo: string) => Number(partes.find((p) => p.type === tipo)?.value ?? 0);
  return new Date(
    Date.UTC(v("year"), v("month") - 1, v("day"), v("hour"), v("minute"), v("second")),
  );
}

export function relogioAgora(): Date {
  return relogioDe(new Date());
}

/**
 * O valor de um `<input type="datetime-local">` ("2026-09-28T09:00") como
 * relógio. Nulo quando vazio ou inválido.
 */
export function relogioDoCampo(valor: string | null | undefined): Date | null {
  if (!valor) return null;
  const m = valor.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** O relógio no formato do `<input type="datetime-local">`. */
export function relogioParaCampo(d: Date | null | undefined): string {
  return d ? d.toISOString().slice(0, 16) : "";
}

const SEMANA = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

function dois(n: number): string {
  return String(n).padStart(2, "0");
}

/** "seg, 28/09 às 09:00" */
export function formatarRelogio(d: Date | null | undefined, comDiaDaSemana = true): string {
  if (!d) return "—";
  const data = `${dois(d.getUTCDate())}/${dois(d.getUTCMonth() + 1)}`;
  const hora = `${dois(d.getUTCHours())}:${dois(d.getUTCMinutes())}`;
  return `${comDiaDaSemana ? `${SEMANA[d.getUTCDay()]}, ` : ""}${data} às ${hora}`;
}

/** Um instante (`timestamptz`) no relógio de Sergipe: "28/09/2026 09:03". */
export function formatarInstante(d: Date | null | undefined, comAno = true): string {
  if (!d) return "—";
  const r = relogioDe(d);
  const data = `${dois(r.getUTCDate())}/${dois(r.getUTCMonth() + 1)}${comAno ? `/${r.getUTCFullYear()}` : ""}`;
  return `${data} ${dois(r.getUTCHours())}:${dois(r.getUTCMinutes())}`;
}

/** "2 h 15 min", "40 min". */
export function formatarDuracao(ms: number): string {
  const minutos = Math.round(ms / 60_000);
  if (minutos < 60) return `${minutos} min`;
  const h = Math.floor(minutos / 60);
  const m = minutos % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

/** Segunda-feira 00:00 (relógio) da semana que contém `d`. */
export function inicioDaSemana(d: Date): Date {
  const dia = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const deslocamento = (dia.getUTCDay() + 6) % 7;
  dia.setUTCDate(dia.getUTCDate() - deslocamento);
  return dia;
}
