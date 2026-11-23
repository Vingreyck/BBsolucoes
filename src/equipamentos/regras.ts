/**
 * Como ler um equipamento pelo nome, do jeito que ele aparece digitado nos
 * cadastros da ANEEL e nas planilhas dos distribuidores: o fabricante sem as
 * variações ("JINKO", "Jinko Solar Co. Ltd"), a potência escrita no modelo
 * ("MIN 5000TL-X", "SUN-10K-G03", "SIW200G M050"), se é microinversor e
 * quantas fases tem.
 *
 * Sem banco — conferido pelo `testar-regras.ts`.
 */

import { chaveDeNome } from "@/dados/ler-csv";

export type TipoDeEquipamento = "modulo" | "inversor" | "microinversor";

/**
 * Os fabricantes como a gente escreve. A chave é o começo do nome sem
 * espaço nem pontuação ("JINKOSOLARCOLTD" começa com "JINKO").
 */
const FABRICANTES: [string, string][] = [
  ["JINKO", "Jinko Solar"],
  ["JASOLAR", "JA Solar"],
  ["JA", "JA Solar"],
  ["TRINA", "Trina Solar"],
  ["CANADIAN", "Canadian Solar"],
  ["CSI", "Canadian Solar"],
  ["LONGI", "LONGi"],
  ["RISEN", "Risen"],
  ["ASTRONERGY", "Astronergy"],
  ["CHINTNEWENERGY", "Astronergy"],
  ["CHINTSOLAR", "Astronergy"],
  ["CHINTPOWER", "Chint Power"],
  ["CPS", "Chint Power"],
  ["DAH", "DAH Solar"],
  ["HONOR", "Honor Solar"],
  ["OSDA", "OSDA"],
  ["SUNOVA", "Sunova Solar"],
  ["TSUN", "TSUN"],
  ["RONMA", "Ronma Solar"],
  ["HANERSUN", "Hanersun"],
  ["DMEGC", "DMEGC"],
  ["HENGDIAN", "DMEGC"],
  ["LEAPTON", "Leapton Solar"],
  ["RENESOLA", "ReneSola"],
  ["PULLING", "Pulling Energy"],
  ["PHONO", "Phono Solar"],
  ["TCL", "TCL"],
  ["ZNSHINE", "ZNShine Solar"],
  ["ERASOLAR", "ERA Solar"],
  ["BYD", "BYD"],
  ["WEG", "WEG"],
  ["INTELBRAS", "Intelbras"],
  ["ELGIN", "Elgin"],
  ["BELENERGY", "BelEnergy"],
  ["BEDIN", "Bedin Solar"],
  ["RENEPV", "RenePV"],
  ["RESUN", "Resun Solar"],
  ["TONGWEI", "Tongwei"],
  ["GCL", "GCL"],
  ["SERAPHIM", "Seraphim"],
  ["HUASUN", "Huasun"],
  ["AIKO", "AIKO"],
  ["YINGLI", "Yingli"],
  ["MAXEON", "Maxeon"],
  ["SUNPOWER", "Maxeon"],
  ["QCELLS", "Qcells"],
  ["HANWHA", "Qcells"],
  ["GROWATT", "Growatt"],
  ["DEYE", "Deye"],
  ["NINGBODEYE", "Deye"],
  ["SAJ", "SAJ"],
  ["SOLPLANET", "Solplanet"],
  ["AISWEI", "Solplanet"],
  ["SOLIS", "Solis"],
  ["GINLONG", "Solis"],
  ["HOYMILES", "Hoymiles"],
  ["HUAWEI", "Huawei"],
  ["SUNGROW", "Sungrow"],
  ["GOODWE", "GoodWe"],
  ["SOFAR", "Sofar"],
  ["FOXESS", "FoxESS"],
  ["FOX", "FoxESS"],
  ["APSYSTEMS", "APsystems"],
  ["ALTENERGY", "APsystems"],
  ["NEP", "NEP"],
  ["NORTHERNELECTRIC", "NEP"],
  ["FRONIUS", "Fronius"],
  ["SMA", "SMA"],
  ["ENPHASE", "Enphase"],
  ["AUXSOL", "AUXSOL"],
  ["KSTAR", "Kstar"],
  ["LIVOLTEK", "Livoltek"],
  ["ECOSOLYS", "Ecosolys"],
  ["SOLAREDGE", "SolarEdge"],
  ["ABB", "ABB"],
  ["FIMER", "FIMER"],
  ["REFUSOL", "Refusol"],
  ["SOLAX", "SolaX"],
  ["HYXI", "Hyxipower"],
];

/** Tira o código que alguns cadastros põem na frente do nome ("283 - SOLIS", "1681 - JAM72…"). */
function semCodigoNaFrente(t: string): string {
  return t.replace(/^\s*\d{1,5}\s*[-–]\s*/, "").trim();
}

