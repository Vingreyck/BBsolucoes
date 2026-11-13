import { headers } from "next/headers";

/**
 * "https://app.selebi.com.br": o começo do link público que vai pelo WhatsApp
 * (contrato, relatório). Sai do pedido, como no relatório mensal: atrás do
 * Caddy vem em `x-forwarded-host`/`x-forwarded-proto`.
 */
export async function origemDoSite(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "";
  const protocolo = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${protocolo}://${host}`;
}
