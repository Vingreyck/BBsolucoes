/**
 * Gera a base de equipamentos (`src/equipamentos/base-equipamentos.json`): os
 * módulos, inversores e microinversores que de fato se instalam no Brasil.
 *
 *   npm run dados:equipamentos -- <base técnica da ANEEL (.zip ou .csv)> [lista de módulos da CEC (.csv)]
 *
 * De onde vem:
 * - **ANEEL**, conjunto "Relação de empreendimentos de Mini e Micro Geração
 *   Distribuída", arquivo `empreendimento-gd-informacoes-tecnicas-fotovoltaica`
 *   (dadosabertos.aneel.gov.br, licença ODbL). Cada usina ligada no país traz o
 *   fabricante e o modelo do módulo e do inversor, a quantidade de módulos e as
 *   potências. Daqui saem os nomes, a potência de cada módulo, a do inversor, e
 *   quantas vezes cada modelo foi instalado (no Brasil e em Sergipe, desde 2023).
 * - **CEC/NREL** (opcional), a lista de módulos da California Energy Commission
 *   como o NREL distribui no SAM (`CEC Modules.csv`): tensão e corrente de cada
 *   módulo, quando o modelo é o mesmo vendido aqui.
 *
 * A base técnica não tem nome nem documento de ninguém, e o que sai daqui é só
 * a contagem por modelo. O arquivo gerado é uma base derivada da ANEEL e fica
 * sob a mesma licença (ODbL), como diz o campo `fonte`.
 */

import { writeFileSync } from "node:fs";
import path from "node:path";

import { chaveDeNome, lerCsv, numeroBr } from "@/dados/ler-csv";

import type { BaseDeEquipamentos, EletricaDoModulo, ItemDaBase } from "./base";
import {
  ehMicroinversor,
  fasesDoNome,
  idDaBase,
  limparModelo,
  modeloInvalido,
  nomeDoFabricante,
  potenciaDoNome,
  type TipoDeEquipamento,
} from "./regras";

const [, , arquivoAneel, arquivoCec] = process.argv;
if (!arquivoAneel) {
  console.error("Uso: npm run dados:equipamentos -- <base técnica da ANEEL .zip/.csv> [CEC Modules.csv]");
  process.exit(1);
}

type Contagem<K = number> = Map<K, number>;
function somar<K>(c: Contagem<K>, k: K, n = 1) {
  c.set(k, (c.get(k) ?? 0) + n);
}
function maisComum<T extends string | number>(c: Map<T, number>): [T, number] | null {
  let melhor: [T, number] | null = null;
  for (const [k, v] of c) if (!melhor || v > melhor[1]) melhor = [k, v];
  return melhor;
}
function total<K>(c: Contagem<K>): number {
  let t = 0;
  for (const v of c.values()) t += v;
  return t;
}

interface Acumulado {
  tipo: TipoDeEquipamento;
  n23: number;
  nSE: number;
  nSE23: number;
  ultimo: string;
  fabricante: Contagem<string>;
  modelo: Contagem<string>;
  /** Módulo: watts de cada módulo. Inversor: potência total de inversores (kW). */
  potencia: Contagem;
  /** Inversor: módulos por kW de inversor (micro: dá quantos módulos por unidade). */
  modulosPorKw: Contagem;
  /** Inversor: potência de módulos ÷ potência de inversores. */
  ccCa: Contagem;
}

const tabela = new Map<string, Acumulado>();
/** Como cada fabricante é escrito, para "RENOVIGI" e "Renovigi" saírem iguais. */
const grafias = new Map<string, Map<string, number>>();

function acumulado(tipo: TipoDeEquipamento, modelo: string): Acumulado {
  const id = idDaBase(tipo, modelo);
  let a = tabela.get(id);
  if (!a) {
    a = {
      tipo,
      n23: 0,
      nSE: 0,
      nSE23: 0,
      ultimo: "",
      fabricante: new Map(),
      modelo: new Map(),
      potencia: new Map(),
      modulosPorKw: new Map(),
      ccCa: new Map(),
    };
    tabela.set(id, a);
  }
  return a;
}

