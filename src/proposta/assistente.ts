/**
 * O assistente da proposta comercial: o que se preenche em cada etapa e a conta
 * inteira a partir disso. Sem banco e sem servidor — a mesma conta roda na tela
 * (para mostrar o resultado enquanto se preenche) e no servidor (para gerar a
 * proposta), e é conferida pelo `testar-regras.ts`.
 *
 * As etapas seguem as do Solarz, com o que ele não tem:
 *  1. Cliente — cidade da instalação (o sol vem do Atlas do INPE) e responsável.
 *  2. Unidades consumidoras — a geradora e as beneficiárias, consumo pela média
 *     ou mês a mês, distribuidora (sugerida pela cidade), subgrupo, ligação e o
 *     rateio (porcentagem ou prioridade). Tarifa e Fio B vêm da ANEEL.
 *  3. Dimensionamento — perfis de desempenho e de simultaneidade, telhado e o
 *     tamanho que zera as contas.
 *  4. Kit — módulo e inversor (ou micros) da base da ANEEL ou do catálogo, com
 *     a quantidade sugerida e a checagem de CC/CA, entradas e fases.
 *  5. Custos — o kit, os custos da empresa, margem e imposto: o preço.
 *  6. Resumo — geração × consumo, conta de cada unidade, retorno, TIR e VPL.
 *  7. Gerar — formas de pagamento com as parcelas, e a proposta.
 */

import { DISPONIBILIDADE_KWH, ehLigacao, percentualFioB, type Ligacao } from "./calculo";
import {
  areaDosModulos,
  avaliarKit,
  modulosParaPotencia,
  potenciaNecessariaKwp,
  relacaoCcCa,
  sugerirInversores,
  type AvisoDoKit,
  type InversorCandidato,
} from "./dimensionamento";
import { formasDePagamento, type FormasDePagamento } from "./pagamentos";
import { calcularPreco, margemDoPreco, type ResultadoDoPreco } from "./precificacao";
import type { Premissas } from "./premissas";
import { consumoDosMeses, simular, type ModoDeRateio, type ResultadoDaSimulacao, type UcDaSimulacao } from "./simulacao";
import { comImpostos, ehSubgrupo, type Subgrupo, type TarifaSemImpostos } from "./tarifas";

export const PASSOS = ["Cliente", "Unidades consumidoras", "Dimensionamento", "Kit", "Custos", "Resumo", "Gerar"] as const;

export type TipoDoKit = "modulo" | "inversor" | "microinversor";

/** Um equipamento no kit. `chave` é o id do catálogo da empresa ou da base. */
export interface LinhaDoKit {
  /** `modelo_equipamento.id`, quando já está no catálogo da empresa. */
  modeloId: string | null;
  /** O item da base pública (ANEEL), quando veio de lá. */
  baseId: string | null;
  tipo: TipoDoKit;
  fabricante: string;
  modelo: string;
  potenciaW: number;
  qtd: number;
  /** Custo de cada unidade para a empresa (do catálogo ou digitado). */
  precoUnitario: number | null;
  fases?: 1 | 3 | null;
  modulosPorUnidade?: number | null;
  areaM2?: number | null;
}

export interface UcDoAssistente {
  id: string;
  nome: string;
  /** O número da unidade na distribuidora (opcional). */
  codigo: string;
  geradora: boolean;
  distribuidoraCnpj: string | null;
  distribuidoraNome: string;
  subgrupo: Subgrupo;
  ligacao: Ligacao;
  consumoModo: "media" | "mensal";
  consumoMedia: number | null;
  consumoMeses: (number | null)[];
  /** Tarifa com impostos digitada à mão (vale sobre a da ANEEL). */
  tarifaManual: number | null;
  fioBManual: number | null;
  /** Rateio por porcentagem: fração do excedente (0 a 1). */
  percentual: number | null;
}

