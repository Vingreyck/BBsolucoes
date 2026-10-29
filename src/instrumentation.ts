/**
 * Quando o site sobe: liga a ronda que leva ao Drive os anexos que ficaram no
 * disco (ver `os/deposito-local.ts`).
 *
 * O `if` com `NEXT_RUNTIME` em volta do `import` é o jeito que o Next entende
 * para não empacotar código de Node (disco, banco) na versão Edge do arquivo.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { iniciarEnvioDeAnexos } = await import("./os/anexos");
    iniciarEnvioDeAnexos();
  }
}

/**
 * O gancho do Next para erros do servidor: toda exceção que escapa de uma
 * página, rota ou Server Action passa por aqui e vai para o Sentry.
 *
 * Roda só no Node (o middleware, no Edge, não alcança o `fetch` do Sentry com o
 * DSN do ambiente) e é o `onRequestError` — o que o Next chama quando uma
 * requisição estoura, em vez de a gente embrulhar cada rota em `try/catch`.
 */
export async function onRequestError(
  erro: unknown,
  requisicao: { path: string; method: string },
  contexto: { routeType: string; routePath: string },
) {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { enviarParaSentry } = await import("./sistema/sentry");
  const e = erro instanceof Error ? erro : new Error(String(erro));
  console.error(`[erro] ${requisicao.method} ${requisicao.path}:`, e);
  await enviarParaSentry({
    mensagem: e.message,
    tipo: e.name,
    pilha: e.stack,
    plataforma: "node",
    // Sem query string nem corpo: podem ter CPF, token ou o código da empresa.
    tags: { rota: contexto.routePath, tipo_rota: contexto.routeType, metodo: requisicao.method },
  });
}
