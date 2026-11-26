/**
 * Lê a nota fiscal ou o pedido do fornecedor e devolve os itens para a
 * conferência da entrada no estoque.
 *
 * - **XML da NF-e**: lido direto, sem IA (`regras.ts`). Os itens da lista e os
 *   escritos na observação se juntam ali.
 * - **Foto ou PDF**: vai para a Groq como a conta de luz da proposta
 *   (`proposta/ler-conta.ts`): `GROQ_API_KEY`, `GROQ_MODELO`, o PDF desenhado
 *   como imagem (`unpdf` + `@napi-rs/canvas`) junto com o texto, e a resposta
 *   presa a um JSON Schema estrito.
 *
 * O cuidado das notas da empresa: **vem um item só na lista ("KIT GERADOR…") e
 * os componentes nas informações complementares ou em linhas abaixo**. O
 * pedido à Groq diz isso com todas as letras e pede os dois lugares, marcando
 * de onde veio cada item; a junção (`juntarListaEObservacao`) tira o kit da
 * conta para ele não entrar junto com os próprios componentes.
 *
 * O documento vai para a Groq só nesta chamada; o Selebi guarda o arquivo no
 * Drive e os itens que viraram estoque.
 */

import { z } from "zod";

import type { LinhaDaEntrada } from "@/db/schema/estoque";
import { paginaDoPdfComoImagem, textoDoPdf } from "@/proposta/ler-conta";

import {
  arredondar,
  ehXmlDeNota,
  itensDoTexto,
  juntarItensDaNota,
  juntarListaEObservacao,
  lerXmlDaNota,
  normalizarUnidade,
} from "./regras";

const ENDERECO = "https://api.groq.com/openai/v1/chat/completions";
const MODELO_PADRAO = "qwen/qwen3.8-27b";
const ESPERA_MS = 60_000;
/** O plano gratuito conta uns 8 mil tokens por minuto: a imagem vale ~2 mil. */
const TEXTO_MAXIMO = 14_000;
const TEXTO_COM_IMAGEM = 7_000;

export type PapelDoArquivo = "nota" | "pedido";

export interface DocumentoLido {
  numero: string | null;
  fornecedor: string | null;
  cnpjFornecedor: string | null;
  emitidaEm: string | null;
  chaveAcesso: string | null;
  valorTotal: number | null;
  linhas: LinhaDaEntrada[];
  leitura: "xml" | "ia";
  aviso: string | null;
}

const Item = z.object({
  descricao: z.string(),
  quantidade: z.number(),
  unidade: z.string().nullable(),
  codigo: z.string().nullable(),
  valorUnitario: z.number().nullable(),
  origem: z.enum(["lista", "observacao"]),
  resumoDoKit: z.boolean(),
});

const Documento = z.object({
  legivel: z.boolean(),
  numero: z.string().nullable(),
  fornecedor: z.string().nullable(),
  cnpjFornecedor: z.string().nullable(),
  emitidaEm: z.string().nullable(),
  chaveAcesso: z.string().nullable(),
  valorTotal: z.number().nullable(),
  itens: z.array(Item),
  observacao: z.string().nullable(),
});

const texto = (descricao: string) => ({ type: ["string", "null"], description: descricao });
const numero = (descricao: string) => ({ type: ["number", "null"], description: descricao });

const ESQUEMA = {
  type: "object",
  additionalProperties: false,
  required: Object.keys(Documento.shape),
  properties: {
    legivel: { type: "boolean", description: "É uma nota fiscal (DANFE) ou um pedido de compra e dá para ler os itens." },
    numero: texto("Número da nota ou do pedido."),
    fornecedor: texto("Razão social de quem vendeu (emitente)."),
    cnpjFornecedor: texto("CNPJ de quem vendeu, só os números."),
    emitidaEm: texto("Data de emissão, AAAA-MM-DD."),
    chaveAcesso: texto("Chave de acesso da NF-e, 44 dígitos, só os números."),
    valorTotal: numero("Valor total do documento (R$)."),
    itens: {
      type: "array",
      description:
        "TODOS os produtos: os da tabela de itens E os escritos nas informações complementares / observação / dados adicionais / linhas de texto abaixo de um item.",
      items: {
        type: "object",
        additionalProperties: false,
        required: Object.keys(Item.shape),
        properties: {
          descricao: { type: "string", description: "Descrição do produto como está escrita." },
          quantidade: { type: "number" },
          unidade: texto("Unidade (UN, M, PC, KG, CX, RL, PAR…)."),
          codigo: texto("Código do produto, se houver."),
          valorUnitario: numero("Valor unitário (R$), se houver."),
          origem: { type: "string", enum: ["lista", "observacao"], description: "lista = tabela de itens; observacao = informações complementares ou texto abaixo de um item." },
          resumoDoKit: {
            type: "boolean",
            description: "true quando este item da tabela é um kit/gerador cujos componentes estão escritos na observação.",
          },
        },
      },
    },
    observacao: texto("O que atrapalhou a leitura, em uma frase."),
  },
};

