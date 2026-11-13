import { eq } from "drizzle-orm";

import { ipDe } from "@/app-movel/http";
import { consumir, MINUTO } from "@/app-movel/limitador";
import { db, schema } from "@/db";
import type { DadosContrato } from "@/projeto/contrato";
import { gerarContratoPdf, nomeDoContrato } from "@/projeto/contrato-pdf";

/**
 * O contrato que vai para o cliente pelo WhatsApp — sem login.
 *
 * Mesmo cuidado do relatório da OS (`/r/<token>`): a chave do link tem 192 bits
 * aleatórios, há limite por IP, e o PDF não entra em buscador nem em cache
 * compartilhado — tem nome, CPF e endereço de uma pessoa.
 */
export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const limite = consumir(`contrato:${ipDe(req)}`, 30, 10 * MINUTO);
  if (!limite.ok) {
    return new Response("Muitas tentativas. Tente de novo em alguns minutos.", {
      status: 429,
      headers: { "retry-after": String(limite.tenteEmSegundos) },
    });
  }
  const { token } = await params;
  const [achado] = /^[\w-]{20,64}$/.test(token)
    ? await db
        .select({ dados: schema.contrato.dados, logo: schema.empresa.logo })
        .from(schema.contrato)
        .innerJoin(schema.empresa, eq(schema.empresa.id, schema.contrato.empresaId))
        .where(eq(schema.contrato.token, token))
        .limit(1)
    : [];
  if (!achado) {
    return new Response("Contrato não encontrado. O link pode ter sido trocado — peça um novo à empresa.", {
      status: 404,
      headers: { "content-type": "text/plain; charset=utf-8", "x-robots-tag": "noindex" },
    });
  }
  const dados = achado.dados as DadosContrato;
  const pdf = await gerarContratoPdf(dados, achado.logo);
  return new Response(new Uint8Array(pdf), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `inline; filename="${nomeDoContrato(dados)}"`,
      "cache-control": "private, no-store",
      "x-robots-tag": "noindex, nofollow",
    },
  });
}
