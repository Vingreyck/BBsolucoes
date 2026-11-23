/**
 * A simulação da proposta, mês a mês: a geração da usina, o consumo de cada
 * unidade consumidora, o rateio do excedente entre elas, o banco de créditos e
 * a conta de cada uma com e sem a usina, por 25 anos. Sem banco — conferido
 * pelo `testar-regras.ts`.
 *
 * As regras são as da compensação de energia (REN ANEEL 1.000/2021, com a Lei
 * 14.300/2022):
 * - o que a casa consome **na hora** em que a usina gera não passa pela rede
 *   (simultaneidade): não vira crédito nem paga Fio B;
 * - o que vai para a rede compensa primeiro o consumo da própria geradora; o
 *   que sobra (o excedente) vai para as beneficiárias por **porcentagem** ou
 *   por **ordem de prioridade**, como a distribuidora registrou;
 * - crédito que não é usado no mês fica guardado e vence em **60 meses** (os
 *   mais antigos são usados primeiro);
 * - o crédito não abate o **custo de disponibilidade** (30, 50 ou 100 kWh);
 * - sobre a energia compensada se paga o Fio B no percentual da lei (60% em
 *   2026, 75% em 2027, 90% de 2028 em diante).
 */

import { DISPONIBILIDADE_KWH, percentualFioB, type Ligacao } from "./calculo";

export const DIAS_DO_MES = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const VALIDADE_DO_CREDITO_MESES = 60;

export interface UcDaSimulacao {
  id: string;
  nome: string;
  /** A unidade onde está a usina. Exatamente uma por simulação. */
  geradora: boolean;
  ligacao: Ligacao;
  /** Consumo de janeiro a dezembro, em kWh. */
  consumoMes: number[];
  /** R$ por kWh faturado, com impostos (TE + TUSD). */
  tarifa: number;
  /** TUSD Fio B cheia, R$ por kWh, com impostos. */
  fioB: number;
  /** Rateio por porcentagem: a fração do excedente (0 a 1). A geradora fica com o resto. */
  percentual?: number | null;
}

export type ModoDeRateio = "percentual" | "prioridade";

export interface EntradaDaSimulacao {
  kwp: number;
  /** Irradiação de janeiro a dezembro, kWh/m² por dia. */
  irradiacaoMensal: number[];
  /** Desempenho global (PR), 0 a 1. */
  desempenho: number;
  /** Fração do consumo da geradora atendida na hora (0 a 1). */
  simultaneidade: number;
  /** A geradora primeiro, depois as beneficiárias, na ordem de prioridade. */
  ucs: UcDaSimulacao[];
  rateio: ModoDeRateio;
  investimento: number;
  reajusteAnual: number;
  degradacaoAnual: number;
  /** Taxa de desconto ao ano, para o valor presente. */
  tma: number;
  /** O ano em que a usina começa a gerar (define o percentual do Fio B). */
  anoBase: number;
  anos?: number;
}

export interface ResultadoDaUc {
  id: string;
  nome: string;
  geradora: boolean;
  consumoAno: number;
  /** Conta média de um mês do 1º ano, sem e com a usina. */
  contaSemMes: number;
  contaComMes: number;
  economiaMes: number;
  /** kWh compensados no 1º ano. */
  compensadoAno: number;
  /** Créditos guardados no fim do 1º ano (kWh). */
  creditosFimAno1: number;
}