const PEDIDO =
  "Você lê notas fiscais (DANFE) e pedidos de compra de material de energia solar do Brasil e devolve só um JSON com os campos pedidos. " +
  "ATENÇÃO: muitas notas trazem UM item só na tabela (por exemplo 'KIT GERADOR FOTOVOLTAICO 5,5 KWP') e os componentes " +
  "(módulos, inversor, string box, cabos, conectores, estrutura) escritos nas INFORMAÇÕES COMPLEMENTARES / observação ou em linhas de texto abaixo do item. " +
  "Liste os itens dos DOIS lugares: os da tabela com origem 'lista' e os do texto com origem 'observacao', cada um com a sua quantidade. " +
  "Marque resumoDoKit = true no item da tabela que é o kit cujos componentes vieram no texto. " +
  "Não invente item: texto sem quantidade (aviso de tributos, Simples Nacional, dados de pagamento, transportadora) não é item. " +
  "Quantidades e valores como número (ponto decimal). Campo que não aparece fica null.";

const PEDIDO_COM_FORMATO = `${PEDIDO}\nFormato: {"legivel": bool, "numero": str|null, "fornecedor": str|null, "cnpjFornecedor": str|null, "emitidaEm": "AAAA-MM-DD"|null, "chaveAcesso": str|null, "valorTotal": num|null, "itens": [{"descricao": str, "quantidade": num, "unidade": str|null, "codigo": str|null, "valorUnitario": num|null, "origem": "lista"|"observacao", "resumoDoKit": bool}], "observacao": str|null}`;

export function leituraLigada(): boolean {
  return Boolean(process.env.GROQ_API_KEY?.trim());
}

function dataIso(t: string | null): string | null {
  if (!t) return null;
  const s = t.trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

function soDigitos(t: string | null, tamanho: number): string | null {
  const d = (t ?? "").replace(/\D/g, "");
  return d.length === tamanho ? d : null;
}

function comoPedido(linhas: LinhaDaEntrada[]): LinhaDaEntrada[] {
  return linhas.map((l) => ({ ...l, origem: "pedido" }));
}

/** A resposta da Groq (o texto do JSON) vira o documento lido, ou o motivo de não dar. */
export function documentoDaResposta(conteudo: string, papel: PapelDoArquivo): { lido: DocumentoLido } | { erro: string } {
  let bruto: unknown;
  try {
    bruto = JSON.parse(conteudo.replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, ""));
  } catch {
    return { erro: "Não deu para ler o documento. Lance os itens à mão." };
  }
  const lido = Documento.safeParse(bruto);
  if (!lido.success) return { erro: "Não deu para ler o documento. Lance os itens à mão." };
  const d = lido.data;
  if (!d.legivel) return { erro: d.observacao ? `Não deu para ler: ${d.observacao}` : "O arquivo não parece uma nota ou um pedido legível." };

  const validos = d.itens.filter((i) => i.descricao.trim().length >= 2 && Number.isFinite(i.quantidade) && i.quantidade > 0 && i.quantidade <= 100_000);
  const lista = validos
    .filter((i) => i.origem === "lista")
    .map((i) => ({
      codigo: i.codigo?.trim() || null,
      descricao: i.descricao.trim(),
      quantidade: arredondar(i.quantidade),
      unidade: normalizarUnidade(i.unidade),
      valorUnitario: i.valorUnitario !== null && i.valorUnitario >= 0 ? i.valorUnitario : null,
      resumoDoKit: i.resumoDoKit,
    }));
  const escritos = validos
    .filter((i) => i.origem === "observacao")
    .map((i) => ({ descricao: i.descricao.trim(), quantidade: arredondar(i.quantidade), unidade: normalizarUnidade(i.unidade) }));
  const linhas = juntarListaEObservacao(lista, escritos);
  if (!linhas.length) return { erro: "A leitura não achou nenhum item. Lance os itens à mão." };

  return {
    lido: {
      numero: d.numero?.trim() || null,
      fornecedor: d.fornecedor?.trim() || null,
      cnpjFornecedor: soDigitos(d.cnpjFornecedor, 14),
      emitidaEm: dataIso(d.emitidaEm),
      chaveAcesso: papel === "nota" ? soDigitos(d.chaveAcesso, 44) : null,
      valorTotal: d.valorTotal !== null && d.valorTotal >= 0 ? d.valorTotal : null,
      linhas: papel === "pedido" ? comoPedido(linhas) : linhas,
      leitura: "ia",
      aviso: d.observacao?.trim() || null,
    },
  };
}

