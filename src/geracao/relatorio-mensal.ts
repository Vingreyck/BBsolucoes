/**
 * As contas do relatório mensal de geração — sem banco e sem PDF, para o
 * `testar-regras.ts` conferir.
 *
 * O que o relatório afirma ao cliente tem de ser defensável:
 *
 * - **Desempenho é kWh por kWp por dia**, a régua que não depende do tamanho da
 *   usina, comparado com **as outras usinas da empresa no mesmo mês** (a
 *   mediana do parque). A média anual de Sergipe (1.300 a 1.800 kWh/kWp/ano)
 *   não serve mês a mês: em outubro quase todo o parque passou de 4,9 por dia
 *   e sairia "acima"; em junho, o contrário. As usinas vizinhas tiveram o mesmo
 *   sol, então a comparação com elas é justa. Abaixo de 75% da mediana é
 *   "abaixo do esperado".
 *
 * - **Potência impossível não vira avaliação.** Acima de 8 kWh/kWp/dia não
 *   existe em Sergipe — é potência cadastrada errada (a planilha da Growatt
 *   trouxe kWp onde se esperava watts, e 7 kWp virou 0,007). A usina sai como
 *   "suspeita": o relatório não fala de desempenho, e a tela pede para
 *   conferir a potência.
 *
 * - **Dia sem dado não é dia sem geração.** O portal do fabricante às vezes não
 *   entrega o dia (internet do cliente caiu, o inversor ficou sem Wi-Fi). Por
 *   isso o desempenho sai da média dos dias **com** dado, e o relatório diz
 *   quantos dias faltaram — em vez de dividir o total pelo mês inteiro e acusar
 *   a usina de gerar pouco.
 */

/** kWh por kWp por dia em Sergipe: 1.300 a 1.800 kWh/kWp/ano. Só a rede de segurança sem parque para comparar. */
export const FAIXA_SERGIPE = { min: 1300 / 365, max: 1800 / 365 };

/** kWh por kWp por dia acima do qual a conta não fecha: é a potência que está errada. */
export const LIMITE_IMPOSSIVEL = 8;

/** Abaixo desta fração da mediana do parque no mês, a usina gerou menos que as vizinhas. */
export const FRACAO_ABAIXO = 0.75;

/** Com menos usinas que isto, a mediana não vale como régua. */
const USINAS_MINIMAS_NA_REGUA = 5;

/** Com menos dias que isto, o mês não dá base para dizer se a usina vai bem. */
export const DIAS_MINIMOS_PARA_AVALIAR = 7;

export type Faixa = "abaixo" | "dentro" | "suspeita";

export interface DiaGerado {
  /** "2026-10-05" */
  dia: string;
  kwh: number;
}

export interface ResumoDoMes {
  mes: string;
  totalKwh: number;
  diasNoMes: number;
  diasComDado: number;
  diasSemDado: number;
  /** Média dos dias com dado. */
  mediaDiaKwh: number | null;
  kwhPorKwpDia: number | null;
  faixa: Faixa | null;
  /** A mediana do parque no mês (kWh/kWp/dia), quando houve parque para comparar. */
  referencia: number | null;
  melhorDia: DiaGerado | null;
  /** Um valor por dia do mês, nulo onde o portal não entregou. */
  serie: (number | null)[];
}

/** "2026-10" → 31 */
export function diasDoMes(mes: string): number {
  const [a, m] = mes.split("-").map(Number);
  return new Date(Date.UTC(a, m, 0)).getUTCDate();
}

