import { NextResponse, type NextRequest } from "next/server";

import { COOKIE_SESSAO } from "@/auth/constantes";

/**
 * Primeira barreira: quem não tem cookie nem chega a carregar a página.
 *
 * Aqui só se olha se o cookie existe — o middleware roda no Edge e não alcança
 * o banco, então não há como saber se a sessão é válida. Um cookie forjado
 * passa por esta porta e morre logo depois, porque toda página protegida chama
 * `exigirUsuario()`, que confere no banco de verdade. Esta camada existe para
 * evitar carregar página inteira para quem nem tentou entrar.
 */
export function middleware(requisicao: NextRequest) {
  const { pathname } = requisicao.nextUrl;
  const temCookie = requisicao.cookies.has(COOKIE_SESSAO);

  if (!temCookie && pathname !== "/login") {
    const destino = new URL("/login", requisicao.url);
    return NextResponse.redirect(destino);
  }

  return NextResponse.next();
}

export const config = {
  // Deixa passar os estáticos do Next e o favicon; o resto passa pela barreira.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
