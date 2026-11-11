import { createHash, randomBytes } from "node:crypto";

import { and, eq, lt, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  dispositivoConfiavel as dispositivoTable,
  mfaDesafio as desafioTable,
  sessao as sessaoTable,
  usuario as usuarioTable,
} from "@/db/schema";

import {
  abrirSegredo,
  cifrarSegredo,
  enderecoOtpauth,
  novoSegredo,
  podeCifrarSegredo,
  verificarCodigo,
} from "./totp";

/**
 * O segundo fator: o código do aplicativo autenticador, depois da senha.
 *
 * As regras, em uma frase cada:
 * - **todo mundo** que entra pelo navegador tem de ter o aplicativo cadastrado;
 *   quem ainda não tem é levado a cadastrar no primeiro login;
 * - o código é pedido **em todo aparelho que o sistema ainda não conhece**;
 * - num aparelho conhecido ele é pedido de novo **30 dias depois da última vez
 *   que foi digitado** — não renova sozinho, e a sessão acaba junto;
 * - o código só vale uma vez, e o desafio aceita 5 tentativas em 10 minutos.
 *
 * O app do celular usa as mesmas peças pela API (`MFA_APP=1`); enquanto o app
 * publicado não tiver a tela do código, fica desligado para não trancar ninguém.
 */

export const DESAFIO_MINUTOS = 10;
export const DESAFIO_TENTATIVAS = 5;
/** Quanto tempo um aparelho fica "conhecido" depois do código: o "uma vez por mês". */
export const CONFIANCA_DIAS = 30;
/** Quem não marca "confiar neste aparelho" entra por meio dia e o código volta a ser pedido. */
export const SESSAO_SEM_CONFIANCA_HORAS = 12;

const MINUTO = 60_000;
const HORA = 3_600_000;
const DIA = 86_400_000;

let avisouChave = false;

/**
 * O segundo fator está valendo no navegador?
 *
 * Precisa da `APP_ENCRYPTION_KEY` (com ela o segredo é cifrado). Sem a chave ele
 * **fica desligado e avisa no log**, em vez de trancar todo mundo para fora no
 * deploy em que ela esquecer de existir. `MFA_MODO=desligado` desliga de propósito.
 */
export function mfaAtivo(): boolean {
  if (process.env.MFA_MODO?.trim().toLowerCase() === "desligado") return false;
  if (!podeCifrarSegredo()) {
    if (!avisouChave) {
      avisouChave = true;
      console.warn("[mfa] APP_ENCRYPTION_KEY não está no .env: o segundo fator está DESLIGADO. Defina a chave (veja .env.example) e reinicie o site.");
    }
    return false;
  }
  return true;
}

/** No app: só com `MFA_APP=1` — a tela do código precisa estar na versão publicada. */
export function mfaAtivoNoApp(): boolean {
  return process.env.MFA_APP?.trim() === "1" && mfaAtivo();
}

