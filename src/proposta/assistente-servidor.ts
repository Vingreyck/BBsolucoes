/**
 * O assistente da proposta no servidor: o contexto da conta (sol da cidade,
 * tarifas da ANEEL, distância da base) e o estado inicial a partir do que o
 * projeto já tem (consumo, kit, telhado, ligação, unidade consumidora).
 */

import { and, asc, eq, inArray } from "drizzle-orm";

import { db, schema } from "@/db";
import { itemDaBase, procurarNaBase, type ItemDaBase } from "@/equipamentos/base";
import type { TipoDeEquipamento } from "@/equipamentos/regras";

import { chaveDaTarifa, lerEstado, novaUc, type ContextoDoCalculo, type EstadoDaProposta, type LinhaDoKit } from "./assistente";
import { ehLigacao, type Ligacao } from "./calculo";
import type { InversorCandidato } from "./dimensionamento";
import { distanciaKm, distribuidoraPorNome, municipio, type Municipio } from "./municipios";
import type { Premissas } from "./premissas";
import { tarifaDaDistribuidora, tarifaSemBuscar, type TarifaBuscada } from "./tarifas-aneel";
import type { Subgrupo } from "./tarifas";

/** A estrada não é linha reta: a distância de carro fica perto de 1,25 vez a do mapa. */
const FATOR_RODOVIARIO = 1.25;

