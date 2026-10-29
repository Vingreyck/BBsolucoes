import { randomUUID } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { usoDoDisco } from "@/sistema/alertas";

/**
 * A sala de espera dos anexos: a foto do técnico fica no disco do servidor por
 * alguns segundos, até subir para o Drive em segundo plano.
 *
 * Antes, o envio do app só terminava depois de o Google aceitar o arquivo. Num
 * dia de Drive lento, cada foto da vistoria levava o tempo do Google, e num dia
 * de Drive fora do ar a foto voltava para a fila do celular. Agora o celular
 * recebe "enviado" assim que o arquivo está aqui, e quem espera o Google é o
 * servidor.
 *
 * O disco da VM é pequeno: com o uso acima de [LIMITE_DISCO]%, nada fica aqui e o
 * envio volta a ser direto para o Drive, como era. O arquivo só existe aqui até
 * subir — não é cópia, nem backup.
 */

export const PASTA_DEPOSITO = process.env.ANEXOS_PENDENTES || "anexos-pendentes";

/** Abaixo do alerta de disco da rota de saúde (85%), com folga para um vídeo de 50 MB. */
export const LIMITE_DISCO = 80;

const PREFIXO = "pendente://";

/** O `caminho` gravado no banco enquanto o arquivo espera o Drive. */
export function caminhoPendente(arquivo: string): string {
  return PREFIXO + arquivo;
}

/** O nome do arquivo no depósito, se o anexo ainda não subiu. Só aceita nome simples. */
export function arquivoPendente(caminho: string | null | undefined): string | null {
  if (!caminho?.startsWith(PREFIXO)) return null;
  const arquivo = caminho.slice(PREFIXO.length);
  return /^[0-9a-f-]{36}\.[a-z0-9]{2,5}$/.test(arquivo) ? arquivo : null;
}

/** Pode guardar aqui? Disco que não dá para medir conta como cheio. */
export function cabeNoDeposito(usoPorcento: number | null): boolean {
  return usoPorcento !== null && usoPorcento < LIMITE_DISCO;
}

/**
 * Grava o arquivo e devolve o nome dele, ou `null` quando não deve ficar aqui
 * (disco cheio, pasta sem permissão) — aí quem chamou manda direto ao Drive.
 */
export function guardarNoDeposito(conteudo: Uint8Array, extensao: string): string | null {
  try {
    mkdirSync(PASTA_DEPOSITO, { recursive: true });
    if (!cabeNoDeposito(usoDoDisco(PASTA_DEPOSITO))) return null;
    const arquivo = `${randomUUID()}${extensao.toLowerCase()}`;
    writeFileSync(join(PASTA_DEPOSITO, arquivo), conteudo, { flag: "wx" });
    return arquivo;
  } catch (e) {
    console.warn("[anexos] não deu para guardar no disco, vai direto ao Drive:", e instanceof Error ? e.message : e);
    return null;
  }
}

export function lerDoDeposito(arquivo: string): Uint8Array | null {
  try {
    return new Uint8Array(readFileSync(join(PASTA_DEPOSITO, arquivo)));
  } catch {
    return null;
  }
}

export function apagarDoDeposito(arquivo: string): void {
  try {
    unlinkSync(join(PASTA_DEPOSITO, arquivo));
  } catch {
    // Já não estava lá.
  }
}

/**
 * Apaga o que sobrou sem dono: arquivo gravado cuja linha no banco nunca nasceu
 * (o servidor caiu no meio do envio). Só os com mais de um dia, para nunca
 * pegar um envio em andamento.
 */
export function limparOrfaos(emUso: Set<string>, agora = Date.now()): number {
  let apagados = 0;
  try {
    for (const arquivo of readdirSync(PASTA_DEPOSITO)) {
      if (emUso.has(arquivo)) continue;
      const caminho = join(PASTA_DEPOSITO, arquivo);
      if (agora - statSync(caminho).mtimeMs > 86_400_000) {
        unlinkSync(caminho);
        apagados++;
      }
    }
  } catch {
    // Pasta ainda não existe: nada a limpar.
  }
  return apagados;
}