/** "2026-10" → "2026-09"; "2026-01" → "2025-12". */
export function mesAnterior(mes: string): string {
  const [a, m] = mes.split("-").map(Number);
  const d = new Date(Date.UTC(a, m - 2, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** O mês fechado mais recente: em 05/11, outubro. */
export function ultimoMesFechado(agora = new Date()): string {
  const d = new Date(Date.UTC(agora.getFullYear(), agora.getMonth() - 1, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function mesValido(mes: string | undefined | null): mes is string {
  return Boolean(mes && /^\d{4}-(0[1-9]|1[0-2])$/.test(mes));
}

const MESES = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

/** "2026-10" → "outubro de 2026" */
export function mesLegivel(mes: string): string {
  const [a, m] = mes.split("-").map(Number);
  return `${MESES[m - 1]} de ${a}`;
}

/**
 * A régua do mês: a mediana de kWh/kWp/dia das usinas do parque, deixando de
 * fora as impossíveis (potência errada) e as quase paradas (que puxariam a
 * régua para baixo e esconderiam justamente quem está mal).
 */
export function referenciaDoParque(valores: (number | null)[]): number | null {
  const ok = valores.filter((v): v is number => v !== null && v >= 1 && v <= LIMITE_IMPOSSIVEL).sort((a, b) => a - b);
  if (ok.length < USINAS_MINIMAS_NA_REGUA) return null;
  const meio = Math.floor(ok.length / 2);
  return ok.length % 2 ? ok[meio] : (ok[meio - 1] + ok[meio]) / 2;
}

export function classificar(kwhPorKwpDia: number | null, referencia: number | null = null): Faixa | null {
  if (kwhPorKwpDia === null) return null;
  if (kwhPorKwpDia > LIMITE_IMPOSSIVEL) return "suspeita";
  const piso = referencia !== null ? referencia * FRACAO_ABAIXO : FAIXA_SERGIPE.min;
  return kwhPorKwpDia < piso ? "abaixo" : "dentro";
}

/** kWh/kWp/dia da usina no mês, sem avaliar — a matéria-prima da régua. */
export function rendimento(mes: string, dias: DiaGerado[], potenciaKwp: number | null): number | null {
  return resumirMes(mes, dias, potenciaKwp).kwhPorKwpDia;
}

export function resumirMes(
  mes: string,
  dias: DiaGerado[],
  potenciaKwp: number | null,
  referencia: number | null = null,
): ResumoDoMes {
  const n = diasDoMes(mes);
  const serie: (number | null)[] = Array.from({ length: n }, () => null);
  for (const d of dias) {
    if (!d.dia.startsWith(`${mes}-`) || !Number.isFinite(d.kwh) || d.kwh < 0) continue;
    const i = Number(d.dia.slice(8, 10)) - 1;
    if (i >= 0 && i < n) serie[i] = (serie[i] ?? 0) + d.kwh;
  }
  const comDado = serie.filter((v): v is number => v !== null);
  const totalKwh = comDado.reduce((a, b) => a + b, 0);
  const mediaDiaKwh = comDado.length ? totalKwh / comDado.length : null;
  const kwhPorKwpDia =
    mediaDiaKwh !== null && potenciaKwp && potenciaKwp > 0 && comDado.length >= DIAS_MINIMOS_PARA_AVALIAR
      ? mediaDiaKwh / potenciaKwp
      : null;
  let melhorDia: DiaGerado | null = null;
  serie.forEach((v, i) => {
    if (v !== null && (!melhorDia || v > melhorDia.kwh)) melhorDia = { dia: `${mes}-${String(i + 1).padStart(2, "0")}`, kwh: v };
  });
  return {
    mes,
    totalKwh,
    diasNoMes: n,
    diasComDado: comDado.length,
    diasSemDado: n - comDado.length,
    mediaDiaKwh,
    kwhPorKwpDia,
    faixa: classificar(kwhPorKwpDia, referencia),
    referencia,
    melhorDia,
    serie,
  };
}

/** "1.234" / "19,7" — número à brasileira, sem depender do Intl do servidor. */
export function numeroBr(valor: number, casas = 0): string {
  const [inteiro, decimal] = Math.abs(valor).toFixed(casas).split(".");
  const milhar = inteiro.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${valor < 0 ? "-" : ""}${milhar}${decimal ? `,${decimal}` : ""}`;
}

export const FRASE_DA_FAIXA: Record<"abaixo" | "dentro", string> = {
  abaixo: "abaixo do esperado para o mês",
  dentro: "dentro do esperado para o mês",
};

/**
 * A mensagem do WhatsApp: o número que importa já no texto, e o link para o
 * PDF. Usina abaixo do esperado não vira mensagem alarmista — vira "a nossa
 * equipe vai verificar", que é o que a empresa faz.
 */
export function mensagemDoRelatorio(d: {
  cliente: string;
  empresa: string;
  mes: string;
  resumo: ResumoDoMes;
  link: string;
}): string {
  const nome = d.cliente.trim().split(/\s+/)[0] ?? "";
  const nomeBonito = nome ? nome.charAt(0).toUpperCase() + nome.slice(1).toLowerCase() : "";
  const r = d.resumo;
  const linhas = [
    `Olá${nomeBonito ? `, ${nomeBonito}` : ""}! Aqui é da ${d.empresa}. Segue o relatório da sua usina solar em ${mesLegivel(d.mes)}:`,
    `☀️ Gerou ${numeroBr(r.totalKwh)} kWh${r.mediaDiaKwh !== null ? ` (média de ${numeroBr(r.mediaDiaKwh, 1)} kWh por dia)` : ""}.`,
  ];
  if (r.faixa === "abaixo") linhas.push("A geração ficou abaixo do esperado, e a nossa equipe vai verificar.");
  else if (r.faixa === "dentro") linhas.push(`Desempenho ${FRASE_DA_FAIXA.dentro}.`);
  linhas.push("", `Relatório completo: ${d.link}`);
  return linhas.join("\n");
}

/** "Relatorio-2026-10-Maria-Souza.pdf" */
export function nomeDoArquivo(mes: string, cliente: string): string {
  const limpo = cliente
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  return `Relatorio-${mes}-${limpo || "usina"}.pdf`;
}
