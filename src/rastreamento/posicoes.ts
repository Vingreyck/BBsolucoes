import { and, desc, eq, inArray, lt, sql } from "drizzle-orm";

import { db, schema } from "@/db";
import { podeExecutar, type Ator } from "@/os/acesso";

import { publicar } from "./hub";
import { coordenadaValida, deveGravar, type Ponto } from "./trilha";

/**
 * As posições que o celular manda durante o atendimento.
 *
 * Chegam em lote (a cada 10 s andando, a cada minuto no local) e às vezes com
 * horas de atraso — o celular sem sinal guarda e manda quando volta. Por isso
 * a hora que vale é a do celular (`capturadoEm`), e a posição atual só é
 * trocada por uma mais nova: o lote atrasado alimenta a trilha, mas não
 * "volta" o técnico no mapa para onde ele estava de manhã.
 */

export type Modo = "deslocamento" | "eco";

export interface PontoRecebido extends Ponto {
  ordemId: string;
  precisao: number | null;
  velocidade: number | null;
  bateria: number | null;
  modo: Modo;
}

/** Teto por envio: o celular que ficou uma tarde sem sinal manda em vários. */
export const PONTOS_POR_ENVIO = 300;
/** Ponto mais velho que isto não é mais "rastreamento" — é lixo esquecido no celular. */
const IDADE_MAXIMA_MS = 7 * 86_400_000;
/** Relógio de celular adiantado não grava ponto no futuro. */
const FOLGA_FUTURO_MS = 5 * 60_000;
/** A trilha fica 30 dias; o GPS de cada ação da OS fica para sempre no histórico. */
export const RETENCAO_TRILHA_DIAS = 30;
/** A última posição de quem saiu de campo some no mesmo dia. */
const RETENCAO_ATUAL_MS = 12 * 3_600_000;

