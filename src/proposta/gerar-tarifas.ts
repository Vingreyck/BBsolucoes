/**
 * Gera `src/proposta/tarifas-aneel.json`: a tarifa residencial, rural e
 * comercial (B1, B2, B3, convencional) de todas as distribuidoras, com o Fio B,
 * como a ANEEL homologou. É a reserva para quando a API da ANEEL não responde
 * (a VM às vezes não alcança o servidor deles).
 *
 *   npm run dados:tarifas -- <tarifas-homologadas.csv> <componentes-tarifarias-ANO.csv> [outro ano.csv]
 *
 * Os arquivos são os do portal dadosabertos.aneel.gov.br: "Tarifas de aplicação
 * das distribuidoras de energia elétrica" e "Componentes Tarifárias" (um por ano;
 * passe o do ano atual e o do anterior, porque há resolução que começou no ano
 * passado e ainda vale).
 */

import { writeFileSync } from "node:fs";
import path from "node:path";

import { lerCsv } from "@/dados/ler-csv";

import { CLASSE_NA_ANEEL, ehSubgrupo, valorDaAneel, type Subgrupo } from "./tarifas";
import type { TabelaDeTarifas } from "./tarifas-aneel";

const [, , arquivoTarifas, ...arquivosComponentes] = process.argv;
if (!arquivoTarifas || !arquivosComponentes.length) {
  console.error("Uso: npm run dados:tarifas -- <tarifas-homologadas.csv> <componentes-tarifarias-ANO.csv> [outro ano]");
  process.exit(1);
}

const hoje = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });

function daClasse(sub: Subgrupo, classe: string, subclasse: string): boolean {
  const c = CLASSE_NA_ANEEL[sub];
  return classe === c.classe && subclasse === c.subclasse;
}

interface Linha {
  cnpj: string;
  subgrupo: Subgrupo;
  te: number;
  tusd: number;
  inicio: string;
  fim: string | null;
  resolucao: string | null;
}

async function principal() {
  const porChave = new Map<string, Linha[]>();
  await lerCsv(arquivoTarifas, { sep: ";" }, (r) => {
    const sub = r.DscSubGrupo;
    if (!ehSubgrupo(sub)) return;
    if (r.DscBaseTarifaria !== "Tarifa de Aplicação" || r.DscModalidadeTarifaria !== "Convencional" || r.DscDetalhe !== "Não se aplica") return;
    if (!daClasse(sub, r.DscClasse, r.DscSubClasse)) return;
    const cnpj = (r.NumCNPJDistribuidora ?? "").replace(/\D/g, "");
    const te = valorDaAneel(r.VlrTE);
    const tusd = valorDaAneel(r.VlrTUSD);
    if (cnpj.length !== 14 || te === null || tusd === null || !r.DatInicioVigencia) return;
    const chave = `${cnpj}|${sub}`;
    const lista = porChave.get(chave) ?? [];
    lista.push({ cnpj, subgrupo: sub, te, tusd, inicio: r.DatInicioVigencia, fim: r.DatFimVigencia || null, resolucao: r.DscREH || null });
    porChave.set(chave, lista);
  });

  // De cada distribuidora e subgrupo: a resolução em vigor hoje e as que começam depois.
  const escolhidas: Linha[] = [];
  for (const lista of porChave.values()) {
    const ordenada = lista.sort((a, b) => (a.inicio < b.inicio ? 1 : -1));
    const vigente = ordenada.find((l) => l.inicio <= hoje && (!l.fim || l.fim >= hoje)) ?? ordenada.find((l) => l.inicio <= hoje);
    for (const l of ordenada) if (l.inicio > hoje) escolhidas.push(l);
    if (vigente) escolhidas.push(vigente);
  }
  const procurar = new Set(escolhidas.map((l) => `${l.cnpj}|${l.subgrupo}|${l.inicio}`));
  console.error(`tarifas: ${escolhidas.length} resoluções de ${porChave.size} distribuidora/subgrupo`);

  const fioB = new Map<string, number>();
  for (const arquivo of arquivosComponentes) {
    await lerCsv(arquivo, { sep: ";" }, (r) => {
      if (r.DscComponenteTarifario !== "TUSD_FioB") return;
      const sub = r.DscSubGrupoTarifario;
      if (!ehSubgrupo(sub)) return;
      if (r.DscBaseTarifaria !== "Tarifa de Aplicação" || r.DscModalidadeTarifaria !== "Convencional" || r.DscDetalheConsumidor !== "Não se aplica") return;
      if (!daClasse(sub, r.DscClasseConsumidor, r.DscSubClasseConsumidor)) return;
      const chave = `${(r.NumCPFCNPJ ?? "").replace(/\D/g, "")}|${sub}|${r.DatInicioVigencia}`;
      if (!procurar.has(chave)) return;
      const v = valorDaAneel(r.VlrComponenteTarifario);
      if (v !== null && v > 0) fioB.set(chave, v);
    });
    console.error(`componentes de ${path.basename(arquivo)} lidos`);
  }

  const saida: TabelaDeTarifas = {
    fonte:
      "ANEEL, dados abertos: Tarifas de aplicação das distribuidoras de energia elétrica e Componentes Tarifárias " +
      "(componente TUSD_FioB). Tarifa de aplicação, modalidade convencional, sem impostos, em R$/kWh.",
    geradoEm: hoje,
    tarifas: escolhidas
      .map((l) => ({
        cnpj: l.cnpj,
        subgrupo: l.subgrupo,
        te: l.te,
        tusd: l.tusd,
        fioB: fioB.get(`${l.cnpj}|${l.subgrupo}|${l.inicio}`) ?? null,
        inicio: l.inicio,
        fim: l.fim,
        resolucao: l.resolucao,
      }))
      .sort((a, b) => (a.cnpj + a.subgrupo + a.inicio < b.cnpj + b.subgrupo + b.inicio ? -1 : 1)),
  };
  const destino = path.join(process.cwd(), "src", "proposta", "tarifas-aneel.json");
  writeFileSync(destino, JSON.stringify(saida));
  const comFio = saida.tarifas.filter((t) => t.fioB !== null).length;
  console.error(`gravado ${destino}: ${saida.tarifas.length} tarifas, ${comFio} com Fio B`);
}

principal().catch((e) => {
  console.error(e);
  process.exit(1);
});
