/**
 * As contas do estoque que não precisam de banco, para o `testar-regras.ts`
 * conferir sozinho:
 *
 * - ler o XML da NF-e (itens de `det/prod`, a observação, o fornecedor);
 * - tirar itens do texto da observação — **as notas da empresa vêm com um item
 *   só ("KIT GERADOR…") e os componentes escritos nas informações
 *   complementares**, então a lista de verdade está no texto;
 * - juntar a lista e a observação sem contar o kit duas vezes;
 * - sugerir o item do estoque e o modelo do catálogo para cada linha;
 * - quanto lançar (ou estornar) para a baixa da OS bater com o que foi usado.
 */

import type { LinhaDaEntrada } from "@/db/schema/estoque";

// ------------------------------------------------------------------ números

/** "1.234,5" → 1234.5; "10.0000" (XML) → 10; "1,5" → 1.5. Nulo se não for número. */
export function numeroBr(bruto: string | number | null | undefined): number | null {
  if (typeof bruto === "number") return Number.isFinite(bruto) ? bruto : null;
  if (!bruto) return null;
  let s = String(bruto).trim().replace(/\s/g, "");
  if (!s) return null;
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, "");
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Três casas, que é o que a coluna guarda — e tira o -0. */
export function arredondar(n: number): number {
  const r = Math.round(n * 1000) / 1000;
  return Object.is(r, -0) ? 0 : r;
}

/** "10", "2,5" — quantidade para a tela, sem zeros sobrando. */
export function quantidadeLegivel(n: number | string | null | undefined): string {
  const v = typeof n === "string" ? Number(n) : (n ?? 0);
  return arredondar(Number.isFinite(v) ? v : 0).toLocaleString("pt-BR", { maximumFractionDigits: 3 });
}

// ------------------------------------------------------------------ unidade

const UNIDADES: Record<string, string> = {
  UN: "un", UND: "un", UNID: "un", UNIDADE: "un", UNIDADES: "un", U: "un", UNI: "un",
  PC: "un", PCS: "un", PÇ: "un", PÇS: "un", PECA: "un", PECAS: "un", PEÇA: "un", PEÇAS: "un", X: "un",
  M: "m", MT: "m", MTS: "m", MTR: "m", METRO: "m", METROS: "m", ML: "m",
  KG: "kg", QUILO: "kg",
  CX: "cx", CAIXA: "cx", CAIXAS: "cx",
  RL: "rolo", ROLO: "rolo", ROLOS: "rolo",
  KIT: "kit", KITS: "kit", KT: "kit",
  PAR: "par", PARES: "par", PR: "par",
  CJ: "cj", CONJ: "cj", CONJUNTO: "cj", CONJUNTOS: "cj",
  L: "l", LT: "l", LITRO: "l", LITROS: "l",
};

/** A unidade da nota ("UND", "PÇ", "MT") no jeito do estoque ("un", "m"). */
export function normalizarUnidade(bruta: string | null | undefined): string {
  const s = (bruta ?? "").trim().toUpperCase().replace(/[.\s]/g, "");
  if (!s) return "un";
  return UNIDADES[s] ?? UNIDADES[s.normalize("NFD").replace(/[̀-ͯ]/g, "")] ?? s.toLowerCase().slice(0, 10);
}

// ------------------------------------------------------------------ nomes

/** Sem acento, em caixa alta, só letras e números separados por espaço. */
export function normalizarTexto(t: string): string {
  return t
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
}

/** A chave do item: impede "Cabo solar 6mm" e "CABO SOLAR 6 MM" virarem dois. */
export function chaveDoNome(nome: string): string {
  return normalizarTexto(nome).replace(/\s+/g, "").slice(0, 200);
}

/** "MODULOS" e "MODULO", "INVERSORES" e "INVERSOR" contam como a mesma palavra. */
function singular(p: string): string {
  if (p.length > 5 && /[RZL]ES$/.test(p)) return p.slice(0, -2);
  if (p.length > 3 && p.endsWith("S") && !/\d/.test(p)) return p.slice(0, -1);
  return p;
}

