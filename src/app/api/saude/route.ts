import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { sql } from "drizzle-orm";

import { db } from "@/db";
import { lerEstadoEnvio } from "@/db/backup-remoto";
import { senhaDoBackup } from "@/db/cofre-backup";
import { accessToken, driveConfigurado } from "@/documentos/drive";
import { lerEstadoColetor, usoDoDisco } from "@/sistema/alertas";
import {
  verificarBackupExterno,
  verificarBackupLocal,
  verificarColetor,
  verificarDisco,
  type Verificacao,
} from "@/sistema/saude";

export const dynamic = "force-dynamic";

/**
 * A saúde do sistema, para um monitor externo.
 *
 *   GET /api/saude → 200 se tudo bem, 503 se algo precisa de atenção
 *
 * Sem login de propósito: o monitor não tem sessão. Por isso o corpo só diz o
 * nome de cada verificação e uma frase curta — nada de endereço, credencial ou
 * dado de cliente. O Drive é conferido no máximo a cada 5 minutos, para um
 * monitor chamando de minuto em minuto não virar uma consulta ao Google por
 * minuto.
 */

let driveCache: { quando: number; resultado: Verificacao } | null = null;

async function verificarBanco(): Promise<Verificacao> {
  try {
    await Promise.race([
      db.execute(sql`select 1`),
      new Promise((_, rejeitar) => setTimeout(() => rejeitar(new Error("demorou")), 5_000)),
    ]);
    return { nome: "banco", ok: true, detalhe: "respondendo" };
  } catch {
    return { nome: "banco", ok: false, detalhe: "não respondeu" };
  }
}

async function verificarDrive(): Promise<Verificacao> {
  if (driveCache && Date.now() - driveCache.quando < 300_000) return driveCache.resultado;
  let resultado: Verificacao;
  if (!driveConfigurado()) {
    resultado = { nome: "drive", ok: false, detalhe: "não configurado" };
  } else {
    try {
      await Promise.race([
        accessToken(),
        new Promise((_, rejeitar) => setTimeout(() => rejeitar(new Error("demorou")), 8_000)),
      ]);
      resultado = { nome: "drive", ok: true, detalhe: "autorizado" };
    } catch {
      // O texto do erro pode ter detalhe da credencial: fica no log, não na resposta.
      resultado = { nome: "drive", ok: false, detalhe: "o Google recusou a autorização — veja o log do site" };
    }
  }
  driveCache = { quando: Date.now(), resultado };
  return resultado;
}

function copiaLocalMaisNova(): number | null {
  try {
    const tempos = readdirSync("backups")
      .filter((n) => n.startsWith("selebi-") && n.endsWith(".sql.gz"))
      .map((n) => statSync(join("backups", n)).mtimeMs);
    return tempos.length ? Math.max(...tempos) : null;
  } catch {
    return null;
  }
}

export async function GET() {
  const verificacoes = [
    await verificarBanco(),
    await verificarDrive(),
    verificarColetor(lerEstadoColetor()),
    verificarBackupLocal(copiaLocalMaisNova()),
    verificarBackupExterno(Boolean(senhaDoBackup()), lerEstadoEnvio()),
    verificarDisco(usoDoDisco("/")),
  ];
  const ok = verificacoes.every((v) => v.ok);
  return Response.json(
    { status: ok ? "ok" : "atencao", verificacoes },
    { status: ok ? 200 : 503, headers: { "cache-control": "no-store", "x-robots-tag": "noindex" } },
  );
}