export interface ResultadoDaSimulacao {
  /** Geração de cada mês do 1º ano (kWh). */
  geracaoMes: number[];
  geracaoMediaMes: number;
  producaoAno: number;
  /** Consumo somado das unidades, mês a mês. */
  consumoMes: number[];
  consumoAno: number;
  ucs: ResultadoDaUc[];
  contaSemMes: number;
  contaComMes: number;
  economiaMes: number;
  economiaAno1: number;
  economia5: number;
  economia25: number;
  /** Economia de cada ano, do 1º ao último. */
  economiaPorAno: number[];
  /** Caixa acumulado no fim de cada ano, do ano 0 (−investimento) ao último. */
  fluxo: number[];
  paybackMeses: number | null;
  paybackDescontadoMeses: number | null;
  /** Taxa interna de retorno ao ano (fração), ou nulo se não houver. */
  tir: number | null;
  /** Valor presente líquido à TMA. */
  vpl: number;
  /** Custo de cada kWh gerado em 25 anos, trazido a valor presente (R$/kWh). */
  custoKwh: number | null;
  /** Créditos que sobram ao fim do 1º ano, somadas as unidades (kWh). */
  sobraCreditosAno1: number;
  /** Geração ÷ consumo que dá para compensar (1 = zera as contas). */
  cobertura: number;
}

/** A geração de cada mês, em kWh, no ano `ano` (0 = primeiro), com a perda dos módulos. */
export function geracaoDoAno(kwp: number, irradiacao: number[], desempenho: number, degradacao: number, ano: number): number[] {
  const fator = (1 - degradacao) ** ano;
  return DIAS_DO_MES.map((d, m) => kwp * (irradiacao[m] ?? 0) * d * desempenho * fator);
}

/** Quanto cada kWp gera num ano, em kWh (sem perda de módulo). */
export function geracaoPorKwpAno(irradiacao: number[], desempenho: number): number {
  return geracaoDoAno(1, irradiacao, desempenho, 0, 0).reduce((a, b) => a + b, 0);
}

interface Lote {
  kwh: number;
  vence: number;
}

/** Usa créditos do banco (os mais antigos primeiro) até `precisa`. Devolve quanto usou. */
function usarCreditos(banco: Lote[], precisa: number, mesAbsoluto: number): number {
  // Tira os vencidos.
  while (banco.length && banco[0].vence < mesAbsoluto) banco.shift();
  let usado = 0;
  while (precisa - usado > 1e-9 && banco.length) {
    const l = banco[0];
    const tira = Math.min(l.kwh, precisa - usado);
    l.kwh -= tira;
    usado += tira;
    if (l.kwh <= 1e-9) banco.shift();
  }
  return usado;
}

function saldo(banco: Lote[], mesAbsoluto: number): number {
  return banco.filter((l) => l.vence >= mesAbsoluto).reduce((s, l) => s + l.kwh, 0);
}

/** Taxa interna de retorno (ao ano) dos fluxos anuais [−investimento, e1, e2…], por bisseção. */
export function taxaInternaDeRetorno(fluxos: number[]): number | null {
  const vpl = (t: number) => fluxos.reduce((s, f, i) => s + f / (1 + t) ** i, 0);
  let baixo = -0.99;
  let alto = 10;
  const vBaixo = vpl(baixo);
  const vAlto = vpl(alto);
  if (!(Number.isFinite(vBaixo) && Number.isFinite(vAlto)) || vBaixo * vAlto > 0) return null;
  for (let i = 0; i < 200; i++) {
    const meio = (baixo + alto) / 2;
    const v = vpl(meio);
    if (Math.abs(v) < 1e-7) return meio;
    if (v * vBaixo > 0) baixo = meio;
    else alto = meio;
  }
  return (baixo + alto) / 2;
}

/** Meses até o caixa acumulado ficar positivo, correndo a economia do ano por igual entre os meses. */
function mesesDeRetorno(investimento: number, porAno: number[]): number | null {
  let caixa = -investimento;
  for (let ano = 0; ano < porAno.length; ano++) {
    if (caixa + porAno[ano] >= 0) {
      if (porAno[ano] <= 0) return null;
      return Math.max(1, Math.ceil(ano * 12 + (-caixa / porAno[ano]) * 12));
    }
    caixa += porAno[ano];
  }
  return null;
}

