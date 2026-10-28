import { mkdirSync, readFileSync, statfsSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Saber quando o coletor quebra, sem ninguém precisar abrir o log.
 *
 * Os três problemas de outubro foram achados por acaso: a Growatt parada sem
 * coletar, o token do Drive vencido (o técnico viu as fotos não subirem) e o
 * disco a 100%. Agora cada rodada termina com um "estou vivo" para um monitor
 * externo (Healthchecks.io, `HEALTHCHECK_URL`): se a rodada tiver problema, o
 * aviso vai como falha; se o coletor morrer, o aviso não chega, e o próprio
 * monitor alerta pela ausência.
 *
 * Para não virar ruído, nem toda falha alerta na hora. Portal fora do ar por
 * uma hora acontece (a Growatt bloqueia por frequência); três rodadas seguidas
 * já é problema. Backup, teste de restauração, detecção de usina parada e disco
 * quase cheio alertam na primeira.
 */

export interface ResultadoEtapa {
  nome: string;
  estado: "ok" | "falhou" | "pulada";
  motivo?: string;
  /** Falhou uma vez, alerta. As outras (coleta de portal) só depois de várias seguidas. */
  critica?: boolean;
}

export interface EstadoColetor {
  inicio: string;
  fim: string;
  duracaoS: number;
  resultados: ResultadoEtapa[];
  /** Quantas rodadas seguidas cada etapa falhou — volta a zero quando dá certo. */
  falhasSeguidas: Record<string, number>;
  /** Uso do disco, em %. Nulo quando não deu para medir. */
  disco: number | null;
  alerta: boolean;
  motivos: string[];
}

/** Rodadas seguidas de falha de uma coleta de portal até virar alerta (3 = 3 horas). */
export const SEGUIDAS_PARA_ALERTAR = 3;

/** Acima disto o disco alerta: na VM de 18,5 GB sobra pouco mais de 2 GB. */
export const DISCO_ALERTA = 85;

export const ARQUIVO_ESTADO_COLETOR = join("estado", "coletor.json");

/** Decide se a rodada pede alerta, e por quê. */
export function avaliarRodada(
  resultados: ResultadoEtapa[],
  anteriores: Record<string, number>,
  disco: number | null,
): { falhasSeguidas: Record<string, number>; alerta: boolean; motivos: string[] } {
  const falhasSeguidas: Record<string, number> = { ...anteriores };
  const motivos: string[] = [];
  for (const r of resultados) {
    // Etapa pulada (a noite, sem credencial) não zera nem soma: não tentou.
    if (r.estado === "pulada") continue;
    if (r.estado === "ok") {
      falhasSeguidas[r.nome] = 0;
      continue;
    }
    const vezes = (falhasSeguidas[r.nome] ?? 0) + 1;
    falhasSeguidas[r.nome] = vezes;
    if (r.critica) motivos.push(`${r.nome} falhou`);
    else if (vezes >= SEGUIDAS_PARA_ALERTAR) motivos.push(`${r.nome} falhou ${vezes} rodadas seguidas`);
  }
  if (disco !== null && disco >= DISCO_ALERTA) motivos.push(`disco em ${disco}% — limpe antes que o banco pare de gravar`);
  return { falhasSeguidas, alerta: motivos.length > 0, motivos };
}

/** O uso do disco onde fica `caminho`, como o `df` mostra. Nulo se não der para medir. */
export function usoDoDisco(caminho = "/"): number | null {
  try {
    const s = statfsSync(caminho);
    const usados = s.blocks - s.bfree;
    const total = usados + s.bavail;
    return total > 0 ? Math.round((usados / total) * 100) : null;
  } catch {
    return null;
  }
}

export function lerEstadoColetor(): EstadoColetor | null {
  try {
    return JSON.parse(readFileSync(ARQUIVO_ESTADO_COLETOR, "utf8")) as EstadoColetor;
  } catch {
    return null;
  }
}

export function gravarEstadoColetor(estado: EstadoColetor): void {
  try {
    mkdirSync("estado", { recursive: true });
    writeFileSync(ARQUIVO_ESTADO_COLETOR, JSON.stringify(estado, null, 2));
  } catch (erro) {
    console.warn("Não consegui gravar o estado do coletor:", erro instanceof Error ? erro.message : erro);
  }
}

/**
 * Avisa o monitor externo. `""` = rodada boa, `/start` = começou, `/fail` =
 * rodada com problema (o corpo vira o texto do alerta). Sem `HEALTHCHECK_URL`,
 * não faz nada. Monitor fora do ar nunca derruba a rodada.
 */
export async function avisarMonitor(sufixo: "" | "/start" | "/fail", corpo?: string): Promise<void> {
  const base = process.env.HEALTHCHECK_URL?.trim();
  if (!base) return;
  try {
    await fetch(base.replace(/\/+$/, "") + sufixo, {
      method: corpo ? "POST" : "GET",
      body: corpo,
      signal: AbortSignal.timeout(10_000),
    });
  } catch (erro) {
    console.warn("Não consegui avisar o monitor:", erro instanceof Error ? erro.message : erro);
  }
}