export interface EstadoDaProposta {
  versao: 2;
  passo: number;
  responsavelId: string | null;
  cidade: string;
  uf: string;
  ucs: UcDoAssistente[];
  rateio: ModoDeRateio;
  /** Irradiação de cada mês mudada à mão (kWh/m²·dia); nulo = a da cidade. */
  irradiacaoManual: number[] | null;
  perfilDesempenho: string | null;
  desempenho: number;
  perfilSimultaneidade: string | null;
  simultaneidade: number;
  telhado: string | null;
  /**
   * O kit se refaz sozinho quando o consumo, a cidade ou o perfil mudam: a
   * quantidade de módulos que zera as contas e o inversor que combina. Mexer à
   * mão na quantidade ou no inversor desliga; "Voltar ao automático" religa.
   */
  kitAutomatico: boolean;
  tipoInversor: "inversor" | "microinversor";
  modulo: LinhaDoKit | null;
  inversores: LinhaDoKit[];
  /** Outros itens do kit (estrutura, string box, cabos), com custo. */
  outrosItens: { nome: string; qtd: number; precoUnitario: number | null }[];
  /** O preço total do kit digitado (como no Solarz: "insira o valor total do kit"). Vale sobre a soma. */
  custoKitManual: number | null;
  /** Custos da empresa ligados/desligados ou com valor mudado nesta proposta. */
  ajustesDeCusto: Record<string, { ativo?: boolean; valor?: number }>;
  custosExtras: { nome: string; valor: number }[];
  /** Preço de venda escolhido à mão (desconto ou acréscimo); nulo = o sugerido. */
  precoFinal: number | null;
  validadeDias: number | null;
  observacoes: string;
}

/** O que a conta precisa de fora do estado: premissas, sol da cidade, tarifas, distância. */
export interface ContextoDoCalculo {
  premissas: Premissas;
  /** Irradiação de jan a dez da cidade (Atlas), kWh/m²·dia; nulo se a cidade não foi achada. */
  irradiacaoCidade: number[] | null;
  /** Tarifas sem impostos, por `chaveDaTarifa`. */
  tarifas: Record<string, TarifaSemImpostos | null>;
  /** Distância de ida da base da equipe até a cidade, km. */
  distanciaKm: number | null;
  anoBase: number;
}

export function chaveDaTarifa(cnpj: string | null | undefined, subgrupo: Subgrupo): string {
  return `${(cnpj ?? "").replace(/\D/g, "")}|${subgrupo}`;
}

/** Uma unidade em branco. A primeira da proposta é a geradora. */
export function novaUc(n: number, base?: Partial<UcDoAssistente>): UcDoAssistente {
  return {
    id: `uc-${n}`,
    nome: n === 1 ? "Unidade geradora" : `Unidade ${n}`,
    codigo: "",
    geradora: n === 1,
    distribuidoraCnpj: null,
    distribuidoraNome: "",
    subgrupo: "B1",
    ligacao: "bifasico",
    consumoModo: "media",
    consumoMedia: null,
    consumoMeses: Array.from({ length: 12 }, () => null),
    tarifaManual: null,
    fioBManual: null,
    percentual: null,
    ...base,
  };
}

// ------------------------------------------------------------- leitura segura

function num(v: unknown, min: number, max: number): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
}

function txt(v: unknown, max: number): string {
  return typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

function lerLinha(v: unknown, tipos: TipoDoKit[]): LinhaDoKit | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const tipo = tipos.includes(o.tipo as TipoDoKit) ? (o.tipo as TipoDoKit) : null;
  const potenciaW = num(o.potenciaW, 1, 500_000);
  const qtd = num(o.qtd, 0, 10_000);
  const fabricante = txt(o.fabricante, 80);
  const modelo = txt(o.modelo, 120);
  if (!tipo || potenciaW === null || qtd === null || !modelo) return null;
  const fases = o.fases === 1 || o.fases === 3 ? o.fases : null;
  return {
    modeloId: typeof o.modeloId === "string" && /^[0-9a-f-]{36}$/i.test(o.modeloId) ? o.modeloId : null,
    baseId: typeof o.baseId === "string" ? o.baseId.slice(0, 80) : null,
    tipo,
    fabricante,
    modelo,
    potenciaW,
    qtd: Math.round(qtd),
    precoUnitario: num(o.precoUnitario, 0, 10_000_000),
    fases,
    modulosPorUnidade: num(o.modulosPorUnidade, 1, 16),
    areaM2: num(o.areaM2, 0.1, 10),
  };
}

