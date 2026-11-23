/**
 * Lê a conta de luz (foto ou PDF) com um modelo da Groq (plano gratuito) e
 * devolve o que a proposta precisa: o histórico de consumo de cada mês, o
 * número da unidade, a classe, a ligação, a distribuidora e a tarifa que a
 * conta cobra.
 *
 * Liga com `GROQ_API_KEY` no `.env` (chave em console.groq.com → API Keys).
 * Sem a chave, a tela diz como ligar e o consumo se digita.
 *
 * - **Foto**: vai como imagem para o modelo de visão.
 * - **PDF**: a Groq não aceita PDF. A primeira página é desenhada como imagem
 *   (`unpdf` + `@napi-rs/canvas`) e vai junto com o texto tirado do PDF: a
 *   imagem pega o gráfico do histórico e o PDF escaneado; o texto dá os
 *   números exatos da segunda via. Se o servidor não conseguir desenhar, vai
 *   só o texto; sem texto e sem imagem, a tela pede a foto.
 *
 * O modelo padrão é o de visão da Groq em 23/11/2026. A Groq aposenta modelos
 * com frequência (console.groq.com/docs/deprecations): quando isso acontecer,
 * `GROQ_MODELO` no `.env` troca sem mexer no código.
 *
 * A conta tem dado pessoal (nome, endereço): vai para a Groq só nesta
 * chamada, e o Selebi guarda apenas o que vira campo da proposta.
 */

import { z } from "zod";

import type { ContaDeLuzLida } from "./assistente";

const ENDERECO = "https://api.groq.com/openai/v1/chat/completions";
const MODELO_PADRAO = "qwen/qwen3.8-27b";
const ESPERA_MS = 60_000;
/**
 * Texto de PDF além disto é boleto e propaganda. E o plano gratuito conta uns
 * 8 mil tokens por minuto: a imagem vale ~2 mil, então com ela vai menos texto.
 */
const TEXTO_MAXIMO = 12_000;
const TEXTO_COM_IMAGEM = 6_000;
/** Largura da página desenhada: a letra miúda da conta continua legível. */
const LARGURA_DA_PAGINA = 1_600;

const Conta = z.object({
  legivel: z.boolean(),
  distribuidora: z.string().nullable(),
  numeroUc: z.string().nullable(),
  titular: z.string().nullable(),
  cidade: z.string().nullable(),
  classe: z.enum(["residencial", "rural", "comercial", "industrial", "outra"]).nullable(),
  ligacao: z.enum(["monofasico", "bifasico", "trifasico"]).nullable(),
  mesReferencia: z.string().nullable(),
  historico: z.array(z.object({ mes: z.string(), kwh: z.number() })),
  tarifaComImpostos: z.number().nullable(),
  valorTotal: z.number().nullable(),
  observacao: z.string().nullable(),
});

const texto = (descricao: string) => ({ type: ["string", "null"], description: descricao });
const numero = (descricao: string) => ({ type: ["number", "null"], description: descricao });

/** O mesmo formato, em JSON Schema no modo estrito da Groq: tudo obrigatório, nulo onde falta. */
const ESQUEMA = {
  type: "object",
  additionalProperties: false,
  required: Object.keys(Conta.shape),
  properties: {
    legivel: { type: "boolean", description: "É uma conta de energia e dá para ler os números." },
    distribuidora: texto("Nome da distribuidora, como na conta (ex.: Energisa Sergipe, Sulgipe)."),
    numeroUc: texto("Número da unidade consumidora / código da instalação."),
    titular: texto("Nome do titular."),
    cidade: texto("Cidade do endereço da instalação."),
    classe: { anyOf: [{ type: "string", enum: ["residencial", "rural", "comercial", "industrial", "outra"] }, { type: "null" }] },
    ligacao: { anyOf: [{ type: "string", enum: ["monofasico", "bifasico", "trifasico"] }, { type: "null" }] },
    mesReferencia: texto("Mês de referência da conta, AAAA-MM."),
    historico: {
      type: "array",
      description: "O histórico de consumo (os últimos meses), um item por mês, incluindo o mês de referência.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["mes", "kwh"],
        properties: { mes: { type: "string", description: "AAAA-MM" }, kwh: { type: "number" } },
      },
    },
    tarifaComImpostos: numero("Preço por kWh com tributos (R$/kWh), se a conta mostrar."),
    valorTotal: numero("Valor total a pagar (R$)."),
    observacao: texto("O que atrapalhou a leitura, em uma frase."),
  },
};

const PEDIDO =
  "Você lê contas de energia elétrica do Brasil e devolve só um JSON com os campos pedidos. " +
  "O histórico de consumo costuma estar num gráfico de barras ou numa tabela com os meses (ex.: OUT/26 512). " +
  "Use só o que está escrito na conta: campo que não aparece fica null, e o histórico só com os meses que dá para ler. " +
  "Meses no formato AAAA-MM; kWh e valores como número (ponto decimal). " +
  "classe: residencial, rural, comercial, industrial ou outra. ligacao: monofasico, bifasico ou trifasico.";