type Conteudo = string | ({ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } })[];

async function pedir(chave: string, modelo: string, conteudo: Conteudo, estrito: boolean): Promise<Response> {
  const corpo: Record<string, unknown> = {
    model: modelo,
    messages: [
      { role: "system", content: estrito ? PEDIDO : PEDIDO_COM_FORMATO },
      { role: "user", content: conteudo },
    ],
    temperature: 0,
    max_completion_tokens: 4000,
    response_format: estrito
      ? { type: "json_schema", json_schema: { name: "documento_de_compra", strict: true, schema: ESQUEMA } }
      : { type: "json_object" },
  };
  // Como na conta de luz: o Qwen sem pensar antes, e o pensamento nunca no texto.
  if (estrito) {
    corpo.reasoning_effort = "none";
    corpo.reasoning_format = "hidden";
  }
  return fetch(ENDERECO, {
    method: "POST",
    headers: { Authorization: `Bearer ${chave}`, "Content-Type": "application/json" },
    body: JSON.stringify(corpo),
    signal: AbortSignal.timeout(ESPERA_MS),
  });
}

async function perguntarAGroq(conteudo: Conteudo, papel: PapelDoArquivo): Promise<{ lido: DocumentoLido } | { erro: string }> {
  const chave = process.env.GROQ_API_KEY?.trim();
  if (!chave) return { erro: "A leitura de foto e PDF não está ligada: falta GROQ_API_KEY no .env do servidor. Mande o XML da nota ou lance à mão." };
  const modelo = process.env.GROQ_MODELO?.trim() || MODELO_PADRAO;
  try {
    let resposta = await pedir(chave, modelo, conteudo, true);
    if (resposta.status === 400) resposta = await pedir(chave, modelo, conteudo, false);
    if (resposta.status === 401 || resposta.status === 403) return { erro: "A chave GROQ_API_KEY foi recusada. Confira no .env." };
    if (resposta.status === 429) return { erro: "A Groq limitou as leituras agora (plano gratuito). Tente de novo em um minuto." };
    if (resposta.status === 413) return { erro: "O documento é grande demais para a leitura. Envie uma foto ou o XML." };
    if (resposta.status === 404) return { erro: `O modelo ${modelo} não existe mais na Groq: troque GROQ_MODELO no .env.` };
    if (!resposta.ok) return { erro: `A leitura falhou (erro ${resposta.status} da Groq). Tente de novo.` };
    const dados = (await resposta.json()) as { choices?: { message?: { content?: string | null } }[] };
    const texto = dados.choices?.[0]?.message?.content;
    if (!texto) return { erro: "A Groq não devolveu a leitura. Lance os itens à mão." };
    return documentoDaResposta(texto, papel);
  } catch (e) {
    if (e instanceof Error && e.name === "TimeoutError") return { erro: "A Groq demorou demais para responder. Tente de novo." };
    return { erro: "Sem conexão com a Groq. Tente de novo." };
  }
}

/**
 * Lê o arquivo enviado. `mime` é o tipo reconhecido pelo conteúdo (nunca o
 * declarado pelo navegador): application/xml, application/pdf ou image/*.
 */