function palavras(t: string): Set<string> {
  return new Set(normalizarTexto(t).split(" ").filter((p) => p.length >= 2).map(singular));
}

/** As duas descrições falam da mesma coisa? (uma contém a outra, ou 60% das palavras batem) */
export function mesmaDescricao(a: string, b: string): boolean {
  const ca = chaveDoNome(a);
  const cb = chaveDoNome(b);
  if (!ca || !cb) return false;
  if (ca === cb) return true;
  if (Math.min(ca.length, cb.length) >= 8 && (ca.includes(cb) || cb.includes(ca))) return true;
  const pa = palavras(a);
  const pb = palavras(b);
  if (!pa.size || !pb.size) return false;
  let comuns = 0;
  for (const p of pa) if (pb.has(p)) comuns++;
  return comuns / (pa.size + pb.size - comuns) >= 0.6;
}

// ------------------------------------------------------------------ XML da NF-e

function decodificar(t: string): string {
  return t
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&amp;/g, "&")
    .trim();
}

/** O miolo de cada `<tag>…</tag>` (com ou sem prefixo de namespace). */
function blocos(xml: string, tag: string): string[] {
  const re = new RegExp(`<(?:\\w+:)?${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:\\w+:)?${tag}>`, "g");
  return [...xml.matchAll(re)].map((m) => m[1]);
}

function valor(xml: string, tag: string): string | null {
  const b = blocos(xml, tag)[0];
  return b === undefined ? null : decodificar(b) || null;
}

/** Parece XML de NF-e? (o arquivo pode vir com BOM ou sem o `<?xml`) */
export function ehXmlDeNota(conteudo: Uint8Array | string): boolean {
  const inicio = (typeof conteudo === "string" ? conteudo : Buffer.from(conteudo.subarray(0, 4096)).toString("utf8"))
    .replace(/^﻿/, "")
    .trimStart()
    .slice(0, 4096);
  return inicio.startsWith("<") && /<(?:\w+:)?(?:nfeProc|NFe|infNFe)\b/.test(inicio);
}

export interface ItemDaNota {
  codigo: string | null;
  descricao: string;
  quantidade: number;
  unidade: string;
  valorUnitario: number | null;
  /** `infAdProd`: o texto que a empresa escreve embaixo do item. */
  informacaoAdicional: string | null;
}

export interface NotaLida {
  numero: string | null;
  serie: string | null;
  chaveAcesso: string | null;
  emitidaEm: string | null;
  fornecedor: string | null;
  cnpjFornecedor: string | null;
  valorTotal: number | null;
  itens: ItemDaNota[];
  /** Informações complementares (`infCpl`) e as do fisco (`infAdFisco`). */
  observacao: string | null;
}

/** Lê o XML da NF-e (o `nfeProc` que o fornecedor manda, ou só a `NFe`). Nulo se não for nota. */
export function lerXmlDaNota(xml: string): NotaLida | null {
  const texto = xml.replace(/^﻿/, "");
  const inf = blocos(texto, "infNFe")[0];
  if (!inf) return null;

  const idMatch = texto.match(/<(?:\w+:)?infNFe[^>]*\bId="(?:NFe)?(\d{44})"/);
  const chaveProt = valor(texto, "chNFe");
  const chave = idMatch?.[1] ?? (chaveProt && /^\d{44}$/.test(chaveProt) ? chaveProt : null);

  const ide = blocos(inf, "ide")[0] ?? "";
  const emit = blocos(inf, "emit")[0] ?? "";
  const total = blocos(inf, "ICMSTot")[0] ?? "";
  const infAdic = blocos(inf, "infAdic")[0] ?? "";

  const emissao = valor(ide, "dhEmi") ?? valor(ide, "dEmi");
  const itens: ItemDaNota[] = [];
  for (const det of blocos(inf, "det")) {
    const prod = blocos(det, "prod")[0];
    if (!prod) continue;
    const descricao = valor(prod, "xProd");
    const quantidade = Number(valor(prod, "qCom") ?? valor(prod, "qTrib") ?? "");
    if (!descricao || !Number.isFinite(quantidade)) continue;
    const vUn = Number(valor(prod, "vUnCom") ?? "");
    itens.push({
      codigo: valor(prod, "cProd"),
      descricao,
      quantidade,
      unidade: normalizarUnidade(valor(prod, "uCom") ?? valor(prod, "uTrib")),
      valorUnitario: Number.isFinite(vUn) ? vUn : null,
      informacaoAdicional: valor(det, "infAdProd"),
    });
  }

  const obs = [valor(infAdic, "infCpl"), valor(infAdic, "infAdFisco")].filter(Boolean).join("\n");
  const vNF = Number(valor(total, "vNF") ?? "");
  return {
    numero: valor(ide, "nNF"),
    serie: valor(ide, "serie"),
    chaveAcesso: chave,
    emitidaEm: emissao && /^\d{4}-\d{2}-\d{2}/.test(emissao) ? emissao.slice(0, 10) : null,
    fornecedor: valor(emit, "xNome"),
    cnpjFornecedor: valor(emit, "CNPJ"),
    valorTotal: Number.isFinite(vNF) ? vNF : null,
    itens,
    observacao: obs || null,
  };
}