export function simular(e: EntradaDaSimulacao): ResultadoDaSimulacao {
  const anos = e.anos ?? 25;
  const ucs = e.ucs;
  const iGer = Math.max(0, ucs.findIndex((u) => u.geradora));
  const bancos: Lote[][] = ucs.map(() => []);
  const disp = ucs.map((u) => DISPONIBILIDADE_KWH[u.ligacao]);
  const somaPct = ucs.reduce((s, u, i) => s + (i !== iGer && e.rateio === "percentual" ? Math.max(0, u.percentual ?? 0) : 0), 0);
  const fatorPct = somaPct > 1 ? 1 / somaPct : 1; // passou de 100%: reduz na proporção

  const economiaPorAno: number[] = [];
  const geracaoAno1: number[] = [];
  const porUc = ucs.map((u) => ({ sem: 0, com: 0, compensado: 0 }));
  let creditosFim1: number[] = ucs.map(() => 0);
  let geracaoTotalDescontada = 0;

  for (let ano = 0; ano < anos; ano++) {
    const reaj = (1 + e.reajusteAnual) ** ano;
    const pct = percentualFioB(e.anoBase + ano);
    const geracao = geracaoDoAno(e.kwp, e.irradiacaoMensal, e.desempenho, e.degradacaoAnual, ano);
    if (ano === 0) geracaoAno1.push(...geracao);
    geracaoTotalDescontada += geracao.reduce((a, b) => a + b, 0) / (1 + e.tma) ** ano;
    let semAno = 0;
    let comAno = 0;

    for (let m = 0; m < 12; m++) {
      const mesAbs = ano * 12 + m;
      const gen = geracao[m];
      // O que a geradora consome na hora em que a usina gera.
      const consGer = ucs[iGer].consumoMes[m] ?? 0;
      const naHora = Math.min(consGer * e.simultaneidade, gen);
      let injetado = gen - naHora;

      // Quanto cada unidade ainda pode compensar neste mês (o que puxou da rede menos o mínimo).
      const daRede = ucs.map((u, i) => (i === iGer ? consGer - naHora : (u.consumoMes[m] ?? 0)));
      const precisa = daRede.map((r, i) => Math.max(0, r - disp[i]));
      const compensado = ucs.map(() => 0);

      // 1) A geradora compensa o próprio consumo com o que acabou de injetar.
      const proprio = Math.min(injetado, precisa[iGer]);
      compensado[iGer] += proprio;
      injetado -= proprio;

      // 2) O excedente vai para as beneficiárias.
      const recebe = ucs.map(() => 0);
      if (e.rateio === "percentual") {
        let distribuido = 0;
        ucs.forEach((u, i) => {
          if (i === iGer) return;
          const parte = injetado * Math.max(0, u.percentual ?? 0) * fatorPct;
          recebe[i] += parte;
          distribuido += parte;
        });
        recebe[iGer] += injetado - distribuido;
      } else {
        let resta = injetado;
        ucs.forEach((_, i) => {
          if (i === iGer || resta <= 0) return;
          const parte = Math.min(resta, precisa[i]);
          recebe[i] += parte;
          resta -= parte;
        });
        recebe[iGer] += resta;
      }

      // 3) Cada unidade usa o que recebeu, depois o banco; a sobra vira crédito.
      ucs.forEach((_, i) => {
        const falta = precisa[i] - compensado[i];
        const doMes = Math.min(recebe[i], falta);
        compensado[i] += doMes;
        const sobra = recebe[i] - doMes;
        compensado[i] += usarCreditos(bancos[i], precisa[i] - compensado[i], mesAbs);
        if (sobra > 1e-9) bancos[i].push({ kwh: sobra, vence: mesAbs + VALIDADE_DO_CREDITO_MESES });
      });
      // Na prioridade, o crédito que sobrou na geradora segue a mesma ordem nos meses seguintes.
      if (e.rateio === "prioridade") {
        ucs.forEach((_, i) => {
          if (i === iGer) return;
          const falta = precisa[i] - compensado[i];
          if (falta > 1e-9) compensado[i] += usarCreditos(bancos[iGer], falta, mesAbs);
        });
      }

      // 4) As contas do mês.
      ucs.forEach((u, i) => {
        const tarifa = u.tarifa * reaj;
        const fioB = u.fioB * reaj;
        const consumo = u.consumoMes[m] ?? 0;
        const sem = Math.max(consumo, disp[i]) * tarifa;
        const faturado = Math.max(daRede[i] - compensado[i], disp[i]);
        const com = faturado * tarifa + compensado[i] * fioB * pct;
        semAno += sem;
        comAno += com;
        if (ano === 0) {
          porUc[i].sem += sem;
          porUc[i].com += com;
          porUc[i].compensado += compensado[i];
        }
      });
    }
    if (ano === 0) creditosFim1 = bancos.map((b) => saldo(b, 12));
    economiaPorAno.push(semAno - comAno);
  }

  const fluxo = [-e.investimento];
  for (const x of economiaPorAno) fluxo.push(fluxo[fluxo.length - 1] + x);
  const descontado = economiaPorAno.map((x, i) => x / (1 + e.tma) ** (i + 1));
  const vpl = -e.investimento + descontado.reduce((a, b) => a + b, 0);
  const soma = (n: number) => economiaPorAno.slice(0, n).reduce((a, b) => a + b, 0);
  const producaoAno = geracaoAno1.reduce((a, b) => a + b, 0);
  const consumoMes = Array.from({ length: 12 }, (_, m) => ucs.reduce((s, u) => s + (u.consumoMes[m] ?? 0), 0));
  const consumoAno = consumoMes.reduce((a, b) => a + b, 0);
  const compensavelAno = ucs.reduce((s, u, i) => s + Math.max(0, u.consumoMes.reduce((a, b) => a + b, 0) - disp[i] * 12), 0);
  const semMes = porUc.reduce((s, x) => s + x.sem, 0) / 12;
  const comMes = porUc.reduce((s, x) => s + x.com, 0) / 12;

  return {
    geracaoMes: geracaoAno1,
    geracaoMediaMes: producaoAno / 12,
    producaoAno,
    consumoMes,
    consumoAno,
    ucs: ucs.map((u, i) => ({
      id: u.id,
      nome: u.nome,
      geradora: i === iGer,
      consumoAno: u.consumoMes.reduce((a, b) => a + b, 0),
      contaSemMes: porUc[i].sem / 12,
      contaComMes: porUc[i].com / 12,
      economiaMes: (porUc[i].sem - porUc[i].com) / 12,
      compensadoAno: porUc[i].compensado,
      creditosFimAno1: creditosFim1[i],
    })),
    contaSemMes: semMes,
    contaComMes: comMes,
    economiaMes: semMes - comMes,
    economiaAno1: economiaPorAno[0] ?? 0,
    economia5: soma(5),
    economia25: soma(25),
    economiaPorAno,
    fluxo,
    paybackMeses: mesesDeRetorno(e.investimento, economiaPorAno),
    paybackDescontadoMeses: mesesDeRetorno(e.investimento, descontado),
    tir: taxaInternaDeRetorno([-e.investimento, ...economiaPorAno]),
    vpl,
    custoKwh: geracaoTotalDescontada > 0 ? e.investimento / geracaoTotalDescontada : null,
    sobraCreditosAno1: creditosFim1.reduce((a, b) => a + b, 0),
    cobertura: compensavelAno > 0 ? producaoAno / compensavelAno : 0,
  };
}

/**
 * O consumo de 12 meses a partir do que foi digitado: a média repetida, ou os
 * meses (os vazios recebem a média dos preenchidos).
 */
export function consumoDosMeses(media: number | null, meses: (number | null)[] | null): number[] | null {
  const preenchidos = (meses ?? []).filter((v): v is number => v !== null && Number.isFinite(v) && v >= 0);
  if (meses && preenchidos.length >= 1) {
    const m = preenchidos.reduce((a, b) => a + b, 0) / preenchidos.length;
    return Array.from({ length: 12 }, (_, i) => {
      const v = meses[i];
      return v !== null && v !== undefined && Number.isFinite(v) && v >= 0 ? v : m;
    });
  }
  if (media !== null && Number.isFinite(media) && media > 0) return Array.from({ length: 12 }, () => media);
  return null;
}
