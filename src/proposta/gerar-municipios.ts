/**
 * Gera `src/proposta/municipios.json`: para cada município do Brasil, o sol de
 * cada mês e a distribuidora que atende.
 *
 *   npm run dados:municipios -- <Atlas INPE GLOBAL_HORIZONTAL_sedes-munic (.zip/.csv)> <relação de MMGD da ANEEL (.zip/.csv)>
 *
 * De onde vem:
 * - **INPE/LABREN, Atlas Brasileiro de Energia Solar, 2ª edição (2017)**:
 *   irradiação global horizontal média de cada mês na sede de cada município,
 *   em Wh/m² por dia (labren.ccst.inpe.br/atlas_2017.html, arquivo
 *   "GLOBAL_HORIZONTAL_sedes-munic"). É a mesma base do SunData do CRESESB.
 * - **ANEEL**, "Relação de empreendimentos de Mini e Micro Geração
 *   Distribuída" (dadosabertos.aneel.gov.br, ODbL): a distribuidora de cada
 *   usina ligada, por município. A que atende a maioria das usinas do
 *   município é a sugerida. Do arquivo só se leem o município, a UF e a
 *   distribuidora; nome e documento dos titulares ficam de fora.
 */

import { writeFileSync } from "node:fs";
import path from "node:path";

import { chaveDeNome, lerCsv } from "@/dados/ler-csv";

import type { DadosDosMunicipios, DistribuidoraDaBase } from "./municipios";

const [, , arquivoAtlas, arquivoAneel] = process.argv;
if (!arquivoAtlas || !arquivoAneel) {
  console.error("Uso: npm run dados:municipios -- <atlas GLOBAL_HORIZONTAL_sedes-munic .zip/.csv> <relação MMGD ANEEL .zip/.csv>");
  process.exit(1);
}

const UF_POR_ESTADO: Record<string, string> = {
  ACRE: "AC", ALAGOAS: "AL", AMAPA: "AP", AMAZONAS: "AM", BAHIA: "BA", CEARA: "CE", "DISTRITO FEDERAL": "DF",
  "ESPIRITO SANTO": "ES", GOIAS: "GO", MARANHAO: "MA", "MATO GROSSO": "MT", "MATO GROSSO DO SUL": "MS",
  "MINAS GERAIS": "MG", PARA: "PA", PARAIBA: "PB", PARANA: "PR", PERNAMBUCO: "PE", PIAUI: "PI",
  "RIO DE JANEIRO": "RJ", "RIO GRANDE DO NORTE": "RN", "RIO GRANDE DO SUL": "RS", RONDONIA: "RO", RORAIMA: "RR",
  "SANTA CATARINA": "SC", "SAO PAULO": "SP", SERGIPE: "SE", TOCANTINS: "TO",
};

function semAcento(t: string): string {
  return t.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().trim();
}

/** Como a distribuidora aparece na tela: "Energisa Sergipe", "Sulgipe". */
const NOMES_CONHECIDOS: Record<string, string> = {
  ESE: "Energisa Sergipe",
  SULGIPE: "Sulgipe",
  COELBA: "Neoenergia Coelba",
  CEAL: "Equatorial Alagoas",
  "EQUATORIAL AL": "Equatorial Alagoas",
  CELPE: "Neoenergia Pernambuco",
};

function nomeDaDistribuidora(sigla: string, nome: string): string {
  if (NOMES_CONHECIDOS[sigla]) return NOMES_CONHECIDOS[sigla];
  const curto = nome.split(" - ")[0].replace(/\s+S\.?\/?A\.?$/i, "").trim();
  return curto
    .toLowerCase()
    .replace(/(^|\s)(\p{L})/gu, (_, a: string, b: string) => a + b.toUpperCase())
    .replace(/\b(De|Da|Do|Dos|Das|E)\b/g, (x) => x.toLowerCase());
}

