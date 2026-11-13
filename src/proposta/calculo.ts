/**
 * O cálculo da proposta: geração mês a mês, a conta com e sem solar, a economia
 * em 5 e 25 anos e o retorno. Sem banco — conferido pelo `testar-regras.ts`.
 *
 * Tudo é estimativa e a proposta diz isso. Os números que mexem no resultado
 * (tarifa, Fio B, irradiação, desempenho…) vêm das premissas conferidas pelo adm.
 */

import type { Premissas } from "./premissas";

/**
 * A geração de cada mês de um ano médio em Sergipe, em kWh, medida do gráfico
 * da proposta de referência da BB (sistema de 3,72 kWp em Itabaiana). Só o
 * **formato** da curva importa: ela vira fator em torno da média e é aplicada à
 * produção calculada de cada sistema.
 */
const PERFIL_SERGIPE_KWH = [524, 463, 502, 418, 363, 327, 346, 392, 446, 494, 517, 538];

/** Fator de cada mês em relação à média (1 = mês médio). Soma 12. */
export const FATORES_MENSAIS: number[] = (() => {
  const media = PERFIL_SERGIPE_KWH.reduce((a, b) => a + b, 0) / 12;
  return PERFIL_SERGIPE_KWH.map((v) => v / media);
})();

export const MESES = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

export type Ligacao = "monofasico" | "bifasico" | "trifasico";

/** Custo de disponibilidade: o mínimo que a distribuidora cobra, em kWh por mês. */
export const DISPONIBILIDADE_KWH: Record<Ligacao, number> = { monofasico: 30, bifasico: 50, trifasico: 100 };

export const ROTULO_LIGACAO: Record<Ligacao, string> = {
  monofasico: "Monofásica (30 kWh)",
  bifasico: "Bifásica (50 kWh)",
  trifasico: "Trifásica (100 kWh)",
};

export function ehLigacao(v: unknown): v is Ligacao {
  return typeof v === "string" && v in DISPONIBILIDADE_KWH;
}

/**
 * A ligação que a proposta usa: a do cadastro do projeto; sem ela, a dos polos
 * do disjuntor que o técnico anotou na vistoria; sem nada, bifásica (a mais
 * comum nas casas atendidas).
 */
export function ligacaoDoProjeto(gravada: string | null | undefined, polos?: string | null): Ligacao {
  return ehLigacao(gravada) ? gravada : (ligacaoDosPolos(polos) ?? "bifasico");
}

/** Os polos do disjuntor que o técnico anota na vistoria dão o tipo de ligação. */
export function ligacaoDosPolos(polos: string | null | undefined): Ligacao | null {
  const p = (polos ?? "").toLowerCase();
  if (p.startsWith("mono") || p.startsWith("uni")) return "monofasico";
  if (p.startsWith("bi")) return "bifasico";
  if (p.startsWith("tri")) return "trifasico";
  return null;
}

/**
 * O percentual do Fio B cobrado sobre a energia compensada (Lei 14.300, art. 27,
 * para quem pediu a ligação a partir de 07/01/2023): 15% em 2023, 30%, 45%, 60%
 * em 2026, 75% e 90% em 2028. De 2029 em diante a ANEEL define: o cálculo
 * mantém 90%, o último valor da lei.
 */
export function percentualFioB(ano: number): number {
  if (ano <= 2023) return 0.15;
  if (ano === 2024) return 0.3;
  if (ano === 2025) return 0.45;
  if (ano === 2026) return 0.6;
  if (ano === 2027) return 0.75;
  return 0.9;
}

/** Área aproximada de um módulo com folga de instalação, em m². */
export const AREA_POR_MODULO_M2 = 2.8;

/** Área mínima do telhado: pelos módulos, ou, sem eles, ~4,5 m² por kWp. */
export function areaMinimaM2(kwp: number, modulos: number | null): number {
  return Math.ceil(modulos && modulos > 0 ? modulos * AREA_POR_MODULO_M2 : kwp * 4.5);
}

/** A geração de cada mês do ano, em kWh. */
export function geracaoMensal(kwp: number, p: Pick<Premissas, "irradiacaoDia" | "desempenho">): number[] {
  const media = kwp * p.irradiacaoDia * p.desempenho * (365 / 12);
  return FATORES_MENSAIS.map((f) => media * f);
}

export interface SugestaoDeSistema {
  /** Quantos módulos (nulo sem a potência do módulo). */
  modulos: number | null;
  kwp: number;
  geracaoMes: number;
}

/**
 * O tamanho do sistema para zerar a conta: a energia que dá para compensar (o
 * consumo menos o mínimo da distribuidora) dividida pelo que cada kWp gera no
 * mês. Com a potência do módulo, arredonda para cima em módulos inteiros.
 *
 * É a conta do "orçamento preliminar" do passo 1 da proposta; quem vende
 * confere e ajusta (aumento de consumo previsto, telhado pequeno).
 */
