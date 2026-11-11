import { consumir, MINUTO } from "@/app-movel/limitador";

import { enviarParaSentry } from "./sentry";

/**
 * A trilha dos eventos de segurança.
 *
 * Até aqui uma tentativa de adivinhar senha não deixava rastro nenhum: o freio
 * barrava e ninguém ficava sabendo. Agora cada entrada, cada senha errada e
 * cada bloqueio vira uma linha no log do site (`docker compose logs site`), e
 * o bloqueio — que é o sinal de alguém insistindo — também avisa o Sentry, que
 * manda e-mail.
 *
 * Quem tenta fica mascarado: o log não é lugar de CPF nem de e-mail inteiro
 * (LGPD, art. 6º, necessidade). O que sobra basta para reconhecer a conta —
 * "v***@gmail.com", "CPF final 42" — sem expor quem lê o log.
 */

export type EventoSeguranca =
  | "login_ok"
  | "login_falhou"
  | "login_bloqueado"
  | "cadastro_bloqueado"
  | "senha_regravada"
  | "mfa_pedido"
  | "mfa_ok"
  | "mfa_cadastrado"
  | "mfa_falhou"
  | "mfa_bloqueado"
  | "mfa_redefinido";

/** "vinicius@gmail.com" → "v***@gmail.com"; CPF → "CPF final 42". Nunca o valor inteiro. */
export function mascarar(identificador: string): string {
  const limpo = identificador.trim().slice(0, 254);
  if (limpo.includes("@")) {
    const [usuario, dominio] = limpo.split("@");
    return `${usuario.slice(0, 1)}***@${(dominio ?? "").replace(/[^\w.-]/g, "")}`;
  }
  const digitos = limpo.replace(/\D/g, "");
  return digitos.length >= 2 ? `CPF final ${digitos.slice(-2)}` : "(sem identificação)";
}

/** Só o que cabe numa linha de log: sem quebra de linha, para ninguém forjar uma linha falsa. */
function emUmaLinha(texto: string): string {
  return texto.replace(/[\r\n\t]+/g, " ").slice(0, 200);
}

export function registrarSeguranca(
  evento: EventoSeguranca,
  dados: { origem: "web" | "app"; ip: string; quem?: string; usuarioId?: string; detalhe?: string },
): void {
  const linha = {
    seguranca: evento,
    origem: dados.origem,
    ip: emUmaLinha(dados.ip),
    ...(dados.quem ? { quem: mascarar(dados.quem) } : {}),
    ...(dados.usuarioId ? { usuario: dados.usuarioId } : {}),
    ...(dados.detalhe ? { detalhe: emUmaLinha(dados.detalhe) } : {}),
    quando: new Date().toISOString(),
  };
  // Entrar é rotina; errar e ser bloqueado é o que alguém vai procurar depois.
  if (["login_ok", "senha_regravada", "mfa_pedido", "mfa_ok", "mfa_cadastrado", "mfa_redefinido"].includes(evento)) console.log(JSON.stringify(linha));
  else console.warn(JSON.stringify(linha));

  // Bloqueio avisa o Sentry — uma vez a cada 15 minutos por IP, e não a cada tentativa barrada.
  if (evento === "login_bloqueado" || evento === "cadastro_bloqueado" || evento === "mfa_bloqueado") {
    if (consumir(`aviso-seguranca:${evento}:${dados.ip}`, 1, 15 * MINUTO).ok) {
      void enviarParaSentry({
        mensagem:
          evento === "login_bloqueado"
            ? `Muitas tentativas de login seguidas (${dados.origem}) — ${linha.quem ?? "várias contas"}`
            : evento === "mfa_bloqueado"
              ? `Muitos códigos do 2FA errados (${dados.origem}) — a senha dessa conta pode estar vazada`
              : `Muitos pedidos de cadastro seguidos (${dados.origem})`,
        tipo: "Seguranca",
        plataforma: "node",
        nivel: "warning",
        tags: { seguranca: evento, origem: dados.origem },
        extra: { ip: linha.ip, quem: linha.quem ?? null },
      });
    }
  }
}