// ------------------------------------------------------------------ itens no texto da observação

export interface ItemDoTexto {
  descricao: string;
  quantidade: number;
  unidade: string;
}

const PALAVRA_UNIDADE =
  "x|un|und|unid|unidades?|p[cç]s?|pe[cç]as?|m|mt|mts|metros?|rolos?|rl|kg|cx|caixas?|kits?|par(?:es)?|cj|conj|conjuntos?";

/** "10 X MODULO…", "01 UN - INVERSOR…", "40 M CABO…", "10x Módulo…" */
const QTD_NA_FRENTE = new RegExp(
  `^(\\d+(?:[.,]\\d+)?)\\s*(?:(${PALAVRA_UNIDADE})\\.?(?=[\\s\\-–:])|x(?=\\S))?\\s*(?:[-–:]\\s*)?(.+)$`,
  "i",
);
/** "MODULO JA SOLAR 550W QTD: 10", "INVERSOR … QUANTIDADE 1 UN" */
const QTD_ESCRITA = new RegExp(
  `^(.+?)[\\s,\\-–(]*\\b(?:qtd|qtde|quant|quantidade)\\.?\\s*:?\\s*(\\d+(?:[.,]\\d+)?)\\s*(${PALAVRA_UNIDADE})?\\.?\\)?$`,
  "i",
);
/** "MODULO JA SOLAR 550W - 10 UN", "CABO SOLAR 6MM (40 M)", "STRING BOX x 1" */
const QTD_ATRAS = new RegExp(
  `^(.+?)\\s*(?:[-–(:]\\s*|\\s)(\\d+(?:[.,]\\d+)?)\\s*(${PALAVRA_UNIDADE})\\.?\\)?$`,
  "i",
);
const QTD_COM_X = /^(.+?)\s+x\s*(\d+(?:[.,]\d+)?)$/i;

/** Texto que não é item mesmo começando com número ("1 via", "12.741/2012"…). */
const LIXO = /tributos|lei\s*\d|simples nacional|icms|ipi\b|pis\b|cofins|cfop|nf-?e\b|documento emitido|vendedor|pedido\s*(n|:|\d)|vencimento|boleto|parcela|transportadora|frete|banco|ag[eê]ncia|conta\b|pix\b|chave de acesso|protocolo|^\d+\s*(via|dias?)\b/i;