/**
 * O estado como veio do navegador (ou do rascunho guardado), sem confiar em
 * nada: o que não é do formato vira o valor em branco. Nunca falha.
 */
export function lerEstado(bruto: unknown): EstadoDaProposta | null {
  if (!bruto || typeof bruto !== "object") return null;
  const b = bruto as Record<string, unknown>;
  const ucsBrutas = Array.isArray(b.ucs) ? b.ucs.slice(0, 20) : [];
  const ucs: UcDoAssistente[] = ucsBrutas.map((x, i) => {
    const o = (x ?? {}) as Record<string, unknown>;
    const meses = Array.isArray(o.consumoMeses) ? o.consumoMeses : [];
    return novaUc(i + 1, {
      id: txt(o.id, 20) || `uc-${i + 1}`,
      nome: txt(o.nome, 60) || (i === 0 ? "Unidade geradora" : `Unidade ${i + 1}`),
      codigo: txt(o.codigo, 30),
      geradora: false,
      distribuidoraCnpj: typeof o.distribuidoraCnpj === "string" && /^\d{14}$/.test(o.distribuidoraCnpj) ? o.distribuidoraCnpj : null,
      distribuidoraNome: txt(o.distribuidoraNome, 80),
      subgrupo: ehSubgrupo(o.subgrupo) ? o.subgrupo : "B1",
      ligacao: ehLigacao(o.ligacao) ? o.ligacao : "bifasico",
      consumoModo: o.consumoModo === "mensal" ? "mensal" : "media",
      consumoMedia: num(o.consumoMedia, 0, 10_000_000),
      consumoMeses: Array.from({ length: 12 }, (_, m) => num(meses[m], 0, 10_000_000)),
      tarifaManual: num(o.tarifaManual, 0.05, 10),
      fioBManual: num(o.fioBManual, 0, 5),
      percentual: num(o.percentual, 0, 1),
    });
  });
  // Exatamente uma geradora: a marcada, ou a primeira.
  const marcada = ucsBrutas.findIndex((x) => (x as { geradora?: unknown })?.geradora === true);
  if (ucs.length) ucs[Math.max(0, marcada)].geradora = true;
  const irr = Array.isArray(b.irradiacaoManual) ? b.irradiacaoManual.map((v) => num(v, 0.5, 12)) : null;
  const outros = Array.isArray(b.outrosItens) ? b.outrosItens.slice(0, 30) : [];
  const extras = Array.isArray(b.custosExtras) ? b.custosExtras.slice(0, 30) : [];
  const ajustes: EstadoDaProposta["ajustesDeCusto"] = {};
  if (b.ajustesDeCusto && typeof b.ajustesDeCusto === "object") {
    for (const [k, v] of Object.entries(b.ajustesDeCusto as Record<string, unknown>).slice(0, 60)) {
      const o = (v ?? {}) as Record<string, unknown>;
      const ajuste: { ativo?: boolean; valor?: number } = {};
      if (typeof o.ativo === "boolean") ajuste.ativo = o.ativo;
      const valor = num(o.valor, 0, 100_000_000);
      if (valor !== null) ajuste.valor = valor;
      ajustes[k.slice(0, 40)] = ajuste;
    }
  }
  return {
    versao: 2,
    passo: num(b.passo, 0, PASSOS.length - 1) ?? 0,
    responsavelId: typeof b.responsavelId === "string" && /^[0-9a-f-]{36}$/i.test(b.responsavelId) ? b.responsavelId : null,
    cidade: txt(b.cidade, 80),
    uf: txt(b.uf, 2).toUpperCase(),
    ucs: ucs.length ? ucs : [novaUc(1)],
    rateio: b.rateio === "prioridade" ? "prioridade" : "percentual",
    irradiacaoManual: irr && irr.length === 12 && irr.every((v) => v !== null) ? (irr as number[]) : null,
    perfilDesempenho: txt(b.perfilDesempenho, 60) || null,
    desempenho: num(b.desempenho, 0.5, 0.95) ?? 0.75,
    perfilSimultaneidade: txt(b.perfilSimultaneidade, 60) || null,
    simultaneidade: num(b.simultaneidade, 0, 1) ?? 0.3,
    telhado: txt(b.telhado, 40) || null,
    kitAutomatico: b.kitAutomatico !== false,
    tipoInversor: b.tipoInversor === "microinversor" ? "microinversor" : "inversor",
    modulo: lerLinha(b.modulo, ["modulo"]),
    inversores: (Array.isArray(b.inversores) ? b.inversores.slice(0, 10) : [])
      .map((x) => lerLinha(x, ["inversor", "microinversor"]))
      .filter((x): x is LinhaDoKit => x !== null),
    outrosItens: outros
      .map((x) => {
        const o = (x ?? {}) as Record<string, unknown>;
        return { nome: txt(o.nome, 80), qtd: num(o.qtd, 0, 100_000) ?? 1, precoUnitario: num(o.precoUnitario, 0, 10_000_000) };
      })
      .filter((x) => x.nome),
    custoKitManual: num(b.custoKitManual, 0, 100_000_000),
    ajustesDeCusto: ajustes,
    custosExtras: extras
      .map((x) => {
        const o = (x ?? {}) as Record<string, unknown>;
        return { nome: txt(o.nome, 80), valor: num(o.valor, 0, 100_000_000) ?? 0 };
      })
      .filter((x) => x.nome),
    precoFinal: num(b.precoFinal, 1, 100_000_000),
    validadeDias: num(b.validadeDias, 1, 90),
    observacoes: typeof b.observacoes === "string" ? b.observacoes.trim().slice(0, 600) : "",
  };
}