const EM_CAMPO = new Set(["em_deslocamento", "em_andamento"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function numero(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Um ponto do JSON do celular, conferido. Nulo se não prestar. */
export function normalizarPonto(bruto: unknown, agora: Date = new Date()): PontoRecebido | null {
  if (!bruto || typeof bruto !== "object") return null;
  const b = bruto as Record<string, unknown>;
  const ordemId = typeof b.ordemId === "string" && UUID.test(b.ordemId) ? b.ordemId.toLowerCase() : null;
  const latitude = numero(b.latitude);
  const longitude = numero(b.longitude);
  if (!ordemId || latitude === null || longitude === null || !coordenadaValida(latitude, longitude)) return null;

  const quando = typeof b.capturadoEm === "string" ? new Date(b.capturadoEm) : null;
  if (!quando || Number.isNaN(quando.getTime())) return null;
  if (agora.getTime() - quando.getTime() > IDADE_MAXIMA_MS) return null;
  const capturadoEm = quando.getTime() > agora.getTime() + FOLGA_FUTURO_MS ? agora : quando;

  const precisao = numero(b.precisao);
  const velocidade = numero(b.velocidade);
  const bateria = numero(b.bateria);
  return {
    ordemId,
    latitude,
    longitude,
    precisao: precisao !== null && precisao >= 0 ? precisao : null,
    velocidade: velocidade !== null && velocidade >= 0 ? velocidade : null,
    bateria: bateria !== null && bateria >= 0 && bateria <= 100 ? Math.round(bateria) : null,
    modo: b.modo === "eco" ? "eco" : "deslocamento",
    capturadoEm,
  };
}

export interface ResultadoRegistro {
  aceitos: number;
  naTrilha: number;
  /** De OS que não é desta pessoa (ou não existe mais). */
  recusados: number;
  /** A posição atual mudou (e o mapa do escritório foi avisado). */
  atualizou: boolean;
}

const coordenada = (v: number) => v.toFixed(7);

export async function registrarPosicoes(
  ator: Ator,
  pontos: PontoRecebido[],
  agora: Date = new Date(),
): Promise<ResultadoRegistro> {
  if (!pontos.length) return { aceitos: 0, naTrilha: 0, recusados: 0, atualizou: false };

  // Só OS desta empresa que esta pessoa pode executar. Ponto de OS alheia é
  // descartado em silêncio: o celular não tem o que fazer com a recusa.
  const ids = [...new Set(pontos.map((p) => p.ordemId))];
  const ordens = await db.query.ordemServico.findMany({
    where: and(eq(schema.ordemServico.empresaId, ator.empresaId), inArray(schema.ordemServico.id, ids)),
    columns: { id: true, responsavelId: true, status: true },
  });
  const permitidas = new Map(ordens.filter((o) => podeExecutar(ator, o)).map((o) => [o.id, o]));
  const validos = pontos
    .filter((p) => permitidas.has(p.ordemId))
    .sort((a, b) => a.capturadoEm.getTime() - b.capturadoEm.getTime());

  // --- trilha: cada OS contra o último ponto gravado dela
  const inserir: (typeof schema.posicaoTrilha.$inferInsert)[] = [];
  for (const ordemId of new Set(validos.map((p) => p.ordemId))) {
    const [ultimo] = await db
      .select({ capturadoEm: schema.posicaoTrilha.capturadoEm })
      .from(schema.posicaoTrilha)
      .where(eq(schema.posicaoTrilha.ordemServicoId, ordemId))
      .orderBy(desc(schema.posicaoTrilha.capturadoEm))
      .limit(1);
    let referencia: { capturadoEm: Date } | null = ultimo ?? null;
    for (const p of validos) {
      if (p.ordemId !== ordemId || !deveGravar(referencia, p)) continue;
      inserir.push({
        empresaId: ator.empresaId,
        usuarioId: ator.id,
        ordemServicoId: ordemId,
        latitude: coordenada(p.latitude),
        longitude: coordenada(p.longitude),
        precisaoM: p.precisao === null ? null : Math.round(p.precisao),
        velocidadeMs: p.velocidade,
        capturadoEm: p.capturadoEm,
      });
      referencia = { capturadoEm: p.capturadoEm };
    }
  }
  if (inserir.length) await db.insert(schema.posicaoTrilha).values(inserir);

  // --- posição atual: o ponto mais novo de uma OS que está em campo agora
  const emCampo = validos.filter((p) => {
    const os = permitidas.get(p.ordemId)!;
    return EM_CAMPO.has(os.status) && (os.responsavelId === ator.id || os.responsavelId === null);
  });
  const maisNovo = emCampo.at(-1);
  let atualizou = false;
  if (maisNovo) {
    const valores = {
      empresaId: ator.empresaId,
      ordemServicoId: maisNovo.ordemId,
      latitude: coordenada(maisNovo.latitude),
      longitude: coordenada(maisNovo.longitude),
      precisaoM: maisNovo.precisao === null ? null : Math.round(maisNovo.precisao),
      velocidadeMs: maisNovo.velocidade,
      bateria: maisNovo.bateria,
      modo: maisNovo.modo,
      capturadoEm: maisNovo.capturadoEm,
      recebidoEm: agora,
    };
    const gravado = await db
      .insert(schema.posicaoAtual)
      .values({ usuarioId: ator.id, ...valores })
      .onConflictDoUpdate({
        target: schema.posicaoAtual.usuarioId,
        set: valores,
        // Lote atrasado não passa por cima de posição mais nova.
        setWhere: sql`${schema.posicaoAtual.capturadoEm} <= excluded.capturado_em`,
      })
      .returning({ usuarioId: schema.posicaoAtual.usuarioId });
    atualizou = gravado.length > 0;
    if (atualizou) {
      publicar(ator.empresaId, {
        tipo: "posicao",
        ordemId: maisNovo.ordemId,
        usuarioId: ator.id,
        latitude: maisNovo.latitude,
        longitude: maisNovo.longitude,
        precisao: maisNovo.precisao,
        velocidade: maisNovo.velocidade,
        bateria: maisNovo.bateria,
        modo: maisNovo.modo,
        capturadoEm: maisNovo.capturadoEm.toISOString(),
      });
    }
  }

  faxina(agora);
  return { aceitos: validos.length, naTrilha: inserir.length, recusados: pontos.length - validos.length, atualizou };
}

/**
 * Apaga o que passou do prazo, no máximo uma vez por hora — sem depender do
 * coletor, que roda noutro container e não tem nada a ver com rastreamento.
 */
function faxina(agora: Date): void {
  const estado = ((globalThis as Record<string, unknown>).__selebiFaxinaCampo ??= { ultima: 0 }) as { ultima: number };
  if (agora.getTime() - estado.ultima < 3_600_000) return;
  estado.ultima = agora.getTime();
  void (async () => {
    try {
      await db
        .delete(schema.posicaoTrilha)
        .where(lt(schema.posicaoTrilha.capturadoEm, new Date(agora.getTime() - RETENCAO_TRILHA_DIAS * 86_400_000)));
      await db
        .delete(schema.posicaoAtual)
        .where(lt(schema.posicaoAtual.capturadoEm, new Date(agora.getTime() - RETENCAO_ATUAL_MS)));
    } catch (e) {
      console.warn("Faxina do rastreamento falhou:", e instanceof Error ? e.message : e);
    }
  })();
}
