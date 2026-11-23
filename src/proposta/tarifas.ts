/**
 * Tarifa da distribuidora: o que a ANEEL publica (TE, TUSD e o Fio B, sem
 * impostos, em R$/MWh) e a conta até o que o cliente paga por kWh. Sem banco —
 * conferido pelo `testar-regras.ts`. A busca fica em `tarifas-aneel.ts`.
 */

export type Subgrupo = "B1" | "B2" | "B3";

export const ROTULO_SUBGRUPO: Record<Subgrupo, string> = {
  B1: "B1 · Residencial",
  B2: "B2 · Rural",
  B3: "B3 · Comercial, industrial e outros",
};

export function ehSubgrupo(v: unknown): v is Subgrupo {
  return v === "B1" || v === "B2" || v === "B3";
}

/**
 * Como a ANEEL escreve a classe de cada subgrupo nos dados abertos (conferido
 * na Energisa Sergipe, resolução de 22/04/2026): residencial é "Residencial /
 * Residencial", rural é "Rural / Não se aplica", e o B3 não tem classe.
 */
export const CLASSE_NA_ANEEL: Record<Subgrupo, { classe: string; subclasse: string }> = {
  B1: { classe: "Residencial", subclasse: "Residencial" },
  B2: { classe: "Rural", subclasse: "Não se aplica" },
  B3: { classe: "Não se aplica", subclasse: "Não se aplica" },
};

/** A tarifa sem impostos, em R$ por kWh. */
export interface TarifaSemImpostos {
  te: number;
  tusd: number;
  /** Parte da TUSD que remunera a rede da distribuidora (Lei 14.300). Nulo se a ANEEL não trouxe. */
  fioB: number | null;
  vigenciaInicio: string;
  vigenciaFim: string | null;
  resolucao: string | null;
}

/** "482,80" (R$/MWh, como a ANEEL escreve) → 0,4828 (R$/kWh). */
export function valorDaAneel(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v / 1000 : null;
  if (typeof v !== "string" || !v.trim()) return null;
  let t = v.trim();
  if (t.includes(",")) t = t.replace(/\./g, "").replace(",", ".");
  const n = Number(t);
  return Number.isFinite(n) ? n / 1000 : null;
}

/**
 * Põe ICMS e PIS/COFINS na tarifa, como a conta de luz faz ("por dentro": o
 * imposto entra na própria base). 0,7546 com 20% + 5% vira 1,006.
 */
export function comImpostos(semImpostos: number, t: { icms: number; pisCofins: number }): number {
  const sobra = 1 - t.icms - t.pisCofins;
  return sobra > 0 ? semImpostos / sobra : semImpostos;
}

/**
 * Das resoluções que a ANEEL devolve, a que vale hoje: início até hoje e fim
 * depois de hoje (ou sem fim). Sem nenhuma assim, a de início mais recente
 * que já começou.
 */
export function vigenteEm<T extends { DatInicioVigencia?: string; DatFimVigencia?: string | null }>(registros: T[], hoje: string): T | null {
  const validos = registros.filter((r) => r.DatInicioVigencia);
  const vale = validos
    .filter((r) => r.DatInicioVigencia! <= hoje && (!r.DatFimVigencia || r.DatFimVigencia >= hoje))
    .sort((a, b) => (b.DatInicioVigencia! > a.DatInicioVigencia! ? 1 : -1));
  if (vale.length) return vale[0];
  const passadas = validos.filter((r) => r.DatInicioVigencia! <= hoje).sort((a, b) => (b.DatInicioVigencia! > a.DatInicioVigencia! ? 1 : -1));
  return passadas[0] ?? null;
}