// ------------------------------------------------------------------- a conta

/** A tarifa e o Fio B da unidade, com impostos: o digitado, senão o da ANEEL, senão o das premissas. */
export function tarifaDaUc(
  uc: UcDoAssistente,
  ctx: Pick<ContextoDoCalculo, "tarifas" | "premissas">,
): { tarifa: number; fioB: number; origem: "manual" | "aneel" | "premissas"; aneel: TarifaSemImpostos | null } {
  const aneel = uc.distribuidoraCnpj ? (ctx.tarifas[chaveDaTarifa(uc.distribuidoraCnpj, uc.subgrupo)] ?? null) : null;
  const t = ctx.premissas.tributos;
  const tarifaAneel = aneel ? comImpostos(aneel.te + aneel.tusd, t) : null;
  const fioBAneel = aneel?.fioB ? comImpostos(aneel.fioB, t) : null;
  const tarifa = uc.tarifaManual ?? tarifaAneel ?? ctx.premissas.tarifaKwh;
  const fioB = uc.fioBManual ?? fioBAneel ?? ctx.premissas.fioBKwh;
  const origem = uc.tarifaManual !== null ? "manual" : tarifaAneel !== null ? "aneel" : "premissas";
  return { tarifa, fioB, origem, aneel };
}

/** O sol de cada mês usado na conta: o mudado à mão, o da cidade, ou o das premissas repetido. */
export function irradiacaoUsada(e: Pick<EstadoDaProposta, "irradiacaoManual">, ctx: Pick<ContextoDoCalculo, "irradiacaoCidade" | "premissas">): number[] {
  return e.irradiacaoManual ?? ctx.irradiacaoCidade ?? Array.from({ length: 12 }, () => ctx.premissas.irradiacaoDia);
}

export function consumoDaUc(uc: UcDoAssistente): number[] | null {
  return uc.consumoModo === "mensal" ? consumoDosMeses(uc.consumoMedia, uc.consumoMeses) : consumoDosMeses(uc.consumoMedia, null);
}

export function kwpDoKit(e: Pick<EstadoDaProposta, "modulo">): number {
  return e.modulo ? (e.modulo.potenciaW * e.modulo.qtd) / 1000 : 0;
}

/** Custo do kit: o total digitado, senão a soma dos preços unitários. Nulo sem nenhum preço. */
export function custoDoKit(e: Pick<EstadoDaProposta, "custoKitManual" | "modulo" | "inversores" | "outrosItens">): number | null {
  if (e.custoKitManual !== null) return e.custoKitManual;
  const linhas = [
    ...(e.modulo ? [e.modulo] : []),
    ...e.inversores,
    ...e.outrosItens.map((o) => ({ qtd: o.qtd, precoUnitario: o.precoUnitario })),
  ];
  const comPreco = linhas.filter((l) => l.precoUnitario !== null && l.precoUnitario !== undefined);
  if (!comPreco.length) return null;
  return comPreco.reduce((s, l) => s + (l.precoUnitario ?? 0) * l.qtd, 0);
}

