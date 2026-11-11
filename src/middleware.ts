import { NextResponse, type NextRequest } from "next/server";

import { COOKIE_SESSAO } from "@/auth/constantes";

/** Telas de quem ainda não entrou. */
const PUBLICAS = new Set(["/login", "/login/mfa", "/solicitar-acesso", "/privacidade", "/excluir-conta"]);

/**
 * A política de conteúdo (CSP): a lista do que o navegador pode carregar e
 * executar numa página do Selebi.
 *
 * É a rede de segurança contra XSS. O React já escapa o que escreve na tela;
 * se um dia um texto de cliente escapar disso (um balão do mapa, uma biblioteca
 * nova), o código injetado não roda, porque não tem o `nonce` — um número
 * sorteado a cada página, que só os scripts do próprio Selebi recebem.
 *
 * - `script-src` com `nonce` e `strict-dynamic`: só roda script que o servidor
 *   marcou nesta resposta, e o que esses scripts carregarem. Nada de script
 *   escrito no meio do HTML, nada de `onclick="…"`.
 * - `style-src 'unsafe-inline'`: o React escreve `style="…"` nos elementos, e o
 *   mapa também. Estilo não executa código; o risco que sobra é pequeno.
 * - `img-src`: o próprio site, pré-visualização de foto (`blob:`/`data:`) e os
 *   quadradinhos do mapa do OpenStreetMap.
 * - `frame-ancestors 'none'`: ninguém embute o Selebi num iframe.
 * - `form-action 'self'`: formulário daqui só envia para cá.
 *
 * `CSP_MODO` no `.env` muda o comportamento sem novo build:
 *   (vazio) ou `bloquear`  o navegador barra o que foge da política
 *   `relatorio`            só avisa (o que seria barrado aparece no log do site)
 *   `desligado`            sem política nenhuma
 * Nos dois primeiros, o que foge é contado em `/api/csp` e sai no log.
 */
function politica(nonce: string, https: boolean): string {
  const desenvolvimento = process.env.NODE_ENV !== "production";
  return [
    "default-src 'self'",
    // `'self'` só vale para navegador antigo, que não entende `strict-dynamic`.
    // O `next dev` usa `eval` para recarregar a tela; em produção ele não existe.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${desenvolvimento ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https://tile.openstreetmap.org",
    "media-src 'self' blob:",
    "font-src 'self'",
    `connect-src 'self'${desenvolvimento ? " ws: wss:" : ""}`,
    "worker-src 'self'",
    "manifest-src 'self'",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(https ? ["upgrade-insecure-requests"] : []),
    "report-uri /api/csp",
  ].join("; ");
}

function sortearNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes));
}

/**
 * Primeira barreira: quem não tem cookie nem chega a carregar a página.
 *
 * Aqui só se olha se o cookie existe — o middleware roda no Edge e não alcança
 * o banco, então não há como saber se a sessão é válida. Um cookie forjado
 * passa por esta porta e morre logo depois, porque toda página protegida chama
 * `exigirUsuario()`, que confere no banco de verdade. Esta camada existe para
 * evitar carregar página inteira para quem nem tentou entrar.
 *
 * É aqui também que toda página ganha a política de conteúdo (ver [politica]).
 */
export function middleware(requisicao: NextRequest) {
  const { pathname } = requisicao.nextUrl;
  const temCookie = requisicao.cookies.has(COOKIE_SESSAO);

  if (!temCookie && !PUBLICAS.has(pathname)) {
    const destino = new URL("/login", requisicao.url);
    return NextResponse.redirect(destino);
  }

  const modo = process.env.CSP_MODO?.trim().toLowerCase();
  if (modo === "desligado") return NextResponse.next();

  const nonce = sortearNonce();
  const https = requisicao.headers.get("x-forwarded-proto") === "https" || requisicao.nextUrl.protocol === "https:";
  const csp = politica(nonce, https);
  const cabecalho = modo === "relatorio" ? "Content-Security-Policy-Report-Only" : "Content-Security-Policy";

  // O Next lê a política **do pedido** para pôr o mesmo nonce nos scripts que
  // ele escreve; o `x-nonce` é para o nosso script do menu, em `layout.tsx`.
  const cabecalhos = new Headers(requisicao.headers);
  cabecalhos.set("x-nonce", nonce);
  cabecalhos.set(cabecalho, csp);

  const resposta = NextResponse.next({ request: { headers: cabecalhos } });
  resposta.headers.set(cabecalho, csp);
  return resposta;
}

export const config = {
  /**
   * Deixa passar os estáticos do Next, os ícones (aba e tela inicial do
   * celular, que aparecem também no login) e a API do app.
   *
   * O app não usa cookie: manda o token no cabeçalho `Authorization`, e cada
   * rota de `/api/app/` confere a sessão no banco. Se esta barreira pegasse
   * essas rotas, redirecionaria o celular para a página de login em HTML — e o
   * app receberia uma página no lugar do JSON que esperava.
   *
   * `api/saude` é a rota de saúde, chamada por um monitor externo que não tem
   * sessão e não pode ser mandado para o login.
   *
   * `api/energisa/` recebe a extensão do Chrome: sem sessão, a rota responde
   * 401 em JSON (a extensão avisa "entre no Selebi"), em vez de receber a
   * página de login.
   *
   * `api/csp` recebe do navegador o aviso do que a política de conteúdo
   * barrou — inclusive na tela de login, de quem ainda não tem sessão.
   *
   * `r/` é o relatório da OS que vai para o cliente pelo WhatsApp. Ele não tem
   * login no Selebi: quem abre é quem recebeu o link, e a rota confere a chave
   * longa e aleatória do link no banco.
   *
   * `privacidade` e `excluir-conta` são páginas públicas (as lojas exigem), mas
   * passam por aqui para receber a política de conteúdo como as outras.
   */
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|apple-icon.png|api/app/|api/saude|api/energisa/|api/csp|r/).*)"],
};
