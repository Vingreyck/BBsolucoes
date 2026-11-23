/**
 * A base de equipamentos: os módulos, inversores e microinversores instalados
 * no Brasil, tirados dos cadastros públicos da ANEEL (ver `gerar-base.ts`).
 *
 * É a "lista com todos" de onde a empresa escolhe o que vende, sem cadastrar
 * modelo por modelo: ao usar um item numa proposta ou no catálogo, ele vira um
 * `modelo_equipamento` da empresa (com datasheet, Inmetro e preço de custo).
 *
 * O arquivo é lido uma vez por processo, do disco, e só no servidor.
 */

import { readFileSync } from "node:fs";
import path from "node:path";

import { chaveDeNome } from "@/dados/ler-csv";

import type { TipoDeEquipamento } from "./regras";

/** Tensão e corrente do módulo (STC), quando o modelo está na lista da CEC. */
export interface EletricaDoModulo {
  vocV: number;
  vmpV: number;
  iscA: number;
  impA: number;
  /** Coeficiente de temperatura da Voc, em %/°C (negativo). */
  betaVocPctC: number | null;
  celulas: number | null;
  areaM2: number | null;
  comprimentoMm: number | null;
  larguraMm: number | null;
  bifacial: boolean;
}

export interface ItemDaBase {
  /** "modulo:JAM72S30550MR" — estável entre uma geração e outra da base. */
  id: string;
  tipo: TipoDeEquipamento;
  fabricante: string;
  modelo: string;
  potenciaW: number | null;
  /** Inversor e micro: 1 (monofásico) ou 3 (trifásico), quando o nome do modelo diz. */
  fases?: 1 | 3 | null;
  /** Micro: quantos módulos se ligam em cada unidade, o mais comum nas usinas cadastradas. */
  modulosPorUnidade?: number | null;
  /** Inversor: potência de módulos ÷ potência do inversor mais comum nas usinas (1,2 = 20% a mais). */
  relacaoCcCa?: number | null;
  eletrico?: EletricaDoModulo;
  /** Usinas ligadas desde 2023 com este modelo, no Brasil e em Sergipe, e a última ligação. */
  uso: { brasil: number; sergipe: number; ultimo: string };
}

export interface BaseDeEquipamentos {
  fonte: string;
  geradoEm: string;
  itens: ItemDaBase[];
}

let carregada: BaseDeEquipamentos | null = null;

export function baseDeEquipamentos(): BaseDeEquipamentos {
  if (!carregada) {
    try {
      const bruto = readFileSync(path.join(process.cwd(), "src", "equipamentos", "base-equipamentos.json"), "utf8");
      carregada = JSON.parse(bruto) as BaseDeEquipamentos;
    } catch {
      carregada = { fonte: "", geradoEm: "", itens: [] };
    }
  }
  return carregada;
}

export function itemDaBase(id: string | null | undefined): ItemDaBase | null {
  if (!id) return null;
  return baseDeEquipamentos().itens.find((i) => i.id === id) ?? null;
}

/**
 * Procura na base. Cada palavra digitada precisa aparecer no fabricante ou no
 * modelo (sem pontuação: "min5000", "jinko 585", "hms 2000"). Sem texto,
 * devolve os mais instalados — primeiro os de Sergipe.
 */
export function procurarNaBase(
  texto: string,
  tipos: TipoDeEquipamento[],
  limite = 30,
  itens: ItemDaBase[] = baseDeEquipamentos().itens,
): ItemDaBase[] {
  const palavras = texto
    .split(/\s+/)
    .map((p) => chaveDeNome(p))
    .filter(Boolean);
  const candidatos = itens.filter((i) => tipos.includes(i.tipo));
  const peso = (i: ItemDaBase) => i.uso.sergipe * 8 + i.uso.brasil;
  if (!palavras.length) return [...candidatos].sort((a, b) => peso(b) - peso(a)).slice(0, limite);

  const achados: { i: ItemDaBase; pontos: number }[] = [];
  for (const i of candidatos) {
    const fab = chaveDeNome(i.fabricante);
    const mod = chaveDeNome(i.modelo);
    const tudo = `${fab}${mod}${i.potenciaW ?? ""}`;
    if (!palavras.every((p) => tudo.includes(p))) continue;
    let pontos = Math.log10(1 + peso(i));
    for (const p of palavras) {
      if (mod.startsWith(p)) pontos += 3;
      else if (fab.startsWith(p)) pontos += 2;
      if (String(i.potenciaW) === p) pontos += 2;
    }
    achados.push({ i, pontos });
  }
  return achados
    .sort((a, b) => b.pontos - a.pontos)
    .slice(0, limite)
    .map((a) => a.i);
}