function itemDoTrecho(trecho: string): ItemDoTexto | null {
  const t = trecho.replace(/^[\s\-–•*·>]+/, "").replace(/[\s.;,]+$/, "").trim();
  if (t.length < 4 || LIXO.test(t)) return null;

  const montar = (desc: string, qtd: string, un?: string): ItemDoTexto | null => {
    const quantidade = numeroBr(qtd);
    const descricao = desc.replace(/^[\s\-–:]+|[\s\-–:,(]+$/g, "").trim();
    if (quantidade === null || quantidade <= 0 || quantidade > 100_000) return null;
    if (descricao.length < 3 || !/[a-z]{2}/i.test(descricao)) return null;
    return { descricao, quantidade, unidade: normalizarUnidade(un && un.toLowerCase() !== "x" ? un : "un") };
  };

  let m = t.match(QTD_ESCRITA);
  if (m) return montar(m[1], m[2], m[3]);
  m = t.match(QTD_NA_FRENTE);
  if (m) {
    // "550W MODULO" não é 550 de nada: o número colado em letra é potência ou bitola.
    const colado = /^\d+(?:[.,]\d+)?[a-z]/i.test(t) && !m[2] && !/^\d+(?:[.,]\d+)?x/i.test(t);
    if (!colado) return montar(m[3], m[1], m[2]);
  }
  m = t.match(QTD_ATRAS);
  if (m) return montar(m[1], m[2], m[3]);
  m = t.match(QTD_COM_X);
  if (m) return montar(m[1], m[2]);
  // "OBS: 10 MODULOS…" — o rótulo antes dos dois-pontos não é item; tenta o resto.
  const depois = t.match(/^[^\d:]{1,40}:\s*(\d.+)$/);
  return depois ? itemDoTrecho(depois[1]) : null;
}

/** Depois do separador vem quantidade e uma palavra de verdade (não só "UN"). */
const VEM_ITEM = "(?=\\d+(?:[.,]\\d+)?[ \\t]*(?:(?:x|un|und|p[cç]s?|mt?|mts|rl|rolos?|cx|kits?|par|cj)\\.?[ \\t]+)?[a-zà-ú]{3,})";

/**
 * Os itens escritos num texto livre — a observação da nota, o `infAdProd`, as
 * linhas que o fornecedor põe embaixo do item. Cada linha, ponto e vírgula,
 * barra vertical ou vírgula seguida de quantidade é um candidato; o que não
 * tem quantidade (aviso de tributo, dados do pedido) fica de fora.
 */
export function itensDoTexto(texto: string | null | undefined): ItemDoTexto[] {
  if (!texto) return [];
  const pedacos = texto
    .replace(/\r/g, "")
    // "COMPOSIÇÃO DO KIT: 10 MODULOS…" — o cabeçalho antes dos dois-pontos não é item.
    .replace(/(?:^|\n|;)\s*[^\n;:]{0,60}\b(?:composi[cç][aã]o|composto|cont[eé]m|itens|segue|kit)\b[^\n;:]{0,40}:\s*/gi, "\n")
    .split(new RegExp(`\\n|;|\\s\\|\\s|•|,\\s+${VEM_ITEM}|\\s+[-–]\\s+${VEM_ITEM}`, "i"));
  const itens: ItemDoTexto[] = [];
  for (const p of pedacos) {
    const item = itemDoTrecho(p);
    if (item) itens.push(item);
  }
  return itens;
}

// ------------------------------------------------------------------ juntar

/** O item da lista é um kit fechado ("KIT GERADOR 5,5 KWP", "SISTEMA FOTOVOLTAICO")? */
export function pareceKit(descricao: string): boolean {
  return /\b(kit|gerador|sistema\s+(fotovoltaico|solar|de\s+gera)|usina|solu[cç][aã]o\s+solar|on\s*grid)\b/i.test(descricao);
}

function linha(
  parcial: Pick<LinhaDaEntrada, "descricao" | "quantidade" | "unidade" | "origem"> & Partial<LinhaDaEntrada>,
): LinhaDaEntrada {
  return {
    codigo: null,
    valorUnitario: null,
    entra: true,
    motivo: null,
    itemId: null,
    modeloId: null,
    ...parcial,
    quantidade: arredondar(parcial.quantidade),
  };
}

/**
 * Junta os itens da lista da nota com os que vieram escritos na observação (e
 * embaixo de cada item).
 *
 * Quando a observação traz componentes, o item da lista que é um kit fechado —
 * ou o único item da nota — vira **resumo do kit** e começa fora do estoque:
 * entrar "1 KIT GERADOR" e os 10 módulos dele contaria o kit duas vezes. Quem
 * confere pode ligar de volta. Item da observação que repete um da lista
 * também começa fora.
 */
export function juntarItensDaNota(itens: ItemDaNota[], observacao: string | null): LinhaDaEntrada[] {
  const escritos: ItemDoTexto[] = [];
  for (const i of itens) escritos.push(...itensDoTexto(i.informacaoAdicional));
  escritos.push(...itensDoTexto(observacao));
  return juntarListaEObservacao(itens, escritos);
}

/**
 * A mesma junção quando os itens da observação já vieram separados (pela
 * Groq, na foto ou no PDF). `resumoDoKit` é a leitura dizendo que aquele item
 * da lista é o kit cujos componentes estão no texto.
 */
export function juntarListaEObservacao(
  itens: (Omit<ItemDaNota, "informacaoAdicional"> & { resumoDoKit?: boolean })[],
  escritos: ItemDoTexto[],
): LinhaDaEntrada[] {
  const daObservacao = escritos.map((t) => linha({ ...t, origem: "observacao" }));
  const temComponentes = daObservacao.length > 0;
  const daLista = itens.map((i) => {
    const resumo = temComponentes && (itens.length === 1 || pareceKit(i.descricao) || Boolean(i.resumoDoKit));
    return linha({
      descricao: i.descricao,
      quantidade: i.quantidade,
      unidade: i.unidade,
      codigo: i.codigo,
      valorUnitario: i.valorUnitario,
      origem: "lista",
      entra: !resumo,
      motivo: resumo ? "Resumo do kit: os componentes vieram na observação" : null,
    });
  });
  return marcarRepetidos([...daLista, ...daObservacao]);
}

/**
 * Linha que repete outra já marcada para entrar (mesma descrição e mesma
 * quantidade) começa fora. A ordem decide quem fica: a lista da nota, depois a
 * observação, depois o pedido — nota e pedido da mesma compra não dobram o saldo.
 */
export function marcarRepetidos(linhas: LinhaDaEntrada[]): LinhaDaEntrada[] {
  const ficam: LinhaDaEntrada[] = [];
  return linhas.map((l) => {
    if (!l.entra) return l;
    const repete = ficam.some(
      (f) => f.origem !== l.origem && Math.abs(f.quantidade - l.quantidade) < 0.0005 && mesmaDescricao(f.descricao, l.descricao),
    );
    if (repete) {
      const rotulo = l.origem === "pedido" ? "Já está na nota" : "Repete um item da lista";
      return { ...l, entra: false, motivo: rotulo };
    }
    ficam.push(l);
    return l;
  });
}

// ------------------------------------------------------------------ ligar ao estoque e ao catálogo

export interface ItemParaSugestao {
  id: string;
  nome: string;
  codigo: string | null;
  modeloEquipamentoId: string | null;
}

export interface ModeloParaSugestao {
  id: string;
  fabricante: string;
  modelo: string;
}

/**
 * Qual item do estoque (e qual modelo do catálogo) uma linha da nota é.
 *
 * Pelo código do fornecedor, pelo nome igual, ou pelo modelo do catálogo
 * escrito na descrição ("…GROWATT MIN 5000TL-X…" → o MIN 5000TL-X do catálogo,
 * e o item do estoque ligado a ele). Na dúvida, nada: quem confere escolhe.
 */
export function sugerirItem(
  l: { descricao: string; codigo: string | null },
  itens: ItemParaSugestao[],
  modelos: ModeloParaSugestao[],
): { itemId: string | null; modeloId: string | null } {
  const chave = chaveDoNome(l.descricao);
  let modeloId: string | null = null;
  let maior = 0;
  for (const m of modelos) {
    const cm = chaveDoNome(m.modelo);
    if (cm.length >= 4 && chave.includes(cm) && cm.length > maior) {
      modeloId = m.id;
      maior = cm.length;
    }
  }

  const codigo = l.codigo?.trim();
  const porCodigo = codigo ? itens.find((i) => i.codigo?.trim() === codigo) : undefined;
  const porNome = itens.find((i) => chaveDoNome(i.nome) === chave);
  const porModelo = modeloId ? itens.find((i) => i.modeloEquipamentoId === modeloId) : undefined;
  const item = porCodigo ?? porNome ?? porModelo ?? parecido(l.descricao, itens) ?? null;
  return { itemId: item?.id ?? null, modeloId: modeloId ?? item?.modeloEquipamentoId ?? null };
}

/**
 * O item do estoque que a descrição da nota descreve com outras palavras
 * ("MODULOS FOTOVOLTAICOS JA SOLAR 550W" → "Módulo JA Solar 550W").
 *
 * Os números têm de bater (550W, 6MM, 5000TL): é o que separa um módulo de
 * 550 de um de 585. E pede 75% das palavras em comum, para "cabo 6mm preto" não
 * cair no "cabo 6mm vermelho". Mais de um candidato empatado: nenhum.
 */
function parecido<T extends { nome: string }>(descricao: string, itens: T[]): T | undefined {
  const pd = palavras(descricao);
  const numeros = (p: Set<string>) => [...p].filter((x) => /\d/.test(x)).sort().join(" ");
  const nd = numeros(pd);
  let melhor: T | undefined;
  let nota = 0;
  let empate = false;
  for (const i of itens) {
    const pi = palavras(i.nome);
    if (numeros(pi) !== nd) continue;
    let comuns = 0;
    for (const x of pd) if (pi.has(x)) comuns++;
    const indice = comuns / (pd.size + pi.size - comuns);
    const contem = Math.min(chaveDoNome(descricao).length, chaveDoNome(i.nome).length) >= 8 &&
      (chaveDoNome(descricao).includes(chaveDoNome(i.nome)) || chaveDoNome(i.nome).includes(chaveDoNome(descricao)));
    const valor = contem ? Math.max(indice, 0.75) : indice;
    if (valor < 0.75) continue;
    if (valor > nota) {
      melhor = i;
      nota = valor;
      empate = false;
    } else if (valor === nota) empate = true;
  }
  return empate ? undefined : melhor;
}

// ------------------------------------------------------------------ baixa da OS

export interface LancamentoDaBaixa {
  itemId: string;
  /** Como vai para o livro: negativo é saída ("os"), positivo é estorno. */
  quantidade: number;
  motivo: "os" | "estorno";
}

/**
 * O que lançar para o estoque bater com o que a OS usou.
 *
 * `usado` é o que está registrado na OS agora (zero se ela foi cancelada);
 * `lancado` é o que o livro já tirou por esta OS. A diferença vira uma saída
 * (usou mais) ou um estorno (corrigiu para menos, tirou o item, cancelou).
 * Rodar de novo sem mudança não lança nada.
 */
export function diferencaDaBaixa(usado: Map<string, number>, lancado: Map<string, number>): LancamentoDaBaixa[] {
  const ids = new Set([...usado.keys(), ...lancado.keys()]);
  const saida: LancamentoDaBaixa[] = [];
  for (const id of [...ids].sort()) {
    const falta = arredondar((usado.get(id) ?? 0) - (lancado.get(id) ?? 0));
    if (Math.abs(falta) < 0.0005) continue;
    saida.push({ itemId: id, quantidade: -falta, motivo: falta > 0 ? "os" : "estorno" });
  }
  return saida;
}

/** O saldo é a soma do livro. */
export function saldoDe(movimentos: { quantidade: number | string }[]): number {
  return arredondar(movimentos.reduce((s, m) => s + Number(m.quantidade), 0));
}

export type SituacaoDoSaldo = "negativo" | "zerado" | "baixo" | "ok";

export function situacaoDoSaldo(saldo: number, minimo: number | null): SituacaoDoSaldo {
  if (saldo < 0) return "negativo";
  if (saldo === 0) return "zerado";
  if (minimo !== null && saldo < minimo) return "baixo";
  return "ok";
}

/** Quantidade que veio da tela ou do app: positiva, até 100 mil, três casas. Nulo se não servir. */
export function quantidadeValida(bruta: unknown): number | null {
  const n = typeof bruta === "number" ? bruta : numeroBr(String(bruta ?? ""));
  if (n === null || !Number.isFinite(n) || n <= 0 || n > 100_000) return null;
  const r = arredondar(n);
  return r > 0 ? r : null;
}
