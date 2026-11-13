/**
 * As premissas da proposta comercial: o que o cálculo de economia assume e os
 * textos de garantia e pagamento. Sem banco — conferido pelo `testar-regras.ts`.
 *
 * Ficam gravadas por empresa (`empresa.proposta_config`), conferidas pelo adm.
 * Os valores de `SUGESTAO` só preenchem o formulário da primeira vez: nada vale
 * até alguém salvar, porque número errado numa proposta vira promessa ao cliente.
 */

export interface Premissas {
  /** Tarifa cheia da distribuidora, com impostos, em R$ por kWh. */
  tarifaKwh: number;
  /** TUSD Fio B cheia, em R$ por kWh (antes do percentual que a Lei 14.300 cobra no ano). */
  fioBKwh: number;
  /** Irradiação local, em kWh/m² por dia (média anual). */
  irradiacaoDia: number;
  /** Desempenho global do sistema (PR), de 0 a 1. */
  desempenho: number;
  /** Fração do consumo que é atendida na hora pela geração, sem passar pela rede (0 a 1). */
  simultaneidade: number;
  /** Reajuste anual da tarifa (0 a 1). */
  reajusteAnual: number;
  /** Perda anual de geração dos módulos (0 a 1). */
  degradacaoAnual: number;
  /** Dias de validade da proposta. O CDC (art. 40) pressupõe 10 se nada for dito. */
  validadeDias: number;
  garantias: { inversor: number; placas: number; estrutura: number; eficiencia: number };
  cartao: { parcelas: number; taxaMes: number };
  carenciaFinanciamentoDias: number;
  /** O primeiro número de proposta, para continuar a numeração que a empresa já tem. */
  numeroInicial: number | null;
}

/** O que o formulário mostra na primeira vez. Não vale até o adm salvar. */
export const SUGESTAO: Premissas = {
  tarifaKwh: 1.0,
  fioBKwh: 0.27,
  irradiacaoDia: 5.26,
  desempenho: 0.75,
  simultaneidade: 0.3,
  reajusteAnual: 0.05,
  degradacaoAnual: 0.007,
  validadeDias: 10,
  garantias: { inversor: 10, placas: 15, estrutura: 10, eficiencia: 25 },
  cartao: { parcelas: 21, taxaMes: 0.008 },
  carenciaFinanciamentoDias: 120,
  numeroInicial: null,
};

function numero(v: unknown, min: number, max: number): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v.replace(",", ".")) : NaN;
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
}

function inteiro(v: unknown, min: number, max: number): number | null {
  const n = numero(v, min, max);
  return n !== null && Number.isInteger(n) ? n : null;
}

/**
 * Lê o que está gravado. Qualquer campo ausente ou fora do razoável anula tudo:
 * premissa pela metade daria uma proposta com número inventado.
 */
export function lerPremissas(bruto: unknown): Premissas | null {
  if (!bruto || typeof bruto !== "object") return null;
  const b = bruto as Record<string, unknown>;
  const g = (b.garantias ?? {}) as Record<string, unknown>;
  const c = (b.cartao ?? {}) as Record<string, unknown>;
  const tarifaKwh = numero(b.tarifaKwh, 0.1, 5);
  const fioBKwh = numero(b.fioBKwh, 0, 2);
  const irradiacaoDia = numero(b.irradiacaoDia, 2, 8);
  const desempenho = numero(b.desempenho, 0.5, 0.95);
  const simultaneidade = numero(b.simultaneidade, 0, 1);
  const reajusteAnual = numero(b.reajusteAnual, 0, 0.3);
  const degradacaoAnual = numero(b.degradacaoAnual, 0, 0.05);
  const validadeDias = inteiro(b.validadeDias, 1, 90);
  const inversor = inteiro(g.inversor, 1, 40);
  const placas = inteiro(g.placas, 1, 40);
  const estrutura = inteiro(g.estrutura, 1, 40);
  const eficiencia = inteiro(g.eficiencia, 1, 40);
  const parcelas = inteiro(c.parcelas, 1, 120);
  const taxaMes = numero(c.taxaMes, 0, 0.2);
  const carencia = inteiro(b.carenciaFinanciamentoDias, 0, 365);
  const inicial = b.numeroInicial === null || b.numeroInicial === undefined || b.numeroInicial === "" ? null : inteiro(b.numeroInicial, 1, 1_000_000);

  const todos = [tarifaKwh, fioBKwh, irradiacaoDia, desempenho, simultaneidade, reajusteAnual, degradacaoAnual, validadeDias, inversor, placas, estrutura, eficiencia, parcelas, taxaMes, carencia];
  if (todos.some((x) => x === null)) return null;
  if (b.numeroInicial !== null && b.numeroInicial !== undefined && b.numeroInicial !== "" && inicial === null) return null;
  return {
    tarifaKwh: tarifaKwh!,
    fioBKwh: fioBKwh!,
    irradiacaoDia: irradiacaoDia!,
    desempenho: desempenho!,
    simultaneidade: simultaneidade!,
    reajusteAnual: reajusteAnual!,
    degradacaoAnual: degradacaoAnual!,
    validadeDias: validadeDias!,
    garantias: { inversor: inversor!, placas: placas!, estrutura: estrutura!, eficiencia: eficiencia! },
    cartao: { parcelas: parcelas!, taxaMes: taxaMes! },
    carenciaFinanciamentoDias: carencia!,
    numeroInicial: inicial,
  };
}

/**
 * O formulário digita porcentagem ("75", "0,8") e número comum; o que se grava
 * é fração (0,75). Devolve nulo se algum campo não é número.
 */
export function premissasDoFormulario(campos: Record<string, string>): Premissas | null {
  const n = (k: string) => Number(String(campos[k] ?? "").trim().replace(",", "."));
  const pct = (k: string) => n(k) / 100;
  const bruto = {
    tarifaKwh: n("tarifaKwh"),
    fioBKwh: n("fioBKwh"),
    irradiacaoDia: n("irradiacaoDia"),
    desempenho: pct("desempenho"),
    simultaneidade: pct("simultaneidade"),
    reajusteAnual: pct("reajusteAnual"),
    degradacaoAnual: pct("degradacaoAnual"),
    validadeDias: n("validadeDias"),
    garantias: { inversor: n("garantiaInversor"), placas: n("garantiaPlacas"), estrutura: n("garantiaEstrutura"), eficiencia: n("garantiaEficiencia") },
    cartao: { parcelas: n("cartaoParcelas"), taxaMes: pct("cartaoTaxa") },
    carenciaFinanciamentoDias: n("carencia"),
    numeroInicial: String(campos.numeroInicial ?? "").trim() === "" ? null : n("numeroInicial"),
  };
  return lerPremissas(bruto);
}
