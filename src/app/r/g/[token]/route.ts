import { ipDe } from "@/app-movel/http";
import { consumir, MINUTO } from "@/app-movel/limitador";
import { relatorioPeloToken } from "@/geracao/dados";
import { gerarRelatorioGeracao } from "@/geracao/pdf";
import { nomeDoArquivo } from "@/geracao/relatorio-mensal";

/**
 * O relatório mensal de geração que vai para o cliente pelo WhatsApp — sem
 * login, como o relatório da OS (`/r/<chave>`), e com as mesmas cautelas:
 * chave de 192 bits, limite por IP, fora de buscador e de cache compartilhado.
 */
export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const limite = consumir(`relatorio-geracao:${ipDe(req)}`, 30, 10 * MINUTO);
  if (!limite.ok) {
    return new Response("Muitas tentativas. Tente de novo em alguns minutos.", {
      status: 429,
      headers: { "retry-after": String(limite.tenteEmSegundos) },
    });
  }
  const { token } = await params;
  const dados = await relatorioPeloToken(token);
  if (!dados) {
    return new Response("Relatório não encontrado. Peça um novo link à empresa.", {
      status: 404,
      headers: { "content-type": "text/plain; charset=utf-8", "x-robots-tag": "noindex" },
    });
  }
  const pdf = await gerarRelatorioGeracao(dados);
  return new Response(new Uint8Array(pdf), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `inline; filename="${nomeDoArquivo(dados.mes, dados.cliente)}"`,
      "cache-control": "private, no-store",
      "x-robots-tag": "noindex, nofollow",
    },
  });
}
