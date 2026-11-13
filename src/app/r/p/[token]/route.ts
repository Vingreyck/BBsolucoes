import { eq } from "drizzle-orm";

import { ipDe } from "@/app-movel/http";
import { consumir, MINUTO } from "@/app-movel/limitador";
import { db, schema } from "@/db";
import type { DadosProposta } from "@/proposta/proposta";
import { nomeDaProposta } from "@/proposta/proposta";
import { gerarPropostaPdf } from "@/proposta/proposta-pdf";

/**
 * A proposta comercial que vai para o cliente pelo WhatsApp — sem login.
 *
 * Mesmo cuidado do contrato (`/r/c/<token>`): a chave do link tem 192 bits
 * aleatórios, há limite por IP, e o PDF não entra em buscador nem em cache
 * compartilhado — tem nome, cidade e valores de uma pessoa.
 */
export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const limite = consumir(`proposta:${ipDe(req)}`, 30, 10 * MINUTO);
  if (!limite.ok) {
    return new Response("Muitas tentativas. Tente de novo em alguns minutos.", {
      status: 429,
      headers: { "retry-after": String(limite.tenteEmSegundos) },
    });
  }
  const { token } = await params;
  const [achado] = /^[\w-]{20,64}$/.test(token)
    ? await db
        .select({ dados: schema.proposta.dados, logo: schema.empresa.logo, capa: schema.empresa.propostaCapa })
        .from(schema.proposta)
        .innerJoin(schema.empresa, eq(schema.empresa.id, schema.proposta.empresaId))
        .where(eq(schema.proposta.token, token))
        .limit(1)
    : [];
  if (!achado) {
    return new Response("Proposta não encontrada. O link pode ter sido trocado — peça um novo à empresa.", {
      status: 404,
      headers: { "content-type": "text/plain; charset=utf-8", "x-robots-tag": "noindex" },
    });
  }
  const dados = achado.dados as DadosProposta;
  const pdf = await gerarPropostaPdf(dados, { logo: achado.logo, capa: achado.capa });
  const nome = nomeDaProposta(dados).normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\w .-]/g, "");
  return new Response(new Uint8Array(pdf), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `inline; filename="${nome}"`,
      "cache-control": "private, no-store",
      "x-robots-tag": "noindex, nofollow",
    },
  });
}
