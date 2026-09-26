/**
 * O formato das respostas da API do app.
 *
 * Todo erro tem a mesma cara: `{ erro, mensagem }`. `erro` é um código estável
 * que o app usa para decidir o que fazer ("aguardando_aprovacao" leva para uma
 * tela, "credenciais" só mostra aviso); `mensagem` é o texto em português para
 * mostrar quando o app não tiver nada mais específico a dizer.
 *
 * Mudar um código de erro quebra o app que já está instalado no celular das
 * pessoas. Acrescentar pode; renomear, não.
 */

export function json(dados: unknown, status = 200, cabecalhos?: HeadersInit): Response {
  return Response.json(dados, {
    status,
    headers: { "cache-control": "no-store", ...cabecalhos },
  });
}

export function falha(
  status: number,
  erro: string,
  mensagem: string,
  extra?: Record<string, unknown>,
): Response {
  return json({ erro, mensagem, ...extra }, status);
}

export function semConteudo(): Response {
  return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
}

export function muitasTentativas(segundos: number): Response {
  return json(
    {
      erro: "muitas_tentativas",
      mensagem: `Muitas tentativas seguidas. Tente de novo em ${Math.max(1, Math.ceil(segundos / 60))} min.`,
    },
    429,
    { "retry-after": String(segundos) },
  );
}

/**
 * Corpo JSON da requisição, ou null se não for um objeto JSON.
 *
 * Tem teto de tamanho: nenhum formulário do app passa de alguns kilobytes, e
 * aceitar corpo sem limite é deixar qualquer um ocupar a memória do servidor.
 */
export async function lerJson(
  req: Request,
  limiteBytes = 16_384,
): Promise<Record<string, unknown> | null> {
  const declarado = Number(req.headers.get("content-length") ?? 0);
  if (declarado > limiteBytes) return null;

  let bruto: string;
  try {
    bruto = await req.text();
  } catch {
    return null;
  }
  if (bruto.length > limiteBytes) return null;

  try {
    const dados: unknown = JSON.parse(bruto);
    return dados && typeof dados === "object" && !Array.isArray(dados)
      ? (dados as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** Texto do corpo, aparado e com teto de tamanho. Qualquer outra coisa vira "". */
export function texto(valor: unknown, maximo = 500): string {
  return typeof valor === "string" ? valor.trim().slice(0, maximo) : "";
}

/**
 * IP de quem chama.
 *
 * Em produção só o Caddy fala com o Next, e o Caddy escreve o IP real do
 * cliente no `x-forwarded-for` — ele não confia no valor que chega de fora sem
 * `trusted_proxies` configurado. Em desenvolvimento o cabeçalho não existe.
 */
export function ipDe(req: Request): string {
  const encaminhado = req.headers.get("x-forwarded-for");
  if (encaminhado) return encaminhado.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "local";
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Id que não é UUID nem chega ao banco — o Postgres responderia com erro 500. */
export function ehUuid(valor: string): boolean {
  return UUID.test(valor);
}