function contar(a: Acumulado, fabricante: string, modelo: string, data: string, recente: boolean, se: boolean) {
  a.n23 += recente ? 1 : 0;
  a.nSE += se ? 1 : 0;
  a.nSE23 += se && recente ? 1 : 0;
  if (data > a.ultimo) a.ultimo = data;
  somar(a.fabricante, fabricante);
  const k = chaveDeNome(fabricante);
  if (!grafias.has(k)) grafias.set(k, new Map());
  somar(grafias.get(k)!, fabricante);
  somar(a.modelo, modelo.replace(/\s+/g, " ").trim());
}

async function principal() {
  const linhas = await lerCsv(arquivoAneel, { sep: ";" }, (r, n) => {
    const cod = r.CodGeracaoDistribuida ?? "";
    const uf = cod.split(".")[1] ?? "";
    const data = (r.DatConexao ?? "").slice(0, 10);
    const recente = data >= "2023-01-01";
    const se = uf === "SE";
    const qtd = numeroBr(r.QtdModulos);
    const pMod = numeroBr(r.MdaPotenciaModulos);
    const pInv = numeroBr(r.MdaPotenciaInversores);

    const fm = nomeDoFabricante((r.NomFabricanteModulo ?? "").trim());
    const mm = limparModelo((r.NomModeloModulo ?? "").trim(), fm);
    if (fm && mm && !modeloInvalido(mm)) {
      const a = acumulado("modulo", mm);
      contar(a, fm, mm, data, recente, se);
      if (qtd && pMod && qtd > 0) {
        const w = Math.round((pMod * 1000) / qtd);
        if (w >= 100 && w <= 1000) somar(a.potencia, w);
      }
    }

    const fab = nomeDoFabricante((r.NomFabricanteInversor ?? "").trim());
    const mi = limparModelo((r.NomModeloInversor ?? "").trim(), fab);
    if (fab && mi && !modeloInvalido(mi)) {
      const tipo: TipoDeEquipamento = ehMicroinversor(fab, mi) ? "microinversor" : "inversor";
      const a = acumulado(tipo, mi);
      contar(a, fab, mi, data, recente, se);
      if (pInv && pInv > 0) {
        somar(a.potencia, Math.round(pInv * 100) / 100);
        if (qtd && qtd > 0) somar(a.modulosPorKw, Math.round((qtd / pInv) * 10) / 10);
        if (pMod && pMod > 0) {
          const r2 = Math.round((pMod / pInv) * 20) / 20;
          if (r2 >= 0.6 && r2 <= 2) somar(a.ccCa, r2);
        }
      }
    }
    if (n % 500_000 === 0) console.error(`linhas lidas: ${n}`);
  });
  console.error(`base técnica: ${linhas} usinas, ${tabela.size} modelos`);

  const cec = arquivoCec ? await lerCec(arquivoCec) : new Map<string, EletricaDoModulo>();
  if (arquivoCec) console.error(`CEC: ${cec.size} módulos com dados elétricos`);

  const itens: ItemDaBase[] = [];
  for (const [id, a] of tabela) {
    if (!(a.n23 >= 25 || (a.nSE >= 3 && a.nSE23 >= 1))) continue;
    if (a.ultimo < "2024-01-01") continue;
    const fabricante = maisComum(grafias.get(chaveDeNome(maisComum(a.fabricante)![0]))!)![0];
    const modelo = maisComum(a.modelo)![0];
    const base: ItemDaBase = {
      id,
      tipo: a.tipo,
      fabricante,
      modelo,
      potenciaW: null,
      uso: { brasil: a.n23, sergipe: a.nSE23, ultimo: a.ultimo },
    };

    if (a.tipo === "modulo") {
      const moda = maisComum(a.potencia);
      if (!moda || moda[1] / total(a.potencia) < 0.4) continue;
      base.potenciaW = moda[0];
      const el = cec.get(chaveDeNome(modelo)) ?? cec.get(chaveDeNome(modelo).replace(/WP?$/, ""));
      if (el) base.eletrico = el;
    } else {
      const micro = a.tipo === "microinversor";
      const doNome = potenciaDoNome(modelo);
      const modas = [...a.potencia.entries()].sort((x, y) => y[1] - x[1]);
      const soma = total(a.potencia);
      let w: number | null = doNome;
      if (!micro) {
        const topo = modas[0];
        if (topo && topo[1] / soma >= 0.5 && (!w || Math.abs(topo[0] * 1000 - w) / topo[0] / 1000 > 0.02)) {
          // O nome não diz, ou diz outra coisa que o cadastro desmente na maioria das usinas.
          w = w && modas.some(([kw, n]) => Math.abs(kw * 1000 - w!) < 1 && n / soma > 0.2) ? w : topo[0] * 1000;
        }
      } else if (!w) {
        // Enphase e outros de um módulo por unidade: a potência total não diz a de cada um.
        if (fabricante === "Enphase") continue;
        const menores = modas.slice(0, 3).map(([kw]) => kw).filter((kw) => kw > 0);
        w = menores.length ? Math.min(...menores) * 1000 : null;
      }
      if (!w || w < 200 || w > 250_000) continue;
      base.potenciaW = Math.round(w);
      base.fases = fasesDoNome(fabricante, modelo, micro);
      if (micro) {
        const porUnidade = new Map<number, number>();
        for (const [porKw, n] of a.modulosPorKw) {
          const u = Math.round(porKw * (w / 1000));
          if (u >= 1 && u <= 8) somar(porUnidade, u, n);
        }
        const m = maisComum(porUnidade);
        base.modulosPorUnidade = m && m[1] / Math.max(1, total(porUnidade)) >= 0.35 ? m[0] : null;
      } else {
        const m = maisComum(a.ccCa);
        base.relacaoCcCa = m ? m[0] : null;
      }
    }
    itens.push(base);
  }

  itens.sort((x, y) => y.uso.brasil - x.uso.brasil || y.uso.sergipe - x.uso.sergipe);
  const saida: BaseDeEquipamentos = {
    fonte:
      "Contém dados da ANEEL (dadosabertos.aneel.gov.br, Relação de empreendimentos de MMGD — informações técnicas fotovoltaicas), " +
      "disponibilizados sob a Open Database License (ODbL). Esta base derivada é distribuída sob a mesma licença. " +
      "Dados elétricos de módulos: lista da California Energy Commission, como distribuída no SAM do NREL (licença BSD-3).",
    geradoEm: new Date().toISOString().slice(0, 10),
    itens,
  };
  const destino = path.join(process.cwd(), "src", "equipamentos", "base-equipamentos.json");
  writeFileSync(destino, JSON.stringify(saida));
  const porTipo = (t: string) => itens.filter((i) => i.tipo === t).length;
  console.error(
    `gravado ${destino}: ${itens.length} modelos (${porTipo("modulo")} módulos, ${porTipo("inversor")} inversores, ${porTipo("microinversor")} microinversores)`,
  );
}