/** Para o modo JSON simples (sem esquema), o formato vai escrito no pedido. */
const PEDIDO_COM_FORMATO = `${PEDIDO}\nFormato: {"legivel": bool, "distribuidora": str|null, "numeroUc": str|null, "titular": str|null, "cidade": str|null, "classe": str|null, "ligacao": str|null, "mesReferencia": "AAAA-MM"|null, "historico": [{"mes": "AAAA-MM", "kwh": num}], "tarifaComImpostos": num|null, "valorTotal": num|null, "observacao": str|null}`;

export function leituraDeContaLigada(): boolean {
  return Boolean(process.env.GROQ_API_KEY?.trim());
}

const MESES_ABREV = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

/**
 * "2026-10", "10/2026", "OUT/26", "out/2026", "outubro de 2026" → "2026-10".
 * O modelo às vezes devolve o mês como está escrito na conta. Nulo se não for mês.
 */
export function mesDaConta(t: string): string | null {
  const s = t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
  let m = s.match(/^(\d{4})-(\d{1,2})$/);
  if (m) return valido(Number(m[1]), Number(m[2]));
  m = s.match(/^(\d{1,2})[/.-](\d{2}|\d{4})$/);
  if (m) return valido(ano(m[2]), Number(m[1]));
  m = s.match(/^([a-z]{3})[a-z]*\.?(?:\s*(?:\/|-|de)?\s*)(\d{2}|\d{4})$/);
  if (m) {
    const i = MESES_ABREV.indexOf(m[1]);
    return i < 0 ? null : valido(ano(m[2]), i + 1);
  }
  return null;
}
const ano = (a: string) => (a.length === 2 ? 2000 + Number(a) : Number(a));
const valido = (a: number, mes: number) => (a >= 2000 && a <= 2100 && mes >= 1 && mes <= 12 ? `${a}-${String(mes).padStart(2, "0")}` : null);

/** A resposta da Groq (o texto do JSON) vira a conta lida, ou o motivo de não dar. */
export function contaDaResposta(conteudo: string): { conta: ContaDeLuzLida } | { erro: string } {
  let bruto: unknown;
  try {
    bruto = JSON.parse(conteudo.replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, ""));
  } catch {
    return { erro: "Não deu para ler a conta. Digite o consumo à mão." };
  }
  const lido = Conta.safeParse(bruto);
  if (!lido.success) return { erro: "Não deu para ler a conta. Digite o consumo à mão." };
  const c = lido.data;
  if (!c.legivel) return { erro: c.observacao ? `Não deu para ler a conta: ${c.observacao}` : "A imagem não parece uma conta legível." };
  const historico: ContaDeLuzLida["historico"] = [];
  for (const h of c.historico) {
    const mes = mesDaConta(h.mes);
    if (mes && Number.isFinite(h.kwh) && h.kwh >= 0 && h.kwh < 1_000_000) historico.push({ mes, kwh: h.kwh });
  }
  return {
    conta: {
      distribuidora: c.distribuidora,
      numeroUc: c.numeroUc?.replace(/\D/g, "") || null,
      titular: c.titular,
      cidade: c.cidade,
      classe: c.classe,
      ligacao: c.ligacao,
      mesReferencia: c.mesReferencia ? mesDaConta(c.mesReferencia) : null,
      historico,
      tarifaComImpostos: c.tarifaComImpostos !== null && c.tarifaComImpostos > 0 && c.tarifaComImpostos < 10 ? c.tarifaComImpostos : null,
      valorTotal: c.valorTotal,
      observacao: c.observacao,
    },
  };
}

/** O texto do PDF, junto e sem espaço sobrando. Vazio se o PDF for só imagem. */
export async function textoDoPdf(conteudo: Uint8Array): Promise<string> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  // Cópia: o pdf.js pode tomar o buffer para si.
  const pdf = await getDocumentProxy(new Uint8Array(conteudo));
  const { text } = await extractText(pdf, { mergePages: true });
  return text.replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();
}

/**
 * A primeira página do PDF como JPEG, com uns 1.600 px de largura e fundo
 * branco. Nulo se não der para desenhar (o servidor sem o canvas, PDF
 * quebrado): quem chama segue só com o texto.
 */
export async function paginaDoPdfComoImagem(conteudo: Uint8Array): Promise<Uint8Array | null> {
  try {
    const { getDocumentProxy, renderPageAsImage } = await import("unpdf");
    const canvas = await import("@napi-rs/canvas");
    const pdf = await getDocumentProxy(new Uint8Array(conteudo));
    const largura = (await pdf.getPage(1)).getViewport({ scale: 1 }).width;
    const escala = Math.min(4, Math.max(1, LARGURA_DA_PAGINA / Math.max(1, largura)));
    const png = await renderPageAsImage(pdf, 1, { canvasImport: () => import("@napi-rs/canvas"), scale: escala });
    const imagem = await canvas.loadImage(Buffer.from(png));
    const tela = canvas.createCanvas(imagem.width, imagem.height);
    const ctx = tela.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, imagem.width, imagem.height);
    ctx.drawImage(imagem, 0, 0);
    return new Uint8Array(await tela.encode("jpeg", 85));
  } catch {
    return null;
  }
}

