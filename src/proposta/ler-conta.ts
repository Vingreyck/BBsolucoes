/**
 * Lê a conta de luz (foto ou PDF) com o Claude e devolve o que a proposta
 * precisa: o histórico de consumo de cada mês, o número da unidade, a classe,
 * a ligação, a distribuidora e a tarifa que a conta cobra.
 *
 * Liga com `ANTHROPIC_API_KEY` no `.env`. Sem a chave, a tela mostra como ligar
 * e o resto da proposta funciona igual (o consumo se digita).
 *
 * A conta tem dado pessoal (nome, endereço): vai só para a API da Anthropic,
 * nesta chamada, e nada dela é guardado além do que vira campo da proposta.
 */

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";

import type { ContaDeLuzLida } from "./assistente";

const Conta = z.object({
  legivel: z.boolean().describe("A imagem é de uma conta de energia e dá para ler os números."),
  distribuidora: z.string().nullable().describe("Nome da distribuidora, como na conta (ex.: Energisa Sergipe, Sulgipe)."),
  numeroUc: z.string().nullable().describe("Número da unidade consumidora / código da instalação, só dígitos."),
  titular: z.string().nullable(),
  cidade: z.string().nullable().describe("Cidade do endereço da instalação."),
  classe: z.enum(["residencial", "rural", "comercial", "industrial", "outra"]).nullable(),
  ligacao: z.enum(["monofasico", "bifasico", "trifasico"]).nullable().describe("Tipo de fornecimento/ligação."),
  mesReferencia: z.string().nullable().describe("Mês de referência da conta, no formato AAAA-MM."),
  historico: z
    .array(z.object({ mes: z.string().describe("AAAA-MM"), kwh: z.number() }))
    .describe("O histórico de consumo da conta (os últimos meses), um item por mês, incluindo o mês de referência."),
  tarifaComImpostos: z.number().nullable().describe("Preço por kWh com tributos (R$/kWh), se a conta mostrar."),
  valorTotal: z.number().nullable().describe("Valor total a pagar (R$)."),
  observacao: z.string().nullable().describe("Algo que atrapalhou a leitura, em uma frase."),
});

const PEDIDO =
  "Esta é uma conta de energia elétrica do Brasil (foto ou PDF). Leia e devolva os campos pedidos. " +
  "O histórico de consumo costuma estar num gráfico de barras ou numa tabela com os meses (ex.: OUT/26 512). " +
  "Use só o que está escrito na conta: campo que não aparece fica nulo, e o histórico só com os meses que dá para ler. " +
  "Meses no formato AAAA-MM; kWh como número.";

export function leituraDeContaLigada(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY?.trim());
}

const TIPOS_DE_IMAGEM = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;
type TipoDeImagem = (typeof TIPOS_DE_IMAGEM)[number];

/** Lê a conta. Erro em palavras para a tela quando não dá. */
export async function lerContaDeLuz(conteudo: Uint8Array, mime: string): Promise<{ conta: ContaDeLuzLida } | { erro: string }> {
  if (!leituraDeContaLigada()) return { erro: "A leitura da conta não está ligada: falta ANTHROPIC_API_KEY no .env do servidor." };
  const dados = Buffer.from(conteudo).toString("base64");
  let arquivo: Anthropic.ContentBlockParam;
  if (mime === "application/pdf") {
    arquivo = { type: "document", source: { type: "base64", media_type: "application/pdf", data: dados } };
  } else if ((TIPOS_DE_IMAGEM as readonly string[]).includes(mime)) {
    arquivo = { type: "image", source: { type: "base64", media_type: mime as TipoDeImagem, data: dados } };
  } else {
    return { erro: "A conta precisa ser foto (JPEG, PNG) ou PDF." };
  }

  const client = new Anthropic();
  try {
    const resposta = await client.messages.parse({
      model: "claude-opus-5-5",
      max_tokens: 16000,
      output_config: { effort: "medium", format: zodOutputFormat(Conta) },
      messages: [{ role: "user", content: [arquivo, { type: "text", text: PEDIDO }] }],
    });
    if (resposta.stop_reason === "refusal") return { erro: "A leitura foi recusada. Digite o consumo à mão." };
    const lido = resposta.parsed_output;
    if (!lido) return { erro: "Não deu para ler a conta. Digite o consumo à mão." };
    if (!lido.legivel) return { erro: lido.observacao ? `Não deu para ler a conta: ${lido.observacao}` : "A imagem não parece uma conta legível." };
    return {
      conta: {
        distribuidora: lido.distribuidora,
        numeroUc: lido.numeroUc?.replace(/\D/g, "") || null,
        titular: lido.titular,
        cidade: lido.cidade,
        classe: lido.classe,
        ligacao: lido.ligacao,
        mesReferencia: lido.mesReferencia,
        historico: lido.historico.filter((h) => /^\d{4}-\d{2}$/.test(h.mes) && h.kwh >= 0 && h.kwh < 1_000_000),
        tarifaComImpostos: lido.tarifaComImpostos,
        valorTotal: lido.valorTotal,
        observacao: lido.observacao,
      },
    };
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) return { erro: "A chave ANTHROPIC_API_KEY foi recusada. Confira no .env." };
    if (e instanceof Anthropic.RateLimitError) return { erro: "Muitas leituras agora. Tente de novo em um minuto." };
    if (e instanceof Anthropic.BadRequestError) return { erro: "A conta não foi aceita (arquivo grande demais ou ilegível)." };
    if (e instanceof Anthropic.APIError) return { erro: `A leitura falhou (erro ${e.status}). Tente de novo.` };
    return { erro: "Sem conexão com a leitura da conta. Tente de novo." };
  }
}
