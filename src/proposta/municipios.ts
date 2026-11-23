/**
 * O sol e a distribuidora de cada município (ver `gerar-municipios.ts`).
 *
 * É o que o Solarz chama de "irradiação por API" e "concessionária sugerida
 * pela cidade": aqui vem de uma tabela pública que fica no próprio sistema,
 * sem depender de ninguém responder na hora.
 *
 * O arquivo é lido uma vez por processo, do disco, e só no servidor.
 */

import { readFileSync } from "node:fs";
import path from "node:path";

import { chaveDeNome } from "@/dados/ler-csv";

export interface DistribuidoraDaBase {
  sigla: string;
  /** Como aparece na tela: "Energisa Sergipe". */
  nome: string;
  /** Razão social, como a ANEEL escreve. */
  razao: string;
  cnpj: string;
}

export interface DadosDosMunicipios {
  fonte: string;
  geradoEm: string;
  distribuidoras: DistribuidoraDaBase[];
  municipios: {
    nome: string;
    uf: string;
    ibge: string | null;
    lat: number;
    lon: number;
    /** Irradiação global horizontal de jan a dez, em Wh/m² por dia. */
    ghi: number[];
    /** Distribuidoras que atendem (índice em `distribuidoras`, % das usinas do município). */
    d: [number, number][];
  }[];
}

export interface Municipio {
  nome: string;
  uf: string;
  ibge: string | null;
  lat: number;
  lon: number;
  /** kWh/m² por dia, de janeiro a dezembro. */
  irradiacaoMensal: number[];
  /** Média do ano, em kWh/m² por dia. */
  irradiacaoAnual: number;
  /** A que atende a maior parte das usinas da cidade, e as outras, se houver. */
  distribuidoras: (DistribuidoraDaBase & { participacao: number })[];
}

let carregado: DadosDosMunicipios | null = null;

export function dadosDosMunicipios(): DadosDosMunicipios {
  if (!carregado) {
    try {
      carregado = JSON.parse(
        readFileSync(path.join(process.cwd(), "src", "proposta", "municipios.json"), "utf8"),
      ) as DadosDosMunicipios;
    } catch {
      carregado = { fonte: "", geradoEm: "", distribuidoras: [], municipios: [] };
    }
  }
  return carregado;
}

const DIAS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function montar(m: DadosDosMunicipios["municipios"][number], dados: DadosDosMunicipios): Municipio {
  const mensal = m.ghi.map((w) => w / 1000);
  const anual = mensal.reduce((s, v, i) => s + v * DIAS[i], 0) / 365;
  return {
    nome: m.nome,
    uf: m.uf,
    ibge: m.ibge,
    lat: m.lat,
    lon: m.lon,
    irradiacaoMensal: mensal,
    irradiacaoAnual: Math.round(anual * 1000) / 1000,
    distribuidoras: m.d.map(([i, p]) => ({ ...dados.distribuidoras[i], participacao: p })),
  };
}

/**
 * O município pela cidade e UF como estão no cadastro ("Itabaiana", "SE"). Sem
 * UF, só acha se o nome for único no país. Nulo quando não acha.
 */
export function municipio(cidade: string | null | undefined, uf?: string | null): Municipio | null {
  if (!cidade?.trim()) return null;
  const dados = dadosDosMunicipios();
  const k = chaveDeNome(cidade);
  const u = uf?.trim().toUpperCase() || null;
  const achados = dados.municipios.filter((m) => chaveDeNome(m.nome) === k && (!u || m.uf === u));
  if (achados.length === 1) return montar(achados[0], dados);
  // Sem UF e com nome repetido (há Itabaiana na Paraíba também): prefere Sergipe.
  const deSergipe = achados.find((m) => m.uf === "SE");
  return deSergipe ? montar(deSergipe, dados) : null;
}

/** As cidades que começam com o texto, para o campo de busca ("Itab" → Itabaiana/SE, Itabaianinha/SE…). */
export function procurarMunicipios(texto: string, limite = 12): { nome: string; uf: string }[] {
  const k = chaveDeNome(texto);
  if (k.length < 2) return [];
  const dados = dadosDosMunicipios();
  return dados.municipios
    .filter((m) => chaveDeNome(m.nome).startsWith(k))
    .sort((a, b) => (a.uf === "SE" ? 0 : 1) - (b.uf === "SE" ? 0 : 1) || a.nome.localeCompare(b.nome))
    .slice(0, limite)
    .map((m) => ({ nome: m.nome, uf: m.uf }));
}

/** Todas as distribuidoras, das que têm mais usinas para as que têm menos. */
export function distribuidoras(): DistribuidoraDaBase[] {
  return dadosDosMunicipios().distribuidoras;
}

export function distribuidoraPorCnpj(cnpj: string | null | undefined): DistribuidoraDaBase | null {
  const c = (cnpj ?? "").replace(/\D/g, "");
  return dadosDosMunicipios().distribuidoras.find((d) => d.cnpj === c) ?? null;
}

/**
 * A distribuidora pelo nome que está gravado no projeto ("Energisa Sergipe",
 * "Sulgipe", "ESE"). Compara pelo nome de tela, pela sigla e pela razão social.
 */
export function distribuidoraPorNome(nome: string | null | undefined): DistribuidoraDaBase | null {
  const k = chaveDeNome(nome);
  if (!k) return null;
  const lista = dadosDosMunicipios().distribuidoras;
  return (
    lista.find((d) => chaveDeNome(d.nome) === k || chaveDeNome(d.sigla) === k) ??
    lista.find((d) => chaveDeNome(d.razao).includes(k) || k.includes(chaveDeNome(d.nome))) ??
    null
  );
}

/** Distância em linha reta, em km (fórmula de haversine). */
export function distanciaKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const r = 6371;
  const rad = (g: number) => (g * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(h));
}
