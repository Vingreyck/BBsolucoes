/**
 * A proposta comercial: o que falta para gerar, a fotografia dos dados e a
 * mensagem do WhatsApp. Sem banco — conferido pelo `testar-regras.ts`.
 *
 * O PDF segue o modelo que a BB Soluções já usa (capa, passo a passo, sistema e
 * garantias, geração e finanças, monitoramento, investimento, pós-venda).
 */

import { estruturaDoTelhado } from "@/projeto/da-vistoria";
import { rotuloDoModelo, type ModeloDoKit } from "@/projeto/kit";

import { areaMinimaM2, calcular, percentualFioB, type Ligacao } from "./calculo";
import type { Premissas } from "./premissas";

/**
 * A empresa como a proposta mostra. Tudo além do nome é opcional: propostas
 * gravadas antes destes campos continuam abrindo.
 */
export interface EmpresaDaProposta {
  nome: string;
  razaoSocial?: string | null;
  cnpj?: string | null;
  endereco?: string | null;
  email?: string | null;
  /** Usinas acompanhadas hoje (não arquivadas): a faixa da página de monitoramento. */
  usinas?: number | null;
}

export interface EntradaProposta {
  empresa: EmpresaDaProposta;
  cliente: { nome: string; cidade: string | null; uf: string | null };
  responsavel: { nome: string; contato: string | null } | null;
  projeto: {
    potenciaKwp: string | number | null;
    valor: string | number | null;
    consumoMedioKwh: string | number | null;
    equipamentos: string | null;
    telhadoTipo: string | null;
  };
  inversor: ModeloDoKit | null;
  inversorQtd: number | null;
  modulo: ModeloDoKit | null;
  moduloQtd: number | null;
  ligacao: Ligacao;
  premissas: Premissas | null;
}

/**
 * Lê o número como se digita no Brasil: "10.431,95", "R$ 10431,95", "3,72".
 * Com vírgula, o ponto é milhar; sem vírgula, só é milhar se for "10.431" (grupos
 * de três). Nulo se não for número ou não for positivo.
 */
export function lerNumeroBr(texto: unknown): number | null {
  if (typeof texto !== "string") return null;
  let t = texto.replace(/R\$|\s/g, "");
  if (!t) return null;
  if (t.includes(",")) t = t.replace(/\./g, "").replace(",", ".");
  else if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, "");
  const n = Number(t);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function positivo(v: string | number | null | undefined): number | null {
  const n = typeof v === "string" ? Number(v.replace(",", ".")) : Number(v);
  return v === null || v === undefined || v === "" || !Number.isFinite(n) || n <= 0 ? null : n;
}

/** A potência do sistema: a do projeto ou, sem ela, módulos × potência de cada um. */
export function kwpDoProjeto(e: Pick<EntradaProposta, "projeto" | "modulo" | "moduloQtd">): number | null {
  const direta = positivo(e.projeto.potenciaKwp);
  if (direta) return direta;
  const w = positivo(e.modulo?.potenciaW);
  return w && e.moduloQtd && e.moduloQtd > 0 ? (w * e.moduloQtd) / 1000 : null;
}

/** As linhas do kit como a proposta mostra: "6 placas Jinko Tiger Neo (585 W)". */
function linhasDoKit(e: EntradaProposta): { modulos: string | null; inversores: string | null; texto: string | null } {
  const qtd = (n: number | null) => (n && n > 0 ? n : 1);
  const modulos = e.modulo ? `${qtd(e.moduloQtd)} ${qtd(e.moduloQtd) === 1 ? "placa" : "placas"} ${rotuloDoModelo(e.modulo)}` : null;
  const inversores = e.inversor ? `${qtd(e.inversorQtd)} ${rotuloDoModelo(e.inversor)}` : null;
  return { modulos, inversores, texto: e.projeto.equipamentos?.trim() || null };
}

/** O que falta para a proposta sair completa, em palavras. Vazio = pode gerar. */
export function faltaParaProposta(e: EntradaProposta): string[] {
  const falta: string[] = [];
  if (!e.premissas) falta.push("as premissas do cálculo (Administração → Proposta comercial)");
  if (!e.cliente.cidade?.trim()) falta.push("a cidade do cliente");
  if (!kwpDoProjeto(e)) falta.push("a potência do sistema (kWp)");
  const kit = linhasDoKit(e);
  if (!kit.modulos && !kit.inversores && !kit.texto) falta.push("o kit de equipamentos (módulo e inversor)");
  if (!positivo(e.projeto.valor)) falta.push("o valor do investimento");
  if (!positivo(e.projeto.consumoMedioKwh)) falta.push("o consumo médio mensal (kWh)");
  return falta;
}

export interface DadosProposta {
  numero: number;
  criadaEm: string;
  validaAte: string;
  empresa: EmpresaDaProposta;
  cliente: { nome: string; cidade: string; uf: string | null };
  responsavel: { nome: string; contato: string | null } | null;
  sistema: {
    kwp: number;
    modulos: string | null;
    inversores: string | null;
    equipamentosTexto: string | null;
    areaM2: number;
    estrutura: string;
  };
  garantias: Premissas["garantias"];
  energia: {
    consumoMedio: number;
    geracaoMes: number[];
    geracaoMedia: number;
    producaoAno: number;
    irradiacaoDia: number;
  };
  financeiro: {
    investimento: number;
    contaSemMes: number;
    contaComMes: number;
    economiaMes: number;
    economiaAno1: number;
    economia5: number;
    economia25: number;
    paybackMeses: number | null;
    fluxo: number[];
  };
  pagamento: { parcelas: number; taxaMes: number; carenciaDias: number };
  premissas: {
    tarifaKwh: number;
    desempenho: number;
    reajusteAnual: number;
    degradacaoAnual: number;
    fioBPercentual: number;
    simultaneidade: number;
  };
}

