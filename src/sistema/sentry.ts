import { randomUUID } from "node:crypto";

/**
 * Manda erros para o Sentry sem instalar o SDK dele.
 *
 * O SDK oficial (`@sentry/nextjs`) mexe no build do Next e puxa dezenas de
 * pacotes; aqui só precisamos de uma coisa — que um erro chegue ao painel, com
 * contexto. O Sentry aceita isso por um POST simples (o "envelope"), então são
 * ~60 linhas e nenhuma dependência. Sem `SENTRY_DSN` no `.env`, não faz nada.
 *
 * Nunca derruba quem chamou: erro ao reportar erro é só um aviso no log.
 */

export interface DsnSentry {
  url: string;
  chave: string;
}

/** `https://CHAVE@oXXXX.ingest.sentry.io/PROJETO` → onde postar e com qual chave. */
export function lerDsn(dsn: string | undefined): DsnSentry | null {
  if (!dsn) return null;
  try {
    const u = new URL(dsn.trim());
    const projeto = u.pathname.replace(/^\/+/, "");
    if (!u.username || !projeto) return null;
    return { url: `${u.protocol}//${u.host}/api/${projeto}/envelope/`, chave: u.username };
  } catch {
    return null;
  }
}

export interface EventoErro {
  mensagem: string;
  tipo?: string;
  pilha?: string;
  /** `node` para o servidor, `android` ou `ios` para o app. */
  plataforma: string;
  nivel?: "error" | "fatal" | "warning";
  tags?: Record<string, string>;
  extra?: Record<string, unknown>;
}

/** O corpo do envelope: três linhas JSON (cabeçalho, tipo do item, evento). */
export function montarEnvelope(dsn: DsnSentry, e: EventoErro, ambiente = "producao"): string {
  const id = randomUUID().replace(/-/g, "");
  const agora = new Date().toISOString();
  const evento = {
    event_id: id,
    timestamp: agora,
    platform: e.plataforma === "node" ? "node" : "other",
    level: e.nivel ?? "error",
    environment: ambiente,
    exception: { values: [{ type: e.tipo ?? "Error", value: e.mensagem.slice(0, 1000) }] },
    tags: { plataforma: e.plataforma, ...e.tags },
    extra: { pilha: e.pilha?.slice(0, 8000), ...e.extra },
  };
  return [
    JSON.stringify({ event_id: id, sent_at: agora }),
    JSON.stringify({ type: "event" }),
    JSON.stringify(evento),
  ].join("\n");
}

export async function enviarParaSentry(e: EventoErro): Promise<void> {
  const dsn = lerDsn(process.env.SENTRY_DSN);
  if (!dsn) return;
  try {
    await fetch(dsn.url, {
      method: "POST",
      headers: {
        "content-type": "application/x-sentry-envelope",
        "x-sentry-auth": `Sentry sentry_version=7, sentry_key=${dsn.chave}, sentry_client=selebi/1.0`,
      },
      body: montarEnvelope(dsn, e),
      signal: AbortSignal.timeout(8_000),
    });
  } catch (erro) {
    console.warn("Não consegui avisar o Sentry:", erro instanceof Error ? erro.message : erro);
  }
}