type Mensagem = { role: "system" | "user"; content: string | ({ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } })[] };

/** Um pedido à Groq. `estrito` usa o esquema; sem ele, o modo JSON simples (para modelo que não aceite o esquema). */
async function pedir(chave: string, modelo: string, usuario: Mensagem, estrito: boolean): Promise<Response> {
  const corpo: Record<string, unknown> = {
    model: modelo,
    messages: [{ role: "system", content: estrito ? PEDIDO : PEDIDO_COM_FORMATO }, usuario],
    temperature: 0,
    max_completion_tokens: 1500,
    response_format: estrito ? { type: "json_schema", json_schema: { name: "conta_de_luz", strict: true, schema: ESQUEMA } } : { type: "json_object" },
  };
  // Modelo que pensa antes (o Qwen): sem pensar, que a conta é só leitura; e o
  // pensamento nunca no texto, que o modo JSON recusa.
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

/** Lê a conta. Erro em palavras para a tela quando não dá. */
export async function lerContaDeLuz(conteudo: Uint8Array, mime: string): Promise<{ conta: ContaDeLuzLida } | { erro: string }> {
  const chave = process.env.GROQ_API_KEY?.trim();
  if (!chave) return { erro: "A leitura da conta não está ligada: falta GROQ_API_KEY no .env do servidor." };
  const modelo = process.env.GROQ_MODELO?.trim() || MODELO_PADRAO;

  let usuario: Mensagem;
  if (mime === "application/pdf") {
    const [textoPdf, pagina] = await Promise.all([textoDoPdf(conteudo).catch(() => ""), paginaDoPdfComoImagem(conteudo)]);
    const temTexto = textoPdf.replace(/\s/g, "").length >= 80;
    if (!temTexto && !pagina) return { erro: "Não deu para abrir o PDF. Envie uma foto da conta." };
    if (pagina) {
      const url = `data:image/jpeg;base64,${Buffer.from(pagina).toString("base64")}`;
      const instrucao = temTexto
        ? `Conta de energia em PDF: a primeira página vai como imagem e o texto tirado do PDF vai abaixo. Use os dois; para os números, prefira o texto.\n\n${textoPdf.slice(0, TEXTO_COM_IMAGEM)}`
        : "Conta de energia em PDF escaneado: a primeira página vai como imagem. Leia esta conta.";
      usuario = { role: "user", content: [{ type: "text", text: instrucao }, { type: "image_url", image_url: { url } }] };
    } else {
      usuario = { role: "user", content: `Texto tirado do PDF da conta de energia:\n\n${textoPdf.slice(0, TEXTO_MAXIMO)}` };
    }
  } else if (/^image\/(jpeg|png|webp|gif)$/.test(mime)) {
    if (conteudo.length > 14 * 1024 * 1024) return { erro: "A foto passa de 14 MB. Envie por aqui, que o navegador diminui a foto." };
    const url = `data:${mime};base64,${Buffer.from(conteudo).toString("base64")}`;
    usuario = { role: "user", content: [{ type: "text", text: "Leia esta conta de energia." }, { type: "image_url", image_url: { url } }] };
  } else {
    return { erro: "A conta precisa ser foto (JPEG, PNG) ou PDF." };
  }

  try {
    let resposta = await pedir(chave, modelo, usuario, true);
    // Modelo trocado por um que não aceita o esquema ou o "sem pensar": tenta o modo JSON simples.
    if (resposta.status === 400) resposta = await pedir(chave, modelo, usuario, false);
    if (resposta.status === 401 || resposta.status === 403) return { erro: "A chave GROQ_API_KEY foi recusada. Confira no .env." };
    if (resposta.status === 429) return { erro: "A Groq limitou as leituras agora (plano gratuito). Tente de novo em um minuto." };
    if (resposta.status === 413) return { erro: "A conta é grande demais para a leitura. Envie uma foto." };
    if (resposta.status === 404) return { erro: `O modelo ${modelo} não existe mais na Groq: troque GROQ_MODELO no .env.` };
    if (!resposta.ok) return { erro: `A leitura falhou (erro ${resposta.status} da Groq). Tente de novo.` };
    const dados = (await resposta.json()) as { choices?: { message?: { content?: string | null } }[] };
    const conteudoDaResposta = dados.choices?.[0]?.message?.content;
    if (!conteudoDaResposta) return { erro: "A Groq não devolveu a leitura. Digite o consumo à mão." };
    return contaDaResposta(conteudoDaResposta);
  } catch (e) {
    if (e instanceof Error && e.name === "TimeoutError") return { erro: "A Groq demorou demais para responder. Tente de novo." };
    return { erro: "Sem conexão com a Groq. Tente de novo." };
  }
}
