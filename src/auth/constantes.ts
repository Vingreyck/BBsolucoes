/**
 * Constantes de autenticação sem nenhuma dependência.
 *
 * O middleware do Next roda no runtime Edge, onde o driver do Postgres não
 * existe. Importar `sessao.ts` de lá arrastaria o banco junto e quebraria o
 * build — por isso o nome do cookie mora sozinho aqui.
 */
export const COOKIE_SESSAO = "bb_sessao";
