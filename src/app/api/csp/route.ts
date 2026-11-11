import { ipDe, lerCorpo } from "@/app-movel/http";
import { consumir, MINUTO } from "@/app-movel/limitador";

export const dynamic = "force-dynamic";

/**
 * O navegador conta o que a política de conteúdo barrou (ver `middleware.ts`).
 *
 * Serve para duas coisas: saber se a política quebrou alguma tela depois de um
 * deploy, e ficar sabendo de uma tentativa de injetar script. Cada aviso vira
 * uma linha no log do site:
 *
 *   docker compose logs site | grep '"csp"'
 *
 * Sem login (a tela de entrada também avisa) e por isso com as mesmas cautelas
 * das outras portas abertas: corpo pequeno, limite por IP e nada guardado em
 * banco. Responde 204 sempre — o navegador não faz nada com a resposta.
 */

/** Extensão do navegador de quem usa também dispara aviso; não é problema do Selebi. */
const DE_EXTENSAO = /^(chrome|moz|safari|safari-web)-extension:|^(webkit-masked-url|about|chrome):/i;

const linha = (v: unknown, maximo = 300) =>
  typeof v === "string" ? v.replace(/[\r\n\t]+/g, " ").slice(0, maximo) : "";

/** Só o caminho: o endereço inteiro pode trazer o token de um link público. */
function caminho(v: unknown): string {
  const texto = linha(v, 600);
  try {
    return new URL(texto).pathname.slice(0, 200);
  } catch {
    return texto.split("?")[0].slice(0, 200);
  }
}

export async function POST(req: Request) {
  const vazio = new Response(null, { status: 204 });
  if (!consumir(`csp:${ipDe(req)}`, 30, 10 * MINUTO).ok) return vazio;

  const bruto = await lerCorpo(req, 8_192);
  if (!bruto) return vazio;

  let dados: unknown;
  try {
    dados = JSON.parse(bruto);
  } catch {
    return vazio;
  }

  // Dois formatos: o antigo (`{"csp-report": {…}}`) e o da Reporting API (`[{body: {…}}]`).
  const item = Array.isArray(dados) ? (dados[0] as { body?: unknown } | undefined)?.body : (dados as Record<string, unknown>)?.["csp-report"];
  if (!item || typeof item !== "object") return vazio;
  const r = item as Record<string, unknown>;

  const bloqueado = linha(r["blocked-uri"] ?? r.blockedURL);
  const origem = linha(r["source-file"] ?? r.sourceFile);
  if (DE_EXTENSAO.test(bloqueado) || DE_EXTENSAO.test(origem)) return vazio;

  console.warn(
    JSON.stringify({
      csp: linha(r["effective-directive"] ?? r.effectiveDirective ?? r["violated-directive"], 80),
      bloqueado: bloqueado.startsWith("http") ? bloqueado.split("?")[0] : bloqueado,
      pagina: caminho(r["document-uri"] ?? r.documentURL),
      origem: origem.split("?")[0],
      linha: Number(r["line-number"] ?? r.lineNumber) || undefined,
      modo: linha(r.disposition, 10) || undefined,
      amostra: linha(r["script-sample"] ?? r.sample, 80) || undefined,
      quando: new Date().toISOString(),
    }),
  );
  return vazio;
}