export function digerir(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** "Chrome · Windows" a partir do User-Agent — só para a pessoa reconhecer o aparelho. */
export function rotuloDoDispositivo(userAgent: string | null | undefined): string {
  const ua = userAgent ?? "";
  const navegador = /Edg\//.test(ua)
    ? "Edge"
    : /OPR\//.test(ua)
      ? "Opera"
      : /Firefox\//.test(ua)
        ? "Firefox"
        : /Chrome\//.test(ua)
          ? "Chrome"
          : /Safari\//.test(ua)
            ? "Safari"
            : "Navegador";
  const sistema = /Android/.test(ua)
    ? "Android"
    : /iPhone|iPad/.test(ua)
      ? "iPhone"
      : /Windows/.test(ua)
        ? "Windows"
        : /Mac OS X/.test(ua)
          ? "Mac"
          : /Linux/.test(ua)
            ? "Linux"
            : "sistema desconhecido";
  return `${navegador} · ${sistema}`;
}

/** Aproveita para tirar o que venceu, sem cron só para isso. */
async function limparVencidos(): Promise<void> {
  const agora = new Date();
  await db.delete(desafioTable).where(lt(desafioTable.expiraEm, agora));
  await db.delete(dispositivoTable).where(lt(dispositivoTable.expiraEm, agora));
}

// ---- o desafio (senha certa, falta o código) -----------------------------------------------

export interface Cadastro {
  /** Base32, para digitar à mão. */
  segredo: string;
  /** O que o QR carrega. */
  uri: string;
}

/**
 * Abre o desafio de quem acabou de acertar a senha. Devolve o token que a pessoa
 * carrega (cookie no navegador; corpo da resposta no app). Quem ainda não tem o
 * aplicativo cadastrado recebe junto o segredo novo.
 */
export async function abrirDesafio(dados: {
  usuarioId: string;
  origem: "web" | "app";
  dispositivo?: string | null;
}): Promise<{ token: string; cadastro: Cadastro | null }> {
  await limparVencidos();
  const pessoa = await db.query.usuario.findFirst({
    where: eq(usuarioTable.id, dados.usuarioId),
    columns: { id: true, email: true, cpf: true, nome: true, mfaSegredo: true },
  });
  if (!pessoa) throw new Error("Usuário do desafio não existe.");

  // Um desafio por pessoa de cada vez: tentar de novo recomeça do zero (e zera as tentativas).
  await db.delete(desafioTable).where(and(eq(desafioTable.usuarioId, pessoa.id), eq(desafioTable.origem, dados.origem)));

  const token = randomBytes(32).toString("base64url");
  let cadastro: Cadastro | null = null;
  let pendente: string | null = null;
  if (!pessoa.mfaSegredo) {
    const segredo = novoSegredo();
    pendente = cifrarSegredo(segredo, pessoa.id);
    cadastro = { segredo, uri: enderecoOtpauth(segredo, pessoa.email ?? pessoa.nome) };
  }
  await db.insert(desafioTable).values({
    id: digerir(token),
    usuarioId: pessoa.id,
    origem: dados.origem,
    segredoPendente: pendente,
    dispositivo: dados.dispositivo?.slice(0, 200) ?? null,
    expiraEm: new Date(Date.now() + DESAFIO_MINUTOS * MINUTO),
  });
  return { token, cadastro };
}

export interface DesafioLido {
  usuarioId: string;
  conta: string;
  dispositivo: string | null;
  /** Só no primeiro cadastro. */
  cadastro: Cadastro | null;
}

/** O desafio que o token abre, se ainda vale — com o segredo a mostrar, quando é o primeiro cadastro. */
export async function lerDesafio(token: string | undefined, origem: "web" | "app"): Promise<DesafioLido | null> {
  if (!token || !/^[A-Za-z0-9_-]{20,100}$/.test(token)) return null;
  const desafio = await db.query.mfaDesafio.findFirst({
    where: and(eq(desafioTable.id, digerir(token)), eq(desafioTable.origem, origem)),
    with: { usuario: { columns: { id: true, email: true, nome: true, ativo: true, aprovadoEm: true } } },
  });
  if (!desafio || desafio.expiraEm <= new Date() || desafio.tentativas >= DESAFIO_TENTATIVAS) return null;
  // A conta pode ter sido desativada nos minutos entre a senha e o código.
  if (!desafio.usuario.ativo || !desafio.usuario.aprovadoEm) return null;

  let cadastro: Cadastro | null = null;
  if (desafio.segredoPendente) {
    const segredo = abrirSegredo(desafio.segredoPendente, desafio.usuarioId);
    if (!segredo) return null;
    cadastro = { segredo, uri: enderecoOtpauth(segredo, desafio.usuario.email ?? desafio.usuario.nome) };
  }
  return {
    usuarioId: desafio.usuarioId,
    conta: desafio.usuario.email ?? desafio.usuario.nome,
    dispositivo: desafio.dispositivo,
    cadastro,
  };
}

export type ResultadoDesafio =
  | { ok: true; usuarioId: string; primeiroCadastro: boolean; dispositivo: string | null }
  | { ok: false; motivo: "expirou" | "codigo" };

/**
 * Confere o código do desafio.
 *
 * Cada tentativa gasta uma das 5 **antes** de olhar o código (e em uma instrução
 * só, no banco), então mandar vários pedidos ao mesmo tempo não dá mais
 * tentativas. Código certo apaga o desafio; o mesmo código não entra duas vezes.
 */
export async function confirmarDesafio(dados: {
  token: string;
  codigo: string;
  origem: "web" | "app";
}): Promise<ResultadoDesafio> {
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(dados.token)) return { ok: false, motivo: "expirou" };
  const id = digerir(dados.token);

  const [gasto] = await db
    .update(desafioTable)
    .set({ tentativas: sql`${desafioTable.tentativas} + 1` })
    .where(
      and(
        eq(desafioTable.id, id),
        eq(desafioTable.origem, dados.origem),
        sql`${desafioTable.expiraEm} > now()`,
        sql`${desafioTable.tentativas} < ${DESAFIO_TENTATIVAS}`,
      ),
    )
    .returning({
      usuarioId: desafioTable.usuarioId,
      segredoPendente: desafioTable.segredoPendente,
      dispositivo: desafioTable.dispositivo,
      tentativas: desafioTable.tentativas,
    });
  if (!gasto) return { ok: false, motivo: "expirou" };

  const falhou = async (): Promise<ResultadoDesafio> => {
    // A última tentativa errada encerra o desafio: recomeçar exige a senha de novo.
    if (gasto.tentativas >= DESAFIO_TENTATIVAS) {
      await db.delete(desafioTable).where(eq(desafioTable.id, id));
      return { ok: false, motivo: "expirou" };
    }
    return { ok: false, motivo: "codigo" };
  };

  const pessoa = await db.query.usuario.findFirst({
    where: eq(usuarioTable.id, gasto.usuarioId),
    columns: { id: true, ativo: true, aprovadoEm: true, mfaSegredo: true, mfaUltimoPasso: true },
  });
  if (!pessoa || !pessoa.ativo || !pessoa.aprovadoEm) return { ok: false, motivo: "expirou" };

  const primeiroCadastro = !pessoa.mfaSegredo;
  const guardado = pessoa.mfaSegredo ?? gasto.segredoPendente;
  const segredo = guardado ? abrirSegredo(guardado, pessoa.id) : null;
  // Segredo que não abre (a chave do .env mudou, linha adulterada): nenhum código serve. Redefinir resolve.
  if (!segredo) return falhou();

  const passo = verificarCodigo(segredo, dados.codigo, pessoa.mfaUltimoPasso);
  if (passo === null) return falhou();

  // Grava o passo só se for maior que o último: dois envios do mesmo código ao mesmo tempo, só um passa.
  const gravou = primeiroCadastro
    ? await db
        .update(usuarioTable)
        .set({ mfaSegredo: cifrarSegredo(segredo, pessoa.id), mfaAtivadoEm: new Date(), mfaUltimoPasso: passo })
        .where(and(eq(usuarioTable.id, pessoa.id), sql`${usuarioTable.mfaSegredo} is null`))
        .returning({ id: usuarioTable.id })
    : await db
        .update(usuarioTable)
        .set({ mfaUltimoPasso: passo })
        .where(
          and(
            eq(usuarioTable.id, pessoa.id),
            sql`(${usuarioTable.mfaUltimoPasso} is null or ${usuarioTable.mfaUltimoPasso} < ${passo})`,
          ),
        )
        .returning({ id: usuarioTable.id });
  if (!gravou.length) return falhou();

  await db.delete(desafioTable).where(eq(desafioTable.id, id));
  return { ok: true, usuarioId: pessoa.id, primeiroCadastro, dispositivo: gasto.dispositivo };
}