export function anoEmSergipe(d = new Date()): number {
  return Number(d.toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" }).slice(0, 4));
}

export interface InfoDaTarifa {
  chave: string;
  distribuidora: string;
  subgrupo: Subgrupo;
  tarifa: TarifaBuscada | null;
}

export interface ContextoMontado {
  ctx: ContextoDoCalculo;
  municipio: Municipio | null;
  fonteIrradiacao: string | null;
  tarifas: InfoDaTarifa[];
}

/**
 * O contexto da conta para este estado. `buscar` vai à ANEEL quando o cache
 * venceu (o botão "Buscar na ANEEL" e a geração da proposta); sem ele, usa só
 * o que está guardado, para a tela abrir rápido.
 */
export async function contextoDoAssistente(e: EstadoDaProposta, premissas: Premissas, buscar: "cache" | "buscar" | "forcar"): Promise<ContextoMontado> {
  const mun = municipio(e.cidade, e.uf);
  const base = municipio(premissas.logistica.cidade, premissas.logistica.uf);
  const pares = new Map<string, { cnpj: string; subgrupo: Subgrupo; nome: string }>();
  for (const u of e.ucs) {
    if (u.distribuidoraCnpj) pares.set(chaveDaTarifa(u.distribuidoraCnpj, u.subgrupo), { cnpj: u.distribuidoraCnpj, subgrupo: u.subgrupo, nome: u.distribuidoraNome });
  }
  const tarifas = await Promise.all(
    [...pares.entries()].map(async ([chave, p]) => ({
      chave,
      distribuidora: p.nome,
      subgrupo: p.subgrupo,
      tarifa: buscar === "cache" ? await tarifaGuardada(p.cnpj, p.subgrupo) : await tarifaDaDistribuidora(p.cnpj, p.subgrupo, buscar === "forcar"),
    })),
  );
  return {
    ctx: {
      premissas,
      irradiacaoCidade: mun?.irradiacaoMensal ?? null,
      tarifas: Object.fromEntries(tarifas.map((t) => [t.chave, t.tarifa])),
      distanciaKm: mun && base ? Math.round(distanciaKm(base, mun) * FATOR_RODOVIARIO) : null,
      anoBase: anoEmSergipe(),
    },
    municipio: mun,
    fonteIrradiacao: mun ? `Atlas Brasileiro de Energia Solar (INPE, 2017), ${mun.nome}/${mun.uf}` : null,
    tarifas,
  };
}

/** Sem ir à ANEEL: a guardada no banco ou a da tabela que vai junto com o sistema. */
export async function tarifaGuardada(cnpj: string, subgrupo: Subgrupo): Promise<TarifaBuscada | null> {
  return tarifaSemBuscar(cnpj, subgrupo);
}

// ------------------------------------------------------------------ catálogo

/** Um modelo do catálogo da empresa que entra em kit (módulo, inversor ou micro). */
export type ModeloDoCatalogoCompleto = Omit<typeof schema.modeloEquipamento.$inferSelect, "tipo"> & { tipo: TipoDeEquipamento };

const TIPOS_DO_KIT: TipoDeEquipamento[] = ["modulo", "inversor", "microinversor"];

export async function catalogoDaEmpresa(empresaId: string): Promise<ModeloDoCatalogoCompleto[]> {
  const linhas = await db.query.modeloEquipamento.findMany({
    where: and(
      eq(schema.modeloEquipamento.empresaId, empresaId),
      eq(schema.modeloEquipamento.ativo, true),
      inArray(schema.modeloEquipamento.tipo, TIPOS_DO_KIT),
    ),
    orderBy: [asc(schema.modeloEquipamento.fabricante), asc(schema.modeloEquipamento.modelo)],
  });
  return linhas as ModeloDoCatalogoCompleto[];
}

function especificacao<T>(m: ModeloDoCatalogoCompleto, chave: string): T | null {
  const v = (m.especificacoes as Record<string, unknown> | null)?.[chave];
  return v === undefined || v === null ? null : (v as T);
}

/** Um modelo do catálogo como linha do kit (a quantidade vem de fora). */
export function linhaDoCatalogo(m: ModeloDoCatalogoCompleto, qtd: number): LinhaDoKit {
  const daBase = itemDaBase(m.baseId);
  const area = especificacao<number>(m, "areaM2") ?? daBase?.eletrico?.areaM2 ?? null;
  return {
    modeloId: m.id,
    baseId: m.baseId,
    tipo: m.tipo,
    fabricante: m.fabricante,
    modelo: m.modelo,
    potenciaW: Number(m.potenciaW) || daBase?.potenciaW || 0,
    qtd,
    precoUnitario: m.precoCusto === null ? null : Number(m.precoCusto),
    fases: especificacao<1 | 3>(m, "fases") ?? daBase?.fases ?? null,
    modulosPorUnidade: especificacao<number>(m, "modulosPorUnidade") ?? daBase?.modulosPorUnidade ?? null,
    areaM2: area,
  };
}

/** Um item da base como linha do kit. */
export function linhaDaBase(i: ItemDaBase, qtd: number): LinhaDoKit {
  return {
    modeloId: null,
    baseId: i.id,
    tipo: i.tipo,
    fabricante: i.fabricante,
    modelo: i.modelo,
    potenciaW: i.potenciaW ?? 0,
    qtd,
    precoUnitario: null,
    fases: i.fases ?? null,
    modulosPorUnidade: i.modulosPorUnidade ?? null,
    areaM2: i.eletrico?.areaM2 ?? null,
  };
}

/** O que aparece na busca de equipamento da tela: do catálogo da empresa primeiro, depois da base. */
export interface OpcaoDeEquipamento {
  linha: LinhaDoKit;
  origem: "catalogo" | "base";
  /** Usinas ligadas desde 2023 com o modelo (Brasil, Sergipe). */
  uso: { brasil: number; sergipe: number } | null;
}

export function procurarEquipamentos(catalogo: ModeloDoCatalogoCompleto[], texto: string, tipos: TipoDeEquipamento[], limite = 30): OpcaoDeEquipamento[] {
  const palavras = texto.toLowerCase().split(/\s+/).filter(Boolean);
  const doCatalogo = catalogo
    .filter((m) => tipos.includes(m.tipo))
    .filter((m) => palavras.every((p) => `${m.fabricante} ${m.modelo} ${m.potenciaW ?? ""}`.toLowerCase().replace(/[^a-z0-9 ]/g, "").includes(p.replace(/[^a-z0-9]/g, ""))))
    .map<OpcaoDeEquipamento>((m) => {
      const b = itemDaBase(m.baseId);
      return { linha: linhaDoCatalogo(m, 0), origem: "catalogo", uso: b ? { brasil: b.uso.brasil, sergipe: b.uso.sergipe } : null };
    });
  const jaTem = new Set(catalogo.map((m) => m.baseId).filter(Boolean));
  const daBase = procurarNaBase(texto, tipos, limite)
    .filter((i) => !jaTem.has(i.id))
    .map<OpcaoDeEquipamento>((i) => ({ linha: linhaDaBase(i, 0), origem: "base", uso: { brasil: i.uso.brasil, sergipe: i.uso.sergipe } }));
  return [...doCatalogo.slice(0, 12), ...daBase].slice(0, limite);
}

/**
 * Os inversores que a sugestão de kit considera: os do catálogo (preferidos) e
 * os mais instalados da base, de string e micro.
 */
export function candidatosDeInversor(catalogo: ModeloDoCatalogoCompleto[]): (InversorCandidato & { linha: LinhaDoKit })[] {
  const lista: (InversorCandidato & { linha: LinhaDoKit })[] = [];
  const vistos = new Set<string>();
  for (const m of catalogo) {
    if (m.tipo === "modulo") continue;
    const l = linhaDoCatalogo(m, 1);
    if (!(l.potenciaW > 0)) continue;
    lista.push({ id: m.id, nome: `${m.fabricante} ${m.modelo}`, tipo: m.tipo, potenciaW: l.potenciaW, fases: l.fases, modulosPorUnidade: l.modulosPorUnidade, preferencia: 30, linha: l });
    if (m.baseId) vistos.add(m.baseId);
  }
  const populares = [...procurarNaBase("", ["inversor"], 120), ...procurarNaBase("", ["microinversor"], 40)];
  for (const i of populares) {
    if (vistos.has(i.id) || !i.potenciaW) continue;
    const peso = Math.log10(1 + i.uso.sergipe * 8 + i.uso.brasil);
    lista.push({ id: i.id, nome: `${i.fabricante} ${i.modelo}`, tipo: i.tipo === "microinversor" ? "microinversor" : "inversor", potenciaW: i.potenciaW, fases: i.fases, modulosPorUnidade: i.modulosPorUnidade, preferencia: peso * 2, linha: linhaDaBase(i, 1) });
  }
  return lista;
}

/**
 * O módulo que o kit automático usa quando ninguém escolheu: o do catálogo com
 * preço que mais se instala em Sergipe; sem preço, o do catálogo mais
 * instalado; sem catálogo, o mais instalado em Sergipe com 540 W ou mais.
 */
export function moduloPadrao(catalogo: ModeloDoCatalogoCompleto[]): LinhaDoKit | null {
  const peso = (baseId: string | null) => {
    const b = itemDaBase(baseId);
    return b ? b.uso.sergipe * 8 + b.uso.brasil : 0;
  };
  const modulos = catalogo.filter((m) => m.tipo === "modulo" && Number(m.potenciaW) > 0);
  const comPreco = modulos.filter((m) => m.precoCusto !== null).sort((a, b) => peso(b.baseId) - peso(a.baseId));
  const escolhido = comPreco[0] ?? [...modulos].sort((a, b) => peso(b.baseId) - peso(a.baseId))[0];
  if (escolhido) return linhaDoCatalogo(escolhido, 0);
  const daBase = procurarNaBase("", ["modulo"], 60).find((i) => (i.potenciaW ?? 0) >= 540);
  return daBase ? linhaDaBase(daBase, 0) : null;
}

// ------------------------------------------------------------ estado inicial

/**
 * O estado da proposta a partir do projeto, para quem abre o assistente pela
 * primeira vez: cidade do cliente, a unidade consumidora (com o número, se o
 * cliente tem uma cadastrada), a distribuidora da cidade, o consumo, a ligação,
 * o telhado, o kit do projeto e o valor já combinado.
 */
export function estadoInicialDoProjeto(p: {
  cliente: { cidade: string | null; uf: string | null; tipo: "pf" | "pj" };
  projeto: {
    consumoMedioKwh: string | null;
    ligacao: string | null;
    concessionaria: string | null;
    telhadoTipo: string | null;
    valor: string | null;
    moduloModeloId: string | null;
    moduloQtd: number | null;
    inversorModeloId: string | null;
    inversorQtd: number | null;
  };
  ucsDoCliente: { numeroInstalacao: string; concessionaria: string }[];
  catalogo: ModeloDoCatalogoCompleto[];
  premissas: Premissas;
  ligacaoDaVistoria: Ligacao | null;
  responsavelId: string | null;
}): EstadoDaProposta {
  const e = lerEstado({})!;
  e.cidade = p.cliente.cidade?.trim() ?? "";
  const mun = municipio(e.cidade, p.cliente.uf);
  e.uf = mun?.uf ?? p.cliente.uf?.trim().toUpperCase() ?? "";
  if (mun) e.cidade = mun.nome;
  const daCidade = mun?.distribuidoras[0] ?? null;
  const doProjeto = distribuidoraPorNome(p.projeto.concessionaria);
  const dist = doProjeto ?? daCidade;
  const uc = p.ucsDoCliente[0];
  const media = Number(p.projeto.consumoMedioKwh);
  e.ucs = [
    novaUc(1, {
      codigo: uc?.numeroInstalacao ?? "",
      distribuidoraCnpj: dist?.cnpj ?? null,
      distribuidoraNome: dist?.nome ?? p.projeto.concessionaria ?? "",
      subgrupo: p.cliente.tipo === "pj" ? "B3" : "B1",
      ligacao: ehLigacao(p.projeto.ligacao) ? p.projeto.ligacao : (p.ligacaoDaVistoria ?? "bifasico"),
      consumoMedia: Number.isFinite(media) && media > 0 ? media : null,
    }),
  ];
  const perfilD = p.premissas.perfisDesempenho[0];
  const perfilS = p.premissas.perfisSimultaneidade[0];
  e.perfilDesempenho = perfilD?.nome ?? null;
  e.desempenho = perfilD?.valor ?? p.premissas.desempenho;
  e.perfilSimultaneidade = perfilS?.nome ?? null;
  e.simultaneidade = perfilS?.valor ?? p.premissas.simultaneidade;
  e.telhado = p.projeto.telhadoTipo;
  const mod = p.catalogo.find((m) => m.id === p.projeto.moduloModeloId);
  const inv = p.catalogo.find((m) => m.id === p.projeto.inversorModeloId);
  if (mod && p.projeto.moduloQtd && inv) {
    // O projeto já tem kit fechado: vale ele, e o automático fica desligado.
    e.modulo = linhaDoCatalogo(mod, p.projeto.moduloQtd);
    e.inversores = [linhaDoCatalogo(inv, p.projeto.inversorQtd ?? 1)];
    e.tipoInversor = inv.tipo === "microinversor" ? "microinversor" : "inversor";
    e.kitAutomatico = false;
  } else {
    // Sem kit: o módulo do projeto (ou o padrão da empresa) e o resto automático.
    e.modulo = mod ? linhaDoCatalogo(mod, 0) : moduloPadrao(p.catalogo);
    e.kitAutomatico = true;
  }
  const valor = Number(p.projeto.valor);
  e.precoFinal = Number.isFinite(valor) && valor > 0 ? valor : null;
  e.responsavelId = p.responsavelId;
  return e;
}