export function sugerirSistema(
  consumoKwh: number,
  ligacao: Ligacao,
  p: Pick<Premissas, "irradiacaoDia" | "desempenho">,
  moduloW?: number | null,
): SugestaoDeSistema | null {
  const compensavel = consumoKwh - DISPONIBILIDADE_KWH[ligacao];
  const porKwp = p.irradiacaoDia * p.desempenho * (365 / 12);
  if (!(compensavel > 0) || !(porKwp > 0)) return null;
  const bruto = compensavel / porKwp;
  if (moduloW && moduloW > 0) {
    const modulos = Math.ceil((bruto * 1000) / moduloW - 1e-9);
    const kwp = (modulos * moduloW) / 1000;
    return { modulos, kwp, geracaoMes: kwp * porKwp };
  }
  const kwp = Math.ceil(bruto * 100) / 100;
  return { modulos: null, kwp, geracaoMes: kwp * porKwp };
}

export interface EntradaDoCalculo {
  kwp: number;
  /** Consumo médio mensal, em kWh. */
  consumoKwh: number;
  /** Investimento total, em R$. */
  investimento: number;
  ligacao: Ligacao;
  /** O ano em que a proposta é feita: define o percentual do Fio B no primeiro ano. */
  anoBase: number;
}

export interface ResultadoDoCalculo {
  geracaoMes: number[];
  geracaoMediaMes: number;
  producaoAno: number;
  /** A conta de um mês médio do 1º ano, sem solar e com solar. */
  contaSemMes: number;
  contaComMes: number;
  economiaMes: number;
  economiaAno1: number;
  economia5: number;
  economia25: number;
  /** Meses até a economia pagar o investimento; nulo se não paga em 25 anos. */
  paybackMeses: number | null;
  /** Caixa acumulado no fim de cada ano, do ano 0 (−investimento) ao 25. */
  fluxo: number[];
}

/** Um ano de operação: o que se paga sem e com solar, em R$. */
function umAno(
  e: EntradaDoCalculo,
  p: Premissas,
  geracaoAno: number,
  tarifa: number,
  fioB: number,
  pctFioB: number,
): { sem: number; com: number } {
  const consumoAno = e.consumoKwh * 12;
  const disponibilidadeAno = DISPONIBILIDADE_KWH[e.ligacao] * 12;
  // O que é gasto na hora não passa pela rede: não vira crédito nem paga Fio B.
  const naHora = Math.min(consumoAno * p.simultaneidade, geracaoAno);
  const injetada = geracaoAno - naHora;
  const daRede = consumoAno - naHora;
  // O crédito não abate o custo de disponibilidade.
  const compensada = Math.min(injetada, Math.max(0, daRede - disponibilidadeAno));
  const faturado = daRede - compensada;
  return { sem: consumoAno * tarifa, com: faturado * tarifa + compensada * fioB * pctFioB };
}

export function calcular(e: EntradaDoCalculo, p: Premissas): ResultadoDoCalculo {
  const geracaoMes = geracaoMensal(e.kwp, p);
  const producaoAno = geracaoMes.reduce((a, b) => a + b, 0);

  const economiaPorAno: number[] = [];
  for (let i = 0; i < 25; i++) {
    const reajuste = (1 + p.reajusteAnual) ** i;
    const { sem, com } = umAno(e, p, producaoAno * (1 - p.degradacaoAnual) ** i, p.tarifaKwh * reajuste, p.fioBKwh * reajuste, percentualFioB(e.anoBase + i));
    economiaPorAno.push(sem - com);
  }

  const primeiro = umAno(e, p, producaoAno, p.tarifaKwh, p.fioBKwh, percentualFioB(e.anoBase));
  const fluxo = [-e.investimento];
  for (const x of economiaPorAno) fluxo.push(fluxo[fluxo.length - 1] + x);

  let paybackMeses: number | null = null;
  for (let ano = 0; ano < 25; ano++) {
    if (fluxo[ano + 1] >= 0) {
      // Dentro do ano a economia corre por igual, mês a mês.
      const falta = -fluxo[ano];
      paybackMeses = Math.ceil(ano * 12 + (falta / economiaPorAno[ano]) * 12);
      break;
    }
  }

  const soma = (n: number) => economiaPorAno.slice(0, n).reduce((a, b) => a + b, 0);
  return {
    geracaoMes,
    geracaoMediaMes: producaoAno / 12,
    producaoAno,
    contaSemMes: primeiro.sem / 12,
    contaComMes: primeiro.com / 12,
    economiaMes: (primeiro.sem - primeiro.com) / 12,
    economiaAno1: primeiro.sem - primeiro.com,
    economia5: soma(5),
    economia25: soma(25),
    paybackMeses,
    fluxo,
  };
}

// ----------------------------------------------------------------- formatação

const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

/** "R$ 10.431,95" (com espaço comum, como no modelo). */
export function moeda(valor: number): string {
  return BRL.format(valor).replace(/ /g, " ");
}

/** "447 kWh", arredondado. */
export function kwhTexto(valor: number): string {
  return `${Math.round(valor).toLocaleString("pt-BR")} kWh`;
}

/** "3,72 kWp". */
export function kwpTexto(valor: number): string {
  return `${valor.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 3 })} kWp`;
}

/** "2 anos e 4 meses", "1 ano", "8 meses". Nulo (não paga em 25 anos) vira um traço. */
export function rotuloDoPayback(meses: number | null): string {
  if (meses === null) return "—";
  const anos = Math.floor(meses / 12);
  const resto = meses % 12;
  const a = anos ? `${anos} ${anos === 1 ? "ano" : "anos"}` : "";
  const m = resto ? `${resto} ${resto === 1 ? "mês" : "meses"}` : "";
  return [a, m].filter(Boolean).join(" e ") || "menos de 1 mês";
}