// ---- aparelho conhecido ---------------------------------------------------------------------

/**
 * Este aparelho já provou o código e ainda está nos 30 dias? Devolve até quando.
 * Só vale se a pessoa tem o aplicativo cadastrado (redefinir o 2FA apaga os aparelhos).
 */
export async function dispositivoConhecido(usuarioId: string, tokenPuro: string | undefined): Promise<{ expiraEm: Date } | null> {
  if (!tokenPuro || !/^[A-Za-z0-9_-]{20,100}$/.test(tokenPuro)) return null;
  const linha = await db.query.dispositivoConfiavel.findFirst({
    where: and(eq(dispositivoTable.tokenHash, digerir(tokenPuro)), eq(dispositivoTable.usuarioId, usuarioId)),
    with: { usuario: { columns: { mfaSegredo: true } } },
  });
  if (!linha || linha.expiraEm <= new Date() || !linha.usuario.mfaSegredo) return null;
  await db.update(dispositivoTable).set({ ultimoUsoEm: new Date() }).where(eq(dispositivoTable.id, linha.id));
  return { expiraEm: linha.expiraEm };
}

/**
 * Passa a conhecer este aparelho, por 30 dias a partir de agora. Devolve o token
 * que o aparelho guarda (o banco só fica com o SHA-256 dele).
 */
export async function lembrarDispositivo(dados: {
  usuarioId: string;
  origem: "web" | "app";
  rotulo: string;
  /** O token que o aparelho já tinha, se tinha: é substituído, não acumulado. */
  tokenAnterior?: string;
}): Promise<{ token: string; expiraEm: Date }> {
  if (dados.tokenAnterior) {
    await db
      .delete(dispositivoTable)
      .where(and(eq(dispositivoTable.tokenHash, digerir(dados.tokenAnterior)), eq(dispositivoTable.usuarioId, dados.usuarioId)));
  }
  const token = randomBytes(32).toString("base64url");
  const agora = Date.now();
  const expiraEm = new Date(agora + CONFIANCA_DIAS * DIA);
  await db.insert(dispositivoTable).values({
    usuarioId: dados.usuarioId,
    tokenHash: digerir(token),
    origem: dados.origem,
    rotulo: dados.rotulo.slice(0, 120),
    mfaEm: new Date(agora),
    expiraEm,
    ultimoUsoEm: new Date(agora),
  });
  return { token, expiraEm };
}

/** Quanto vale a sessão de quem entrou sem marcar "confiar neste aparelho". */
export function validadeSemConfianca(): Date {
  return new Date(Date.now() + SESSAO_SEM_CONFIANCA_HORAS * HORA);
}

// ---- redefinir ------------------------------------------------------------------------------

/**
 * Apaga o segundo fator de uma pessoa: o aplicativo, os aparelhos conhecidos,
 * os desafios abertos e **todas as sessões**. No próximo login ela cadastra o
 * aplicativo de novo. É a saída para quem perdeu o celular.
 */
export async function redefinirMfa(usuarioId: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .update(usuarioTable)
      .set({ mfaSegredo: null, mfaAtivadoEm: null, mfaUltimoPasso: null })
      .where(eq(usuarioTable.id, usuarioId));
    await tx.delete(dispositivoTable).where(eq(dispositivoTable.usuarioId, usuarioId));
    await tx.delete(desafioTable).where(eq(desafioTable.usuarioId, usuarioId));
    await tx.delete(sessaoTable).where(eq(sessaoTable.usuarioId, usuarioId));
  });
}