const FUSO = "America/Sao_Paulo";

/** "13/11/2026", no fuso de Sergipe (o servidor roda em UTC). */
export function dataCurta(d: Date): string {
  return d.toLocaleDateString("pt-BR", { timeZone: FUSO, day: "2-digit", month: "2-digit", year: "numeric" });
}

export function anoDe(d: Date): number {
  return Number(d.toLocaleDateString("en-CA", { timeZone: FUSO, year: "numeric" }).slice(0, 4));
}

/** "Telhado - Fibrocimento", "Laje", ou "A definir na vistoria". */
export function estruturaDaProposta(tipo: string | null | undefined): string {
  if (!tipo || !estruturaDoTelhado(tipo)) return tipo === "Outro" ? "Outro tipo de estrutura" : "A definir na vistoria";
  return tipo === "Laje" ? "Laje" : `Telhado - ${tipo}`;
}

/**
 * A fotografia da proposta: tudo o que o PDF mostra, já calculado. Quem chama
 * confere `faltaParaProposta` antes; aqui, falta de dado é erro de programação.
 */
export function montarProposta(e: EntradaProposta, numero: number, hoje: Date = new Date()): DadosProposta {
  const p = e.premissas;
  const kwp = kwpDoProjeto(e);
  const investimento = positivo(e.projeto.valor);
  const consumo = positivo(e.projeto.consumoMedioKwh);
  if (!p || !kwp || !investimento || !consumo || !e.cliente.cidade) {
    throw new Error("Faltam dados para montar a proposta.");
  }
  const anoBase = anoDe(hoje);
  const r = calcular({ kwp, consumoKwh: consumo, investimento, ligacao: e.ligacao, anoBase }, p);
  const kit = linhasDoKit(e);
  const valida = new Date(hoje.getTime() + p.validadeDias * 86_400_000);
  const modulos = e.moduloQtd && e.moduloQtd > 0 ? e.moduloQtd : null;
  return {
    numero,
    criadaEm: dataCurta(hoje),
    validaAte: dataCurta(valida),
    empresa: { ...e.empresa },
    cliente: { nome: e.cliente.nome, cidade: e.cliente.cidade.trim(), uf: e.cliente.uf?.trim().toUpperCase() || null },
    responsavel: e.responsavel,
    sistema: {
      kwp,
      modulos: kit.modulos,
      inversores: kit.inversores,
      equipamentosTexto: kit.modulos || kit.inversores ? null : kit.texto,
      areaM2: areaMinimaM2(kwp, modulos),
      estrutura: estruturaDaProposta(e.projeto.telhadoTipo),
    },
    garantias: p.garantias,
    energia: {
      consumoMedio: consumo,
      geracaoMes: r.geracaoMes,
      geracaoMedia: r.geracaoMediaMes,
      producaoAno: r.producaoAno,
      irradiacaoDia: p.irradiacaoDia,
    },
    financeiro: {
      investimento,
      contaSemMes: r.contaSemMes,
      contaComMes: r.contaComMes,
      economiaMes: r.economiaMes,
      economiaAno1: r.economiaAno1,
      economia5: r.economia5,
      economia25: r.economia25,
      paybackMeses: r.paybackMeses,
      fluxo: r.fluxo,
    },
    pagamento: { parcelas: p.cartao.parcelas, taxaMes: p.cartao.taxaMes, carenciaDias: p.carenciaFinanciamentoDias },
    premissas: {
      tarifaKwh: p.tarifaKwh,
      desempenho: p.desempenho,
      reajusteAnual: p.reajusteAnual,
      degradacaoAnual: p.degradacaoAnual,
      fioBPercentual: percentualFioB(anoBase),
      simultaneidade: p.simultaneidade,
    },
  };
}

/** A mensagem que vai com o link da proposta pelo WhatsApp. */
export function mensagemDaProposta(d: { cliente: string; empresa: string; link: string; validaAte: string }): string {
  const nome = d.cliente.trim().split(/\s+/)[0] ?? "";
  const primeiro = nome ? nome.charAt(0).toUpperCase() + nome.slice(1).toLowerCase() : "";
  return [
    `Olá${primeiro ? `, ${primeiro}` : ""}! Aqui é da ${d.empresa}. Segue a sua proposta comercial de energia solar:`,
    d.link,
    "",
    `Ela é válida até ${d.validaAte}. Qualquer dúvida, é só chamar. Obrigado!`,
  ].join("\n");
}

/** O nome do arquivo: "Proposta 209 - Evelyn dos Santos.pdf". */
export function nomeDaProposta(d: Pick<DadosProposta, "numero" | "cliente">): string {
  const nome = d.cliente.nome.replace(/[\\/:*?"<>|]/g, " ").replace(/\s+/g, " ").trim();
  return `Proposta ${d.numero} - ${nome}.pdf`;
}
