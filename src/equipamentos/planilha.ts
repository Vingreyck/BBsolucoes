/**
 * A planilha de preços do distribuidor (o "Meus Produtos" do Solarz): cada
 * linha com fabricante, modelo e preço, às vezes tipo e potência. Lê o que
 * vier, acha as colunas pelo cabeçalho e diz o que casa com o catálogo da
 * empresa ou com a base de equipamentos. Sem banco — conferido pelo
 * `testar-regras.ts`.
 */

import { chaveDeNome } from "@/dados/ler-csv";

import { ehMicroinversor, limparModelo, nomeDoFabricante, type TipoDeEquipamento } from "./regras";

export interface LinhaDePreco {
  fabricante: string;
  modelo: string;
  tipo: TipoDeEquipamento | null;
  potenciaW: number | null;
  preco: number;
}

const COLUNAS: Record<keyof LinhaDePreco, RegExp> = {
  fabricante: /^(fabricante|marca|fornecedor|fab)$/,
  modelo: /^(modelo|produto|descri[cç][aã]o|item|equipamento|nome)$/,
  tipo: /^(tipo|categoria|grupo|familia|família)$/,
  potenciaW: /^(pot[eê]ncia|potencia ?\(w\)|pot[eê]ncia ?\(w\)|watts?|w|potencia ?w)$/,
  preco: /^(pre[cç]o|valor|custo|pre[cç]o ?unit[aá]rio|valor ?unit[aá]rio|pre[cç]o ?\(r\$\)|r\$)$/,
};

function normal(t: string): string {
  return t.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();
}

/** "R$ 1.234,56" → 1234.56; "1234.56" → 1234.56. */
export function lerPreco(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) && v > 0 ? v : null;
  if (typeof v !== "string") return null;
  let t = v.replace(/R\$|\s/g, "");
  if (!t) return null;
  if (t.includes(",")) t = t.replace(/\./g, "").replace(",", ".");
  const n = Number(t);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function lerTipo(v: string, fabricante: string, modelo: string): TipoDeEquipamento | null {
  const t = normal(v);
  if (/micro/.test(t)) return "microinversor";
  if (/inversor/.test(t)) return "inversor";
  if (/modulo|painel|placa/.test(t)) return "modulo";
  return ehMicroinversor(fabricante, modelo) ? "microinversor" : null;
}

/**
 * As linhas da planilha (já como texto, célula a célula) viram preços. O
 * cabeçalho é a primeira linha que tem modelo e preço; sem fabricante, ele sai
 * do começo do modelo quando dá ("JINKO JKM585N…").
 */
export function lerPlanilhaDePrecos(linhas: string[][]): { itens: LinhaDePreco[]; ignoradas: number; semCabecalho: boolean } {
  let inicio = -1;
  let col: Partial<Record<keyof LinhaDePreco, number>> = {};
  for (let i = 0; i < Math.min(linhas.length, 20); i++) {
    const achou: Partial<Record<keyof LinhaDePreco, number>> = {};
    linhas[i].forEach((c, j) => {
      const n = normal(c ?? "");
      for (const [k, re] of Object.entries(COLUNAS) as [keyof LinhaDePreco, RegExp][]) if (achou[k] === undefined && re.test(n)) achou[k] = j;
    });
    if (achou.modelo !== undefined && achou.preco !== undefined) {
      inicio = i;
      col = achou;
      break;
    }
  }
  if (inicio < 0) return { itens: [], ignoradas: linhas.length, semCabecalho: true };

  const itens: LinhaDePreco[] = [];
  let ignoradas = 0;
  for (const l of linhas.slice(inicio + 1)) {
    const modeloBruto = String(l[col.modelo!] ?? "").trim();
    const preco = lerPreco(l[col.preco!]);
    if (!modeloBruto || preco === null) {
      if (l.some((c) => String(c ?? "").trim())) ignoradas++;
      continue;
    }
    let fabricante = col.fabricante !== undefined ? String(l[col.fabricante] ?? "").trim() : "";
    if (!fabricante) {
      const primeira = modeloBruto.split(/\s+/)[0];
      const nome = nomeDoFabricante(primeira);
      if (nome !== primeira) fabricante = nome;
    }
    fabricante = fabricante ? nomeDoFabricante(fabricante) : "";
    const modelo = limparModelo(modeloBruto, fabricante);
    const potencia = col.potenciaW !== undefined ? lerPreco(l[col.potenciaW]) : null;
    itens.push({
      fabricante,
      modelo,
      tipo: lerTipo(col.tipo !== undefined ? String(l[col.tipo] ?? "") : "", fabricante, modelo),
      potenciaW: potencia,
      preco,
    });
  }
  return { itens, ignoradas, semCabecalho: false };
}

/** Uma linha de CSV com `;` ou `,` (o que aparecer mais no cabeçalho). */
export function linhasDoCsv(texto: string): string[][] {
  const linhas = texto.replace(/^﻿/, "").split(/\r?\n/);
  const primeira = linhas.find((l) => l.trim()) ?? "";
  const sep = (primeira.match(/;/g) ?? []).length >= (primeira.match(/,/g) ?? []).length ? ";" : ",";
  return linhas.map((l) => {
    const campos: string[] = [];
    let atual = "";
    let aspas = false;
    for (let i = 0; i < l.length; i++) {
      const c = l[i];
      if (aspas) {
        if (c === '"' && l[i + 1] === '"') {
          atual += '"';
          i++;
        } else if (c === '"') aspas = false;
        else atual += c;
      } else if (c === '"') aspas = true;
      else if (c === sep) {
        campos.push(atual);
        atual = "";
      } else atual += c;
    }
    campos.push(atual);
    return campos;
  });
}

/** A chave que compara modelos digitados de jeitos diferentes. */
export function chaveDoModelo(modelo: string): string {
  return chaveDeNome(modelo);
}
