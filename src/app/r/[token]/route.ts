import { ipDe } from "@/app-movel/http";
import { consumir, MINUTO } from "@/app-movel/limitador";
import { carregarPeloToken } from "@/os/consultas";
import { gerarRelatorio, nomeDoRelatorio } from "@/os/relatorio";

/**
 * O relatório que vai para o cliente pelo WhatsApp — sem login.
 *
 * A chave do link tem 192 bits aleatórios: adivinhar é inviável, mas o limite
 * por IP fica mesmo assim, porque gerar PDF com fotos custa servidor. O
 * relatório não entra em buscador (`noindex`) e não fica em cache
 * compartilhado: tem nome, endereço e foto da casa de uma pessoa.
 */
export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const limite = consumir(`relatorio:${ipDe(req)}`, 30, 10 * MINUTO);
  if (!limite.ok) {
    return new Response("Muitas tentativas. Tente de novo em alguns minutos.", {
      status: 429,
      headers: { "retry-after": String(limite.tenteEmSegundos) },
    });
  }
  const { token } = await params;
  const os = await carregarPeloToken(token);
  if (!os) {
    return new Response("Relatório não encontrado. O link pode ter sido trocado — peça um novo à empresa.", {
      status: 404,
      headers: { "content-type": "text/plain; charset=utf-8", "x-robots-tag": "noindex" },
    });
  }
  const pdf = await gerarRelatorio(os);
  return new Response(new Uint8Array(pdf), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `inline; filename="${nomeDoRelatorio(os)}"`,
      "cache-control": "private, no-store",
      "x-robots-tag": "noindex, nofollow",
    },
  });
}