/** "JINKO SOLAR CO., LTD" → "Jinko Solar". Fabricante desconhecido sai como foi escrito, aparado. */
export function nomeDoFabricante(bruto: string): string {
  bruto = semCodigoNaFrente(bruto);
  const k = chaveDeNome(bruto);
  if (k === "ERA") return "ERA Solar";
  // O prefixo mais comprido ganha: "CHINTPOWER" antes de "CHINT…".
  let melhor: [string, string] | null = null;
  for (const par of FABRICANTES) {
    if (k.startsWith(par[0]) && (!melhor || par[0].length > melhor[0].length)) melhor = par;
  }
  if (melhor) {
    // "JA" é curto demais: só vale se for o nome inteiro ou "JA SOLAR…".
    if (melhor[0] === "JA" && !(k === "JA" || k.startsWith("JASOLAR"))) return limpo(bruto);
    if (melhor[0] === "FOX" && !k.startsWith("FOXESS") && k !== "FOX") return limpo(bruto);
    if (melhor[0] === "SMA" && !(k === "SMA" || k.startsWith("SMASOLAR") || k.startsWith("SMAAMERICA"))) return limpo(bruto);
    if (melhor[0] === "NEP" && !(k === "NEP" || k.startsWith("NEPVIEW") || k.startsWith("NEPMICRO"))) return limpo(bruto);
    return melhor[1];
  }
  return limpo(bruto);
}

function limpo(t: string): string {
  return t.replace(/\s+/g, " ").trim();
}

const MARCAS_DE_MICRO = new Set(["Hoymiles", "APsystems", "Enphase", "NEP"]);

/**
 * Microinversor pelo nome. Os padrões são os dos modelos que mais aparecem nos
 * cadastros: Hoymiles HM/HMS/HMT, APsystems DS3/QS1/EZ1, Enphase IQ, NEP BDM,
 * Deye SUN-M…G4 e SUN2000G3, Growatt NEO…M, SAJ M2, FoxESS Q1, TSUN TSOL-M.
 */
export function ehMicroinversor(fabricante: string, modelo: string): boolean {
  const m = modelo.toUpperCase();
  if (/(^|[^A-Z])(HMS|HMT|HM|MI)-?\d{3,4}/.test(m)) return true;
  if (/\b(DS3|QS1|QT2|EZ1|YC\d{3,4}|IQ\d|BDM-?\d|TSOL-?M)/.test(m)) return true;
  if (/SUN-?M\d{2,3}G\d/.test(m) || /SUN\d{3,4}G\d/.test(m)) return true;
  if (/\bNEO\s*-?\d{3,4}M/.test(m)) return true;
  if (/^M2-\d/.test(m) || /\bQ1-\d{3,4}/.test(m)) return true;
  if (/MICRO/.test(m)) return true;
  return MARCAS_DE_MICRO.has(fabricante) && /\d{3,4}/.test(m);
}

/**
 * A potência nominal (em W) escrita no nome do modelo, ou nulo quando o nome
 * não diz. Serve para inversor e microinversor; módulo tem a potência no
 * cadastro (potência total ÷ quantidade).
 */
export function potenciaDoNome(modelo: string): number | null {
  const m = modelo.toUpperCase().replace(",", ".");
  // Deye micro: SUN-M225G4 = 2.250 W; SUN-M80G3 = 800 W.
  let r = m.match(/SUN-?M(\d{2,3})G\d/);
  if (r) return Number(r[1]) * 10;
  // WEG: SIW200G M050 = 5,0 kW (o número depois do M é em centenas de watts).
  r = m.match(/SIW\d{3}[A-Z]?\s*[MT]0?(\d{2,3})\b/);
  if (r) return Number(r[1]) * 100;
  // "SUN2000-5KTL" (Huawei): o 2000 é o nome da linha; vale o "5K".
  r = m.match(/(\d+(?:\.\d+)?)\s*K/);
  if (r && Number(r[1]) > 0 && Number(r[1]) <= 500) return Math.round(Number(r[1]) * 1000);
  // Fronius Primo 5.0-1, Symo 10.0-3-M.
  r = m.match(/(?:PRIMO|SYMO|GALVO|ECO|TAURO)\s*(\d+(?:\.\d+)?)-\d/);
  if (r) return Math.round(Number(r[1]) * 1000);
  // Sungrow SG5.0RS, SG10RS, SG6K-D.
  r = m.match(/\bSG(\d+(?:\.\d+)?)(?:RS|RT|K)/);
  if (r) return Math.round(Number(r[1]) * 1000);
  // Número de 3 a 6 dígitos que pareça watts: "MIN 5000TL-X", "HMS-2000-4T", "ASW5000".
  const nums = [...m.matchAll(/(\d{3,6})/g)].map((x) => Number(x[1])).filter((n) => n >= 200 && n <= 250_000);
  return nums.length ? nums[0] : null;
}