export interface ResultadoDoAssistente {
  irradiacao: number[];
  irradiacaoAnual: number;
  /** Consumo de cada unidade, mês a mês (nulo onde falta consumo). */
  consumos: (number[] | null)[];
  tarifas: ReturnType<typeof tarifaDaUc>[];
  kwpNecessario: number | null;
  kwp: number;
  avisosDoKit: AvisoDoKit[];
  relacaoCcCa: number | null;
  areaM2: number;
  custoKit: number | null;
  preco: ResultadoDoPreco | null;
  precoFinal: number | null;
  margemFinal: number | null;
  simulacao: ResultadoDaSimulacao | null;
  formas: FormasDePagamento | null;
  /** O que falta para gerar a proposta, em palavras. Vazio = pode gerar. */
  falta: string[];
}

const DIAS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

export function calcularAssistente(e: EstadoDaProposta, ctx: ContextoDoCalculo): ResultadoDoAssistente {
  const p = ctx.premissas;
  const irradiacao = irradiacaoUsada(e, ctx);
  const irradiacaoAnual = irradiacao.reduce((s, v, i) => s + v * DIAS[i], 0) / 365;
  const consumos = e.ucs.map(consumoDaUc);
  const tarifas = e.ucs.map((u) => tarifaDaUc(u, ctx));
  const comConsumo = e.ucs.map((u, i) => ({ u, c: consumos[i] })).filter((x): x is { u: UcDoAssistente; c: number[] } => x.c !== null);
  const kwpNecessario = comConsumo.length
    ? potenciaNecessariaKwp(comConsumo.map((x) => ({ ligacao: x.u.ligacao, consumoMes: x.c })), irradiacao, e.desempenho)
    : null;

  const kwp = kwpDoKit(e);
  const geradora = e.ucs.find((u) => u.geradora) ?? e.ucs[0];
  const modulos = { qtd: e.modulo?.qtd ?? 0, potenciaW: e.modulo?.potenciaW ?? 0 };
  const inversores = e.inversores.map((i) => ({
    nome: `${i.fabricante} ${i.modelo}`.trim(),
    tipo: i.tipo === "microinversor" ? ("microinversor" as const) : ("inversor" as const),
    potenciaW: i.potenciaW,
    qtd: i.qtd,
    modulosPorUnidade: i.modulosPorUnidade ?? null,
    fases: i.fases ?? null,
  }));
  const avisosDoKit = avaliarKit({ modulos, inversores, sobre: p.sobredimensionamento, ligacao: geradora.ligacao });
  const areaM2 = e.modulo ? areaDosModulos(e.modulo.qtd, e.modulo.potenciaW, e.modulo.areaM2) : 0;

  const custoKit = custoDoKit(e);
  const preco =
    custoKit !== null && kwp > 0
      ? calcularPreco(
          {
            custoKit,
            kwp,
            modulos: modulos.qtd,
            inversores: e.inversores.reduce((s, i) => s + i.qtd, 0),
            telhado: e.telhado,
            distanciaKm: ctx.distanciaKm,
            ajustes: e.ajustesDeCusto,
            extras: e.custosExtras,
          },
          p,
        )
      : null;
  const precoFinal = e.precoFinal ?? preco?.precoSugerido ?? null;
  const margemFinal = preco && precoFinal ? margemDoPreco(precoFinal, preco.custoTotal, p.precificacao.imposto) : null;

  const geradoraTemConsumo = consumos[e.ucs.indexOf(geradora)] !== null;
  const ucsDaSimulacao: UcDaSimulacao[] = e.ucs
    .map((u, i) => ({ u, i }))
    .filter(({ i }) => consumos[i] !== null)
    .map(({ u, i }) => ({
      id: u.id,
      nome: u.nome,
      geradora: u.geradora,
      ligacao: u.ligacao,
      consumoMes: consumos[i]!,
      tarifa: tarifas[i].tarifa,
      fioB: tarifas[i].fioB,
      percentual: u.percentual,
    }));
  const simulacao =
    kwp > 0 && geradoraTemConsumo && precoFinal
      ? simular({
          kwp,
          irradiacaoMensal: irradiacao,
          desempenho: e.desempenho,
          simultaneidade: e.simultaneidade,
          ucs: ucsDaSimulacao,
          rateio: e.rateio,
          investimento: precoFinal,
          reajusteAnual: p.reajusteAnual,
          degradacaoAnual: p.degradacaoAnual,
          tma: p.tma,
          anoBase: ctx.anoBase,
        })
      : null;
  const formas = precoFinal ? formasDePagamento(precoFinal, p) : null;

  const falta: string[] = [];
  if (!e.cidade) falta.push("a cidade da instalação");
  if (!geradoraTemConsumo) falta.push("o consumo da unidade geradora");
  e.ucs.forEach((u, i) => {
    if (!u.geradora && consumos[i] === null) falta.push(`o consumo de "${u.nome}"`);
  });
  if (e.rateio === "percentual" && e.ucs.length > 1) {
    const soma = e.ucs.filter((u) => !u.geradora).reduce((s, u) => s + (u.percentual ?? 0), 0);
    if (soma > 1 + 1e-9) falta.push("o rateio: as porcentagens das beneficiárias passam de 100%");
  }
  if (!e.modulo || !(e.modulo.qtd > 0)) falta.push("o módulo e a quantidade");
  if (!e.inversores.some((i) => i.qtd > 0)) falta.push("o inversor (ou os microinversores)");
  if (avisosDoKit.some((a) => a.nivel === "erro") && e.modulo && e.inversores.length) falta.push("acertar o kit (veja os avisos da etapa Kit)");
  if (!precoFinal) falta.push("o preço (o custo do kit, na etapa Custos)");

  return {
    irradiacao,
    irradiacaoAnual,
    consumos,
    tarifas,
    kwpNecessario,
    kwp,
    avisosDoKit,
    relacaoCcCa: relacaoCcCa(modulos, inversores),
    areaM2,
    custoKit,
    preco,
    precoFinal,
    margemFinal,
    simulacao,
    formas,
    falta,
  };
}

