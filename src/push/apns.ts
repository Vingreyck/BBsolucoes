import { sign } from "node:crypto";
import { readFileSync } from "node:fs";
import { connect } from "node:http2";

import type { Aviso, ResultadoEnvio } from "./fcm";

/**
 * Manda push para o iPhone direto pelo APNs (o serviço de avisos da Apple),
 * sem Firebase no iPhone: o app só pede o token à Apple e o servidor fala com
 * ela. Menos uma biblioteca no app do iPhone, e o mesmo jeito do FCM — um JWT
 * assinado e um POST.
 *
 * A chave (`.p8`, criada em developer.apple.com > Keys, com "Apple Push
 * Notifications service" marcado) fica fora do git, em `estado/apns-chave.p8`
 * (ou `APNS_CHAVE`). Junto, no `.env`: `APNS_KEY_ID` (o id da chave) e
 * `APNS_TEAM_ID` (o da conta). Faltou algo: o iPhone fica sem aviso, e nada quebra.
 */

interface ConfigApns {
  chave: string;
  keyId: string;
  teamId: string;
  topico: string;
  servidor: string;
}

let config: ConfigApns | null | undefined;
let jwt: { valor: string; criadoEm: number } | null = null;

export function configApns(): ConfigApns | null {
  if (config !== undefined) return config;
  const keyId = process.env.APNS_KEY_ID?.trim();
  const teamId = process.env.APNS_TEAM_ID?.trim();
  try {
    const chave = readFileSync(process.env.APNS_CHAVE || "estado/apns-chave.p8", "utf8");
    config =
      keyId && teamId && chave.includes("PRIVATE KEY")
        ? {
            chave,
            keyId,
            teamId,
            topico: process.env.APNS_TOPICO?.trim() || "br.com.selebi.app",
            // O app do TestFlight e da App Store usa o servidor de produção.
            servidor: process.env.APNS_SANDBOX === "1" ? "https://api.sandbox.push.apple.com" : "https://api.push.apple.com",
          }
        : null;
  } catch {
    config = null;
  }
  return config;
}

const base64url = (b: Buffer | string) => Buffer.from(b).toString("base64url");

/** O JWT da Apple: ES256, com a assinatura no formato cru (r‖s), e não DER. */
export function montarJwtApns(c: Pick<ConfigApns, "chave" | "keyId" | "teamId">, agora = Date.now()): string {
  const cabecalho = base64url(JSON.stringify({ alg: "ES256", kid: c.keyId }));
  const corpo = base64url(JSON.stringify({ iss: c.teamId, iat: Math.floor(agora / 1000) }));
  const assinatura = sign("sha256", Buffer.from(`${cabecalho}.${corpo}`), { key: c.chave, dsaEncoding: "ieee-p1363" });
  return `${cabecalho}.${corpo}.${base64url(assinatura)}`;
}

/** A Apple recusa token novo a cada envio e o antigo depois de 1 h: renova a cada 50 min. */
function jwtAtual(c: ConfigApns): string {
  if (!jwt || Date.now() - jwt.criadoEm > 50 * 60_000) jwt = { valor: montarJwtApns(c), criadoEm: Date.now() };
  return jwt.valor;
}

/** O corpo que o APNs espera: o texto em `aps`, os dados (o `osId`) ao lado. */
export function montarCorpoApns(a: Aviso): string {
  return JSON.stringify({ aps: { alert: { title: a.titulo, body: a.corpo }, sound: "default" }, ...a.dados });
}

/** Token que a Apple diz não existir mais (app apagado, ou de outro ambiente). */
export function tokenMorto(status: number, motivo: string | undefined): boolean {
  return status === 410 || (status === 400 && (motivo === "BadDeviceToken" || motivo === "DeviceTokenNotForTopic"));
}

export async function enviarApns(token: string, aviso: Aviso): Promise<ResultadoEnvio> {
  const c = configApns();
  if (!c) return "falhou";
  try {
    const { status, corpo } = await new Promise<{ status: number; corpo: string }>((resolver, rejeitar) => {
      const sessao = connect(c.servidor);
      sessao.on("error", rejeitar);
      const pedido = sessao.request({
        ":method": "POST",
        ":path": `/3/device/${token}`,
        authorization: `bearer ${jwtAtual(c)}`,
        "apns-topic": c.topico,
        "apns-push-type": "alert",
        "apns-priority": "10",
        "content-type": "application/json",
      });
      let status = 0;
      let corpo = "";
      pedido.setTimeout(10_000, () => pedido.close());
      pedido.on("response", (h) => (status = Number(h[":status"])));
      pedido.on("data", (parte) => (corpo += parte));
      pedido.on("end", () => {
        sessao.close();
        resolver({ status, corpo });
      });
      pedido.on("error", (e) => {
        sessao.close();
        rejeitar(e);
      });
      pedido.end(montarCorpoApns(aviso));
    });
    if (status === 200) return "enviado";
    const motivo = corpo ? (JSON.parse(corpo) as { reason?: string }).reason : undefined;
    if (tokenMorto(status, motivo)) return "token_invalido";
    console.warn(`[push] APNs respondeu ${status}: ${motivo ?? corpo.slice(0, 200)}`);
    return "falhou";
  } catch (e) {
    console.warn("[push] não consegui falar com o APNs:", e instanceof Error ? e.message : e);
    return "falhou";
  }
}
