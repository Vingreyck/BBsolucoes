import { existsSync, mkdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

import {
  driveConfigurado,
  enviarArquivo,
  garantirPasta,
  listarArquivos,
  moverParaLixeira,
} from "@/documentos/drive";

import { cifrar, senhaDoBackup } from "./cofre-backup";

/**
 * A cópia de segurança fora da VM.
 *
 * Até aqui as cópias moravam em `backups/`, no mesmo disco do banco. Se o disco
 * ou a VM se perde, vão o banco e as cópias juntos — o backup não protegia do
 * que mais ameaça um sistema numa VM só. Agora, depois de gravar a cópia do
 * dia, ela sobe cifrada (ver `cofre-backup.ts`) para uma pasta própria no Drive
 * da empresa, fora da árvore de clientes.
 *
 * No Drive ficam as 30 mais novas; as mais velhas vão para a lixeira do Drive,
 * de onde ainda dá para tirar por 30 dias.
 */

export const PASTA_NO_DRIVE = "Backups do Selebi (cifrados)";
export const MANTER_NO_DRIVE = 30;

/** O resumo do último envio, que a rota de saúde do site lê. */
export const ARQUIVO_ESTADO = join("backups", "ultimo-envio.json");

export interface EstadoEnvio {
  ok: boolean;
  quando: string;
  arquivo?: string;
  tamanho?: number;
  erro?: string;
}

/** Por que não dá para enviar, ou nulo quando dá. */
export function motivoParaNaoEnviar(): string | null {
  if (!senhaDoBackup()) return "BACKUP_SENHA não está no .env — só existe a cópia local";
  if (!driveConfigurado()) return "o Drive não está conectado neste servidor";
  return null;
}

/** As cópias que passaram da conta, das mais velhas: as que vão para a lixeira. */
export function excedentes<T extends { name: string; createdTime?: string }>(
  arquivos: T[],
  manter = MANTER_NO_DRIVE,
): T[] {
  const copias = arquivos
    .filter((a) => a.name.startsWith("selebi-") && a.name.endsWith(".cifrado"))
    .sort((a, b) => (b.createdTime ?? "").localeCompare(a.createdTime ?? ""));
  return copias.slice(manter);
}

export function lerEstadoEnvio(): EstadoEnvio | null {
  try {
    return JSON.parse(readFileSync(ARQUIVO_ESTADO, "utf8")) as EstadoEnvio;
  } catch {
    return null;
  }
}

function gravarEstado(estado: EstadoEnvio): void {
  mkdirSync("backups", { recursive: true });
  writeFileSync(ARQUIVO_ESTADO, JSON.stringify(estado, null, 2));
}

/** "2026-10" — o mês de agora, no relógio do servidor. */
export function mesAtual(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** A marca de que a restauração foi testada e funcionou naquele mês. */
export function marcaDaRestauracao(mes: string): string {
  return join("backups", `restauracao-${mes}.ok`);
}

export function restauracaoTestadaEsteMes(): boolean {
  return existsSync(marcaDaRestauracao(mesAtual()));
}

/** Já subiu hoje uma cópia? (relógio do servidor, que roda em America/Sao_Paulo) */
export function enviouHoje(hoje: string): boolean {
  const estado = lerEstadoEnvio();
  return Boolean(estado?.ok && estado.arquivo?.startsWith(`selebi-${hoje}`));
}

/**
 * Cifra a cópia local e sobe para o Drive. Devolve o nome que ficou lá.
 * Falha com erro legível; o estado fica gravado nos dois casos.
 */
export async function enviarParaDrive(arquivoLocal: string): Promise<{ nome: string; tamanho: number; lixeira: number }> {
  const motivo = motivoParaNaoEnviar();
  if (motivo) throw new Error(`Cópia externa não enviada: ${motivo}.`);

  const cifrado = `${arquivoLocal}.cifrado`;
  const nome = basename(cifrado);
  try {
    await cifrar(arquivoLocal, cifrado, senhaDoBackup()!);
    const tamanho = statSync(cifrado).size;

    // Na raiz do "Meu Drive" da conta da empresa, longe das pastas de cliente que
    // a equipe abre todo dia.
    const pasta = await garantirPasta(PASTA_NO_DRIVE, "root");
    await enviarArquivo({ nome, mimeType: "application/octet-stream", pastaId: pasta, conteudo: readFileSync(cifrado) });

    const sobras = excedentes(await listarArquivos(pasta));
    for (const velho of sobras) await moverParaLixeira(velho.id);

    gravarEstado({ ok: true, quando: new Date().toISOString(), arquivo: nome, tamanho });
    return { nome, tamanho, lixeira: sobras.length };
  } catch (erro) {
    const mensagem = erro instanceof Error ? erro.message : String(erro);
    gravarEstado({ ok: false, quando: new Date().toISOString(), arquivo: nome, erro: mensagem.slice(0, 500) });
    throw erro;
  } finally {
    if (existsSync(cifrado)) unlinkSync(cifrado);
  }
}