/** O consumo médio das unidades somadas (o que vai para o projeto). */
export function consumoMedioTotal(r: Pick<ResultadoDoAssistente, "consumos">): number | null {
  const validos = r.consumos.filter((c): c is number[] => c !== null);
  if (!validos.length) return null;
  return validos.reduce((s, c) => s + c.reduce((a, b) => a + b, 0), 0) / 12;
}

/** O percentual do Fio B do primeiro ano, para o rodapé. */
export function fioBDoAno(ano: number): number {
  return percentualFioB(ano);
}

export { DISPONIBILIDADE_KWH };

/**
 * O kit automático: o módulo escolhido (ou o padrão da empresa) na quantidade
 * que zera as contas, e o inversor que combina (relação CC/CA, fases da
 * ligação da geradora, preferência pelo catálogo e pelo que mais se instala).
 * Nulo quando ainda não dá (sem consumo ou sem módulo).
 */
export function kitAutomatico(
  e: Pick<EstadoDaProposta, "modulo" | "tipoInversor" | "ucs">,
  kwpNecessario: number | null,
  candidatos: (InversorCandidato & { linha: LinhaDoKit })[],
  moduloPadrao: LinhaDoKit | null,
  sobre: { alvo: number; maximo: number },
): { modulo: LinhaDoKit; inversores: LinhaDoKit[] } | null {
  const modulo = e.modulo ?? moduloPadrao;
  if (!kwpNecessario || !modulo || !(modulo.potenciaW > 0)) return null;
  const qtd = modulosParaPotencia(kwpNecessario, modulo.potenciaW);
  const geradora = e.ucs.find((u) => u.geradora) ?? e.ucs[0];
  const sug = sugerirInversores({ qtd, potenciaW: modulo.potenciaW }, candidatos.filter((c) => c.tipo === e.tipoInversor), sobre, geradora?.ligacao ?? "bifasico", e.tipoInversor);
  const c = sug ? candidatos.find((x) => x.id === sug[0].inversor.id) : null;
  return { modulo: { ...modulo, qtd }, inversores: c && sug ? [{ ...c.linha, qtd: sug[0].qtd }] : [] };
}