async function principal() {
  // 1) Distribuidora de cada município, pelas usinas ligadas.
  const distribuidoras = new Map<string, { sigla: string; nome: string; cnpj: string; usinas: number }>();
  const porMunicipio = new Map<string, { ibge: string; contagem: Map<string, number> }>();
  const lidas = await lerCsv(arquivoAneel, { sep: ";" }, (r, n) => {
    const uf = (r.SigUF ?? "").trim();
    const municipio = (r.NomMunicipio ?? "").trim();
    const cnpj = (r.NumCNPJDistribuidora ?? "").replace(/\D/g, "");
    if (!uf || !municipio || cnpj.length !== 14) return;
    const sigla = (r.SigAgente ?? "").trim();
    const d = distribuidoras.get(cnpj) ?? { sigla, nome: (r.NomAgente ?? "").trim(), cnpj, usinas: 0 };
    d.usinas++;
    distribuidoras.set(cnpj, d);
    const chave = `${uf}|${chaveDeNome(municipio)}`;
    const m = porMunicipio.get(chave) ?? { ibge: (r.CodMunicipioIbge ?? "").trim(), contagem: new Map() };
    m.contagem.set(cnpj, (m.contagem.get(cnpj) ?? 0) + 1);
    porMunicipio.set(chave, m);
    if (n % 1_000_000 === 0) console.error(`relação: ${n} usinas`);
  });
  console.error(`relação: ${lidas} usinas, ${porMunicipio.size} municípios, ${distribuidoras.size} distribuidoras`);

  const lista: DistribuidoraDaBase[] = [...distribuidoras.values()]
    .sort((a, b) => b.usinas - a.usinas)
    .map((d) => ({ sigla: d.sigla, nome: nomeDaDistribuidora(d.sigla, d.nome), razao: d.nome, cnpj: d.cnpj }));
  const indice = new Map(lista.map((d, i) => [d.cnpj, i]));

  // 2) O sol de cada município (sede), do Atlas.
  const municipios: DadosDosMunicipios["municipios"] = [];
  await lerCsv(arquivoAtlas, { sep: ";", dentroDoZip: "*.csv" }, (r) => {
    const uf = UF_POR_ESTADO[semAcento(r.STATE ?? "")];
    const nome = (r.NAME ?? "").trim();
    if (!uf || !nome) return;
    const meses = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"].map((m) => Number(r[m]));
    if (meses.some((v) => !(v > 0))) return;
    const m = porMunicipio.get(`${uf}|${chaveDeNome(nome)}`);
    let ds: [number, number][] = [];
    if (m) {
      const total = [...m.contagem.values()].reduce((a, b) => a + b, 0);
      ds = [...m.contagem.entries()]
        .sort((a, b) => b[1] - a[1])
        .filter(([, n], i) => i === 0 || n / total >= 0.1)
        .slice(0, 3)
        .map(([cnpj, n]) => [indice.get(cnpj)!, Math.round((n / total) * 100)]);
    }
    municipios.push({
      nome,
      uf,
      ibge: m?.ibge || null,
      lat: Number(r.LAT),
      lon: Number(r.LON),
      ghi: meses,
      d: ds,
    });
  });

  const saida: DadosDosMunicipios = {
    fonte:
      "Irradiação: INPE/LABREN, Atlas Brasileiro de Energia Solar, 2ª ed. (2017), irradiação global horizontal média mensal " +
      "na sede de cada município (Wh/m².dia). Distribuidora: ANEEL, Relação de empreendimentos de MMGD " +
      "(dadosabertos.aneel.gov.br), sob a Open Database License (ODbL); esta base derivada segue a mesma licença.",
    geradoEm: new Date().toISOString().slice(0, 10),
    distribuidoras: lista,
    municipios,
  };
  const destino = path.join(process.cwd(), "src", "proposta", "municipios.json");
  writeFileSync(destino, JSON.stringify(saida));
  const semDistribuidora = municipios.filter((m) => !m.d.length).length;
  console.error(`gravado ${destino}: ${municipios.length} municípios (${semDistribuidora} sem usina cadastrada), ${lista.length} distribuidoras`);
}

principal().catch((e) => {
  console.error(e);
  process.exit(1);
});
