/**
 * Constantes de autenticação sem nenhuma dependência.
 *
 * O middleware do Next roda no runtime Edge, onde o driver do Postgres não
 * existe. Importar `sessao.ts` de lá arrastaria o banco junto e quebraria o
 * build — por isso o nome do cookie mora sozinho aqui.
 */
export const COOKIE_SESSAO = "bb_sessao";

/** O desafio do segundo fator em andamento (a senha conferiu, falta o código). Vale 10 minutos. */
export const COOKIE_MFA = "bb_mfa";

/**
 * O cookie do aparelho conhecido. Um por pessoa — `bb_disp_` e o início do id —,
 * para o mesmo computador servir a várias sem uma tirar a confiança da outra.
 */
export const cookieDoDispositivo = (usuarioId: string) => `bb_disp_${usuarioId.slice(0, 8)}`;
