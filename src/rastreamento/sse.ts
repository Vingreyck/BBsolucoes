import { assinar, type EventoCampo } from "./hub";

/**
 * O fluxo ao vivo para o mapa (Server-Sent Events).
 *
 * O SeeNet usou WebSocket porque o app dele rodava no navegador pelo Flutter,
 * que não recebia SSE. Aqui quem olha o mapa é o próprio navegador (o site) e
 * o app Android — os dois leem SSE sem biblioteca nova, e o navegador ainda
 * reconecta sozinho. O caminho de volta não existe: quem escreve é o celular,
 * por HTTP.
 *
 * Três cuidados que vieram do SeeNet:
 * - **Ping a cada 25 s.** Proxy derruba conexão parada; e o comentário `: ping`
 *   deixa o cliente saber que a linha está viva.
 * - **Vida máxima.** A conexão fecha sozinha depois de 30 min e o cliente
 *   reconecta — passando de novo pela conferência da sessão. Sessão vencida
 *   ou usuário desativado para de receber, em vez de ouvir para sempre.
 * - **Sem compressão.** Compressão segura os bytes até juntar um bloco, e a
 *   posição chegaria em rajadas (ver o Caddyfile).
 */

const PING_MS = 25_000;
const VIDA_MAXIMA_MS = 30 * 60_000;

export function fluxoDoCampo(
  req: Request,
  empresaId: string,
  filtro: (evento: EventoCampo) => boolean = () => true,
): Response {
  const codificador = new TextEncoder();
  let encerrar: () => void = () => undefined;

  const corpo = new ReadableStream<Uint8Array>({
    start(controle) {
      let fechado = false;
      const escrever = (texto: string) => {
        if (fechado) return;
        try {
          controle.enqueue(codificador.encode(texto));
        } catch {
          encerrar();
        }
      };

      const parar = assinar(empresaId, (evento) => {
        if (filtro(evento)) escrever(`event: ${evento.tipo}\ndata: ${JSON.stringify(evento)}\n\n`);
      });
      const ping = setInterval(() => escrever(": ping\n\n"), PING_MS);
      const fim = setTimeout(() => encerrar(), VIDA_MAXIMA_MS);

      encerrar = () => {
        if (fechado) return;
        fechado = true;
        parar();
        clearInterval(ping);
        clearTimeout(fim);
        try {
          controle.close();
        } catch {
          // já fechado pelo outro lado
        }
      };
      req.signal.addEventListener("abort", () => encerrar());

      // Reconectar em 5 s se cair; e o primeiro byte já sai, para o proxy
      // abrir o caminho e o cliente saber que conectou.
      escrever(`retry: 5000\nevent: pronto\ndata: {}\n\n`);
    },
    cancel() {
      encerrar();
    },
  });

  return new Response(corpo, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}