export async function lerDocumentoDeEntrada(
  conteudo: Uint8Array,
  mime: string,
  papel: PapelDoArquivo,
): Promise<{ lido: DocumentoLido } | { erro: string }> {
  if (mime === "application/xml") {
    const nota = lerXmlDaNota(Buffer.from(conteudo).toString("utf8"));
    if (!nota) return { erro: "O XML não é de uma NF-e (falta o infNFe)." };
    let linhas = juntarItensDaNota(nota.itens, nota.observacao);
    let aviso: string | null = null;

    // A nota de um item só, com texto na observação que o leitor não entendeu:
    // pede à Groq só o texto (barato), para não perder os componentes do kit.
    const textoLivre = [nota.observacao, ...nota.itens.map((i) => i.informacaoAdicional)].filter(Boolean).join("\n");
    const naoAchou = !linhas.some((l) => l.origem === "observacao") && !itensDoTexto(textoLivre).length;
    if (naoAchou && nota.itens.length === 1 && textoLivre.replace(/\s/g, "").length >= 30) {
      if (leituraLigada()) {
        const r = await perguntarAGroq(
          `Esta é uma NF-e com um item só na lista: "${nota.itens[0].descricao}" (${nota.itens[0].quantidade} ${nota.itens[0].unidade}). ` +
            `Abaixo, as informações complementares. Liste os componentes escritos nelas com origem 'observacao', e o item da lista com origem 'lista'.\n\n${textoLivre.slice(0, TEXTO_MAXIMO)}`,
          "nota",
        );
        if ("lido" in r && r.lido.linhas.some((l) => l.origem === "observacao")) {
          linhas = juntarListaEObservacao(
            nota.itens.map(({ informacaoAdicional: _i, ...i }) => i),
            r.lido.linhas.filter((l) => l.origem === "observacao").map((l) => ({ descricao: l.descricao, quantidade: l.quantidade, unidade: l.unidade })),
          );
          aviso = "Os componentes do kit vieram na observação e foram lidos pela Groq: confira as quantidades.";
        }
      } else {
        aviso = "A nota tem um item só e um texto na observação que não deu para separar em itens. Confira e lance à mão o que faltar.";
      }
    }
    if (!linhas.length) return { erro: "O XML não tem nenhum item." };
    return {
      lido: {
        numero: nota.numero,
        fornecedor: nota.fornecedor,
        cnpjFornecedor: nota.cnpjFornecedor,
        emitidaEm: nota.emitidaEm,
        chaveAcesso: nota.chaveAcesso,
        valorTotal: nota.valorTotal,
        linhas,
        leitura: "xml",
        aviso,
      },
    };
  }

  const nome = papel === "nota" ? "Nota fiscal (DANFE)" : "Pedido de compra";
  if (mime === "application/pdf") {
    const [textoPdf, pagina] = await Promise.all([textoDoPdf(conteudo).catch(() => ""), paginaDoPdfComoImagem(conteudo)]);
    const temTexto = textoPdf.replace(/\s/g, "").length >= 80;
    if (!temTexto && !pagina) return { erro: "Não deu para abrir o PDF. Envie uma foto ou o XML da nota." };
    if (pagina) {
      const url = `data:image/jpeg;base64,${Buffer.from(pagina).toString("base64")}`;
      const instrucao = temTexto
        ? `${nome} em PDF: a primeira página vai como imagem e o texto de todas as páginas vai abaixo. Use os dois; para quantidades e números, prefira o texto.\n\n${textoPdf.slice(0, TEXTO_COM_IMAGEM)}`
        : `${nome} em PDF escaneado: a primeira página vai como imagem.`;
      return perguntarAGroq([{ type: "text", text: instrucao }, { type: "image_url", image_url: { url } }], papel);
    }
    return perguntarAGroq(`Texto tirado do PDF (${nome.toLowerCase()}):\n\n${textoPdf.slice(0, TEXTO_MAXIMO)}`, papel);
  }

  if (/^image\/(jpeg|png|webp)$/.test(mime)) {
    if (conteudo.length > 14 * 1024 * 1024) return { erro: "A foto passa de 14 MB. Tire outra com menos resolução." };
    const url = `data:${mime};base64,${Buffer.from(conteudo).toString("base64")}`;
    return perguntarAGroq([{ type: "text", text: `Leia este documento: ${nome.toLowerCase()}.` }, { type: "image_url", image_url: { url } }], papel);
  }
  if (mime === "image/heic") return { erro: "Foto em HEIC (iPhone) a leitura não abre. Envie em JPEG ou o PDF." };
  return { erro: "Envie o XML da nota, o PDF ou uma foto (JPEG ou PNG)." };
}

/** O tipo do arquivo pelo conteúdo: o XML da NF-e, ou o que o dossiê reconhece. Nulo se não servir. */
export function tipoDoArquivoDeEntrada(conteudo: Uint8Array, reconhecido: { mime: string; extensao: string } | null): { mime: string; extensao: string } | null {
  if (ehXmlDeNota(conteudo)) return { mime: "application/xml", extensao: ".xml" };
  if (!reconhecido) return null;
  return /^(application\/pdf|image\/(jpeg|png|webp|heic))$/.test(reconhecido.mime) ? reconhecido : null;
}