/** Quantas fases tem o inversor, quando o nome do modelo deixa claro. */
export function fasesDoNome(fabricante: string, modelo: string, micro: boolean): 1 | 3 | null {
  const m = modelo.toUpperCase();
  if (micro) return /^HMT|\bQT2|-3P|TRIF/.test(m) ? 3 : 1;
  switch (fabricante) {
    case "Growatt":
      if (/\b(MIN|MIC|NEO|SPH\s?\d|MIN\d)/.test(m) || /^MI[NC]/.test(m)) return 1;
      if (/\b(MID|MOD|MAX|MAC|MOD\d)|TL3/.test(m)) return 3;
      return null;
    case "Solis":
      if (/GR1P|1P\d/.test(m)) return 1;
      if (/GR3P|3P\d/.test(m)) return 3;
      return null;
    case "Huawei":
      if (/-L1\b|L1$/.test(m)) return 1;
      if (/-M\d|M\d$|-MB0|-MAP0/.test(m)) return 3;
      return null;
    case "Deye":
      if (/G0[34]|-SG0|LP3|HP3/.test(m)) return 3;
      if (/-G\b|-G$|-G-|-SG\d/.test(m)) return 1;
      return null;
    case "Sungrow":
      if (/RS\b|RS-|RS$/.test(m)) return 1;
      if (/RT\b|RT-|RT$|CX|KTL-M/.test(m)) return 3;
      return null;
    case "GoodWe":
      if (/DNS|XS|-NS|MS\b|-SS/.test(m)) return 1;
      if (/SDT|-DT|MT|SMT|HT|ET\b/.test(m)) return 3;
      return null;
    case "Solplanet":
      if (/-S\b|-S-|-S$/.test(m)) return 1;
      if (/-T\b|-T-|-T$/.test(m)) return 3;
      return null;
    case "Sofar":
      if (/KTLM/.test(m)) return 1;
      if (/KTLX|KTL-X/.test(m)) return 3;
      return null;
    case "SAJ":
      if (/-S\d|S\d-/.test(m)) return 1;
      if (/-T\d|T\d-/.test(m)) return 3;
      return null;
    case "Fronius":
      if (/PRIMO|GALVO/.test(m)) return 1;
      if (/SYMO|ECO|TAURO/.test(m)) return 3;
      return null;
    case "WEG":
      if (/SIW\d{3}[A-Z]?\s*M/.test(m)) return 1;
      if (/SIW\d{3}[A-Z]?\s*T/.test(m)) return 3;
      return null;
    default:
      return null;
  }
}

/**
 * O modelo sem o que a digitação acrescenta: o código na frente, o nome do
 * fabricante repetido ("JA Solar JAM72S30…") e a potência repetida no fim
 * ("JAM72S30-550/MR 550W"). A potência só sai quando o resto do nome já a
 * diz — em "HN18N-72H585W" ela é parte do modelo e fica.
 */
export function limparModelo(bruto: string, fabricante: string): string {
  let m = semCodigoNaFrente(bruto).replace(/\s+/g, " ");
  const kFab = chaveDeNome(fabricante);
  const palavras = m.split(" ");
  // "JA Solar JAM72…": tira palavras do começo enquanto forem o nome do fabricante.
  let tirar = 0;
  let juntas = "";
  for (let i = 0; i < palavras.length - 1; i++) {
    juntas += chaveDeNome(palavras[i]);
    if (kFab.startsWith(juntas) && juntas.length >= 2) tirar = i + 1;
    else break;
  }
  if (tirar) m = palavras.slice(tirar).join(" ");
  const fim = m.match(/^(.*?)[\s\-_/]*\(?(\d{3,4})\s*W[Pp]?\)?\s*$/i);
  if (fim && fim[1].includes(fim[2]) && fim[1].length >= 4) m = fim[1];
  return m.replace(/[\s\-_/]+$/, "").trim();
}

/** A chave que identifica um modelo na base: o tipo e o modelo sem pontuação. */
export function idDaBase(tipo: TipoDeEquipamento, modelo: string): string {
  return `${tipo}:${chaveDeNome(modelo)}`;
}

/** Nome que não é modelo de verdade: "Não há", "naoinformado", só a potência ("550"). */
export function modeloInvalido(modelo: string): boolean {
  const k = chaveDeNome(modelo);
  if (k.length < 4) return true;
  if (!/[A-Z]/.test(k) || !/\d/.test(k)) return true;
  return /^(NAO|NA$|NENHUM|SEM|OUTRO|DIVERSO|INFORMAR|GENERICO|MODULO|INVERSOR|PAINEL|PLACA)/.test(k);
}