/** Lê a lista da CEC (formato do SAM: três linhas de cabeçalho) e indexa pelo modelo. */
async function lerCec(caminho: string): Promise<Map<string, EletricaDoModulo>> {
  const mapa = new Map<string, EletricaDoModulo>();
  await lerCsv(caminho, { sep: "," }, (r) => {
    const nome = r.Name ?? "";
    const fab = r.Manufacturer ?? "";
    const stc = Number(r.STC);
    if (!nome || !fab || !(stc > 0)) return; // as linhas "Units" e "[0]"
    const modelo = nome.startsWith(fab) ? nome.slice(fab.length).trim() : nome;
    const voc = Number(r.V_oc_ref);
    const beta = Number(r.beta_oc);
    const el: EletricaDoModulo = {
      vocV: voc,
      vmpV: Number(r.V_mp_ref),
      iscA: Number(r.I_sc_ref),
      impA: Number(r.I_mp_ref),
      betaVocPctC: voc > 0 && Number.isFinite(beta) ? Math.round((beta / voc) * 100 * 1000) / 1000 : null,
      celulas: Number(r.N_s) || null,
      areaM2: Number(r.A_c) || null,
      comprimentoMm: Number(r.Length) ? Math.round(Number(r.Length) * 1000) : null,
      larguraMm: Number(r.Width) ? Math.round(Number(r.Width) * 1000) : null,
      bifacial: r.Bifacial === "1",
    };
    if (!(el.vocV > 0 && el.iscA > 0)) return;
    mapa.set(chaveDeNome(modelo), el);
  });
  return mapa;
}

principal().catch((e) => {
  console.error(e);
  process.exit(1);
});
