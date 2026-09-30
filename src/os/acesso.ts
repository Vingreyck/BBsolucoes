import { redirect } from "next/navigation";

import { pode } from "@/app-movel/permissoes";
import type { UsuarioApp } from "@/auth/sessao-app";
import { exigirUsuario, usuarioAtual, type UsuarioSessao } from "@/auth/sessao";

/**
 * Quem faz o quê numa ordem de serviço.
 *
 * Duas posições, como no IXC:
 *
 * - **Gestão** abre, atribui, agenda, cancela e reabre. Na web são o adm, o
 *   engenheiro e o vendedor — é o comercial quem marca a vistoria com o
 *   cliente. No app, quem tem `os.ver_todas`.
 * - **Execução** sai para o local, inicia, responde o checklist, fotografa e
 *   conclui. É o responsável pela OS; a gestão também pode, para registrar um
 *   atendimento que voltou em papel.
 *
 * O estoque não entra na OS.
 */

export interface Ator {
  id: string;
  nome: string;
  empresaId: string;
  papel: string;
  origem: "web" | "app" | "sistema";
  gestao: boolean;
}

const GESTAO_WEB = new Set(["adm", "engenheiro", "vendedor"]);
const SEM_OS = new Set(["estoque"]);

export function ehGestaoWeb(papel: string): boolean {
  return GESTAO_WEB.has(papel);
}

export function atorDaWeb(usuario: UsuarioSessao): Ator {
  return {
    id: usuario.id,
    nome: usuario.nome,
    empresaId: usuario.empresaId,
    papel: usuario.papel,
    origem: "web",
    gestao: ehGestaoWeb(usuario.papel),
  };
}

export function atorDoApp(usuario: UsuarioApp): Ator {
  return {
    id: usuario.id,
    nome: usuario.nome,
    empresaId: usuario.empresaId,
    papel: usuario.papel,
    origem: "app",
    gestao: pode(usuario, "os.ver_todas"),
  };
}

/** A gestão vê todas; os outros, só as OS de que são responsáveis. */
export function podeVer(ator: Ator, os: { responsavelId: string | null }): boolean {
  return ator.gestao || os.responsavelId === ator.id;
}

export const podeExecutar = podeVer;

/**
 * Para rota que devolve dado (JSON, fluxo ao vivo) e não página: sem sessão
 * válida, `null` — quem chama responde 401, em vez de redirecionar para o
 * login uma chamada que o navegador fez por trás da tela.
 */
export async function atorDaWebOuNulo(): Promise<Ator | null> {
  const usuario = await usuarioAtual();
  if (!usuario || usuario.deveTrocarSenha || SEM_OS.has(usuario.papel)) return null;
  return atorDaWeb(usuario);
}

/** Sessão da web com acesso a OS. Esconder o menu não protege; isto protege. */
export async function exigirAtorWeb(): Promise<Ator> {
  const usuario = await exigirUsuario();
  if (SEM_OS.has(usuario.papel)) redirect("/sem-acesso");
  return atorDaWeb(usuario);
}

export async function exigirGestaoWeb(): Promise<Ator> {
  const ator = await exigirAtorWeb();
  if (!ator.gestao) redirect("/sem-acesso");
  return ator;
}

/**
 * Recusa com motivo. O `codigo` é o que a API do app devolve no campo `erro`;
 * a `mensagem` é a frase que aparece na tela, de um lado ou do outro.
 */
export class ErroOs extends Error {
  constructor(
    public readonly codigo: string,
    mensagem: string,
    public readonly status = 400,
  ) {
    super(mensagem);
    this.name = "ErroOs";
  }
}
