import { cookies } from "next/headers";

import { COOKIE_MFA, cookieDoDispositivo } from "./constantes";
import { DESAFIO_MINUTOS } from "./mfa";

/**
 * Os cookies do segundo fator no navegador. Separados de `mfa.ts` porque aquele
 * também roda fora de uma requisição (o app, o terminal).
 *
 * Os dois são `httpOnly` (script da página não lê), `secure` em produção e
 * `sameSite=lax`: o desafio só faz sentido seguindo o fluxo do próprio login.
 */

const seguro = () => process.env.NODE_ENV === "production";

export async function guardarDesafio(token: string): Promise<void> {
  (await cookies()).set(COOKIE_MFA, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: seguro(),
    path: "/",
    maxAge: DESAFIO_MINUTOS * 60,
  });
}

export async function desafioGuardado(): Promise<string | undefined> {
  return (await cookies()).get(COOKIE_MFA)?.value;
}

export async function esquecerDesafio(): Promise<void> {
  (await cookies()).delete(COOKIE_MFA);
}

export async function dispositivoGuardado(usuarioId: string): Promise<string | undefined> {
  return (await cookies()).get(cookieDoDispositivo(usuarioId))?.value;
}

export async function guardarDispositivo(usuarioId: string, token: string, expiraEm: Date): Promise<void> {
  (await cookies()).set(cookieDoDispositivo(usuarioId), token, {
    httpOnly: true,
    sameSite: "lax",
    secure: seguro(),
    path: "/",
    expires: expiraEm,
  });
}
