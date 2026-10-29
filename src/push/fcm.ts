import { createSign } from "node:crypto";
import { readFileSync } from "node:fs";

/**
 * Manda push pelo Firebase Cloud Messaging (API HTTP v1) sem instalar o SDK do
 * Firebase — mesmo raciocínio do Sentry: são duas chamadas HTTP, e o SDK puxaria
 * dezenas de pacotes.
 *
 * A conta de serviço (o `.json` baixado do console do Firebase) fica num arquivo
 * fora do git, apontado por `FIREBASE_CHAVE` (padrão: `estado/firebase-chave.json`,
 * pasta que o `site` já enxerga). Sem o arquivo, nada é enviado e nada quebra.
 */

interface ContaServico {
  project_id: string;
  client_email: string;
  private_key: string;
}

const ESCOPO = "https://www.googleapis.com/auth/firebase.messaging";

let conta: ContaServico | null | undefined;
let acesso: { token: string; venceEm: number } | null = null;

export function contaDeServico(): ContaServico | null {
  if (conta !== undefined) return conta;
  const caminho = process.env.FIREBASE_CHAVE || "estado/firebase-chave.json";
  try {
    const lida = JSON.parse(readFileSync(caminho, "utf8")) as Partial<ContaServico>;
    conta =
      lida.project_id && lida.client_email && lida.private_key
        ? { project_id: lida.project_id, client_email: lida.client_email, private_key: lida.private_key }
        : null;
  } catch {
    conta = null;
  }
  return conta;
}

export function pushConfigurado(): boolean {
  return contaDeServico() !== null;
}

const base64url = (b: Buffer | string) => Buffer.from(b).toString("base64url");

/** O JWT que a Google troca por um token de acesso (válido por 1 hora). */
export function montarAssertiva(c: Pick<ContaServico, "client_email" | "private_key">, agora = Date.now()): string {
  const cabecalho = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const corpo = base64url(
    JSON.stringify({
      iss: c.client_email,
      scope: ESCOPO,
      aud: "https://oauth2.googleapis.com/token",
      iat: Math.floor(agora / 1000),
      exp: Math.floor(agora / 1000) + 3600,
    }),
  );
  const assinatura = createSign("RSA-SHA256").update(`${cabecalho}.${corpo}`).sign(c.private_key);
  return `${cabecalho}.${corpo}.${base64url(assinatura)}`;
}

async function tokenDeAcesso(c: ContaServico): Promise<string> {
  if (acesso && acesso.venceEm > Date.now() + 60_000) return acesso.token;
  const resposta = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: montarAssertiva(c),
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!resposta.ok) throw new Error(`Google recusou a chave do Firebase (${resposta.status}).`);
  const dados = (await resposta.json()) as { access_token: string; expires_in: number };
  acesso = { token: dados.access_token, venceEm: Date.now() + dados.expires_in * 1000 };
  return acesso.token;
}

export interface Aviso {
  titulo: string;
  corpo: string;
  /** Vai junto: o app usa para abrir a OS ao tocar. */
  dados?: Record<string, string>;
}

/** O corpo que o FCM espera. Alta prioridade é o que fura a economia de bateria. */
export function montarMensagem(token: string, a: Aviso) {
  return {
    message: {
      token,
      notification: { title: a.titulo, body: a.corpo },
      data: a.dados ?? {},
      android: {
        priority: "HIGH",
        notification: { channel_id: "ordens", sound: "default" },
      },
      apns: { headers: { "apns-priority": "10" }, payload: { aps: { sound: "default" } } },
    },
  };
}

export type ResultadoEnvio = "enviado" | "token_invalido" | "falhou";

/** `token_invalido`: o app foi desinstalado ou o token trocou — pode apagar. */
export async function enviarPush(token: string, aviso: Aviso): Promise<ResultadoEnvio> {
  const c = contaDeServico();
  if (!c) return "falhou";
  try {
    const resposta = await fetch(`https://fcm.googleapis.com/v1/projects/${c.project_id}/messages:send`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${await tokenDeAcesso(c)}`,
      },
      body: JSON.stringify(montarMensagem(token, aviso)),
      signal: AbortSignal.timeout(10_000),
    });
    if (resposta.ok) return "enviado";
    const texto = await resposta.text();
    if (resposta.status === 404 || /UNREGISTERED|INVALID_ARGUMENT/.test(texto)) return "token_invalido";
    console.warn(`[push] FCM respondeu ${resposta.status}: ${texto.slice(0, 300)}`);
    return "falhou";
  } catch (e) {
    console.warn("[push] não consegui falar com o FCM:", e instanceof Error ? e.message : e);
    return "falhou";
  }
}
