import { falha } from "./http";

/**
 * A versão mínima do app.
 *
 * O servidor muda (a vistoria passou a exigir observação, por exemplo) e o app
 * instalado no celular de um técnico não muda sozinho. Sem isto, quem não
 * atualizou toma um erro sem explicação na hora de concluir uma OS, na casa do
 * cliente. Com isto, o servidor responde 426 ("atualize") e o app diz o que fazer.
 *
 * O app manda o número do build em `X-App-Build` e o sistema em `X-App-Plataforma`
 * (`android` ou `ios`). Versões antigas não mandam nada — chegam como build 0, e é
 * isso que as barra quando um mínimo é definido. Os mínimos ficam no `.env`:
 *
 *   APP_BUILD_MINIMO_ANDROID=6
 *   APP_BUILD_MINIMO_IOS=4
 *
 * Sem a variável (ou com 0), nada é barrado: subir o servidor novo antes do app
 * novo não derruba ninguém.
 */

export interface PedidoDoApp {
  build: string | null;
  plataforma: string | null;
  agente: string | null;
}

export interface Minimos {
  android: number;
  ios: number;
}

export type Veredito = { ok: true } | { ok: false; build: number; minimo: number; plataforma: "android" | "ios" };

export function lerMinimos(env: Record<string, string | undefined> = process.env): Minimos {
  const n = (v: string | undefined) => (v && /^\d{1,8}$/.test(v.trim()) ? Number(v.trim()) : 0);
  return { android: n(env.APP_BUILD_MINIMO_ANDROID), ios: n(env.APP_BUILD_MINIMO_IOS) };
}

/** O sistema de quem chama: o cabeçalho, ou o `User-Agent` do app; sem nada, é o Android antigo. */
function plataformaDe(p: PedidoDoApp): "android" | "ios" {
  const declarada = p.plataforma?.trim().toLowerCase();
  if (declarada === "ios" || declarada === "android") return declarada;
  const porAgente = /^Selebi-(Android|iOS)\//i.exec(p.agente ?? "")?.[1]?.toLowerCase();
  return porAgente === "ios" ? "ios" : "android";
}

export function avaliarVersao(p: PedidoDoApp, minimos: Minimos): Veredito {
  const plataforma = plataformaDe(p);
  const minimo = minimos[plataforma];
  const build = p.build && /^\d{1,8}$/.test(p.build.trim()) ? Number(p.build.trim()) : 0;
  return minimo > 0 && build < minimo ? { ok: false, build, minimo, plataforma } : { ok: true };
}

/** 426 se o app é velho demais, ou `null` se pode seguir. */
export function exigirVersaoMinima(req: Request): Response | null {
  const v = avaliarVersao(
    {
      build: req.headers.get("x-app-build"),
      plataforma: req.headers.get("x-app-plataforma"),
      agente: req.headers.get("user-agent"),
    },
    lerMinimos(),
  );
  if (v.ok) return null;
  const loja = (v.plataforma === "ios" ? process.env.APP_LOJA_URL_IOS : process.env.APP_LOJA_URL_ANDROID)?.trim();
  const resposta = falha(
    426,
    "app_desatualizado",
    "Esta versão do BBSolution está desatualizada. Atualize o aplicativo na loja para continuar — " +
      "o que você já fez neste celular fica guardado.",
  );
  if (loja) resposta.headers.set("x-app-loja", loja);
  return resposta;
}
