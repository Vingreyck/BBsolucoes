import { and, asc, eq, gte, inArray, sql } from "drizzle-orm";

import { db, schema } from "@/db";
import { tempoEmCampo } from "@/os/consultas";
import { EVENTO_ROTULO } from "@/os/tipos";

import { casarNasRuas, type Coordenada } from "./ruas";
import { distanciaMetros, limparTrilha } from "./trilha";

/**
 * O que o escritório vê do campo: quem está na rua agora, por onde passou, e
 * quanto rendeu no mês. É a tela "Acompanhamento" do SeeNet, lida pelo site e
 * pelo app de quem é da gestão.
 */

const EM_CAMPO = ["em_deslocamento", "em_andamento"] as const;

function num(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export interface PosicaoAoVivo {
  latitude: number;
  longitude: number;
  precisao: number | null;
  velocidade: number | null;
  bateria: number | null;
  modo: string;
  capturadoEm: string;
}

export interface TecnicoEmCampo {
  ordemId: string;
  numero: number;
  tipo: string;
  status: string;
  prioridade: string;
  cliente: { nome: string; endereco: string | null; cidade: string | null; uf: string | null; telefone: string | null };
  tecnico: { id: string; nome: string } | null;
  /** Desde quando está a caminho, ou atendendo. */
  desde: string | null;
  /** A usina do cliente, quando tem coordenada — o "para onde". */
  destino: Coordenada | null;
  posicao: PosicaoAoVivo | null;
  distanciaDestinoM: number | null;
}

/** Quem está em campo agora — a caminho ou atendendo —, com a última posição de cada um. */
export async function emCampo(empresaId: string): Promise<TecnicoEmCampo[]> {
  const os = schema.ordemServico;
  const p = schema.posicaoAtual;
  const linhas = await db
    .select({
      ordemId: os.id,
      numero: os.numero,
      tipo: os.tipo,
      status: os.status,
      prioridade: os.prioridade,
      clienteNome: schema.cliente.nome,
      logradouro: schema.cliente.logradouro,
      numeroCasa: schema.cliente.numero,
      bairro: schema.cliente.bairro,
      cidade: schema.cliente.cidade,
      uf: schema.cliente.uf,
      telefone: schema.cliente.telefone,
      tecnicoId: schema.usuario.id,
      tecnicoNome: schema.usuario.nome,
      destinoLat: schema.usina.latitude,
      destinoLng: schema.usina.longitude,
      lat: p.latitude,
      lng: p.longitude,
      precisao: p.precisaoM,
      velocidade: p.velocidadeMs,
      bateria: p.bateria,
      modo: p.modo,
      capturadoEm: p.capturadoEm,
    })
    .from(os)
    .innerJoin(schema.cliente, eq(schema.cliente.id, os.clienteId))
    .leftJoin(schema.usuario, eq(schema.usuario.id, os.responsavelId))
    .leftJoin(schema.usina, eq(schema.usina.id, os.usinaId))
    // A posição é da pessoa, mas só vale para esta OS: o técnico que saiu de
    // uma e foi para outra não aparece com o ponto velho na primeira.
    .leftJoin(p, and(eq(p.usuarioId, os.responsavelId), eq(p.ordemServicoId, os.id)))
    .where(and(eq(os.empresaId, empresaId), inArray(os.status, [...EM_CAMPO])));

  const ids = linhas.map((l) => l.ordemId);
  const inicios = ids.length
    ? await db
        .select({
          ordemId: schema.osEvento.ordemServicoId,
          quando: sql<string>`max(${schema.osEvento.ocorridoEm})`,
        })
        .from(schema.osEvento)
        .where(
          and(
            inArray(schema.osEvento.ordemServicoId, ids),
            inArray(schema.osEvento.tipo, ["deslocamento", "iniciada", "retomada"]),
          ),
        )
        .groupBy(schema.osEvento.ordemServicoId)
    : [];
  const desde = new Map(inicios.map((i) => [i.ordemId, new Date(i.quando).toISOString()]));

  return linhas
    .map((l): TecnicoEmCampo => {
      const destinoLat = num(l.destinoLat);
      const destinoLng = num(l.destinoLng);
      const destino = destinoLat !== null && destinoLng !== null ? { latitude: destinoLat, longitude: destinoLng } : null;
      const lat = num(l.lat);
      const lng = num(l.lng);
      const posicao =
        lat !== null && lng !== null && l.capturadoEm
          ? {
              latitude: lat,
              longitude: lng,
              precisao: l.precisao,
              velocidade: l.velocidade,
              bateria: l.bateria,
              modo: l.modo ?? "deslocamento",
              capturadoEm: l.capturadoEm.toISOString(),
            }
          : null;
      const rua = [l.logradouro, l.numeroCasa].filter(Boolean).join(", ");
      return {
        ordemId: l.ordemId,
        numero: l.numero,
        tipo: l.tipo,
        status: l.status,
        prioridade: l.prioridade,
        cliente: {
          nome: l.clienteNome,
          endereco: [rua, l.bairro].filter(Boolean).join(" · ") || null,
          cidade: l.cidade,
          uf: l.uf,
          telefone: l.telefone?.replace(/\D/g, "") || null,
        },
        tecnico: l.tecnicoId && l.tecnicoNome ? { id: l.tecnicoId, nome: l.tecnicoNome } : null,
        desde: desde.get(l.ordemId) ?? null,
        destino,
        posicao,
        distanciaDestinoM:
          posicao && destino
            ? Math.round(distanciaMetros(posicao.latitude, posicao.longitude, destino.latitude, destino.longitude))
            : null,
      };
    })
    // A caminho primeiro (é quem o escritório está esperando), depois o mais recente.
    .sort((a, b) => {
      if (a.status !== b.status) return a.status === "em_deslocamento" ? -1 : 1;
      return (b.desde ?? "").localeCompare(a.desde ?? "");
    });
}

export interface Marco {
  tipo: string;
  titulo: string;
  latitude: number;
  longitude: number;
  ocorridoEm: string;
  precisao: number | null;
}

export interface TrilhaDaOs {
  ordemId: string;
  /** Um risco por trecho contínuo, já colado nas ruas quando deu. */
  trechos: Coordenada[][];
  coladaNasRuas: boolean;
  pontosGravados: number;
  descartados: number;
  /** Onde cada ação foi feita — saiu, chegou, pausou, concluiu. */
  marcos: Marco[];
  destino: Coordenada | null;
  posicao: PosicaoAoVivo | null;
}

/** O trajeto de uma OS, pronto para desenhar. Quem chama confere se a pessoa pode ver. */
export async function trilhaDaOs(empresaId: string, ordemId: string): Promise<TrilhaDaOs | null> {
  const os = await db.query.ordemServico.findFirst({
    where: and(eq(schema.ordemServico.id, ordemId), eq(schema.ordemServico.empresaId, empresaId)),
    columns: { id: true, status: true, responsavelId: true },
    with: {
      usina: { columns: { latitude: true, longitude: true } },
      eventos: {
        columns: { tipo: true, ocorridoEm: true, latitude: true, longitude: true, precisaoM: true },
        orderBy: asc(schema.osEvento.ocorridoEm),
      },
    },
  });
  if (!os) return null;

  const brutos = await db
    .select({
      latitude: schema.posicaoTrilha.latitude,
      longitude: schema.posicaoTrilha.longitude,
      precisao: schema.posicaoTrilha.precisaoM,
      velocidade: schema.posicaoTrilha.velocidadeMs,
      capturadoEm: schema.posicaoTrilha.capturadoEm,
    })
    .from(schema.posicaoTrilha)
    .where(eq(schema.posicaoTrilha.ordemServicoId, ordemId))
    .orderBy(asc(schema.posicaoTrilha.capturadoEm))
    .limit(5000);

  const { trechos, descartados } = limparTrilha(
    brutos.map((b) => ({
      latitude: Number(b.latitude),
      longitude: Number(b.longitude),
      precisao: b.precisao,
      velocidade: b.velocidade,
      capturadoEm: b.capturadoEm,
    })),
  );

  // Cola nas ruas trecho a trecho. Trecho que não cola sai cru — nunca some.
  let coladaNasRuas = false;
  const desenho: Coordenada[][] = [];
  for (const trecho of trechos) {
    const colado = await casarNasRuas(trecho);
    if (colado) {
      coladaNasRuas = true;
      desenho.push(...colado);
    } else {
      desenho.push(trecho.map((p) => ({ latitude: p.latitude, longitude: p.longitude })));
    }
  }

  const marcos: Marco[] = os.eventos
    .filter((e) => e.latitude !== null && e.longitude !== null)
    .map((e) => ({
      tipo: e.tipo,
      titulo: EVENTO_ROTULO[e.tipo] ?? e.tipo,
      latitude: Number(e.latitude),
      longitude: Number(e.longitude),
      precisao: e.precisaoM,
      ocorridoEm: e.ocorridoEm.toISOString(),
    }));

  const destinoLat = num(os.usina?.latitude);
  const destinoLng = num(os.usina?.longitude);

  let posicao: PosicaoAoVivo | null = null;
  if (os.responsavelId && EM_CAMPO.includes(os.status as (typeof EM_CAMPO)[number])) {
    const atual = await db.query.posicaoAtual.findFirst({
      where: and(eq(schema.posicaoAtual.usuarioId, os.responsavelId), eq(schema.posicaoAtual.ordemServicoId, os.id)),
    });
    if (atual) {
      posicao = {
        latitude: Number(atual.latitude),
        longitude: Number(atual.longitude),
        precisao: atual.precisaoM,
        velocidade: atual.velocidadeMs,
        bateria: atual.bateria,
        modo: atual.modo,
        capturadoEm: atual.capturadoEm.toISOString(),
      };
    }
  }

  return {
    ordemId,
    trechos: desenho,
    coladaNasRuas,
    pontosGravados: brutos.length,
    descartados,
    marcos,
    destino: destinoLat !== null && destinoLng !== null ? { latitude: destinoLat, longitude: destinoLng } : null,
    posicao,
  };
}

export interface Produtividade {
  tecnico: { id: string; nome: string };
  concluidas: number;
  osPorDia: number;
  /** Média de "Estou a caminho" até "Cheguei", em minutos. Nulo sem dado. */
  mediaDeslocamentoMin: number | null;
  /** Média do tempo em atendimento (sem as pausas), em minutos. */
  mediaExecucaoMin: number | null;
}

/** Início do mês corrente em Sergipe (UTC−3), como instante. */
export function inicioDoMes(agora: Date = new Date()): Date {
  const local = new Date(agora.getTime() - 3 * 3_600_000);
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), 1, 3, 0, 0));
}

const LIMITE_DESLOCAMENTO_MS = 4 * 3_600_000; // mais que isso é "esqueceu de marcar a chegada"
const LIMITE_EXECUCAO_MS = 12 * 3_600_000;

/** O mês de cada técnico: quantas concluiu, e quanto tempo gasta na estrada e no serviço. */
export async function produtividade(empresaId: string, agora: Date = new Date()): Promise<Produtividade[]> {
  const inicio = inicioDoMes(agora);
  const ordens = await db.query.ordemServico.findMany({
    where: and(
      eq(schema.ordemServico.empresaId, empresaId),
      eq(schema.ordemServico.status, "concluida"),
      gte(schema.ordemServico.concluidaEm, inicio),
    ),
    columns: { id: true },
    with: {
      responsavel: { columns: { id: true, nome: true } },
      eventos: { columns: { tipo: true, ocorridoEm: true }, orderBy: asc(schema.osEvento.ocorridoEm) },
    },
  });

  const dias = Math.max(1, Math.ceil((agora.getTime() - inicio.getTime()) / 86_400_000));
  const porTecnico = new Map<string, { tecnico: { id: string; nome: string }; n: number; desl: number[]; exec: number[] }>();
  for (const o of ordens) {
    if (!o.responsavel) continue;
    const t = porTecnico.get(o.responsavel.id) ?? { tecnico: o.responsavel, n: 0, desl: [], exec: [] };
    t.n++;
    const saida = o.eventos.find((e) => e.tipo === "deslocamento");
    const chegada = saida && o.eventos.find((e) => e.tipo === "iniciada" && e.ocorridoEm >= saida.ocorridoEm);
    if (saida && chegada) {
      const ms = chegada.ocorridoEm.getTime() - saida.ocorridoEm.getTime();
      if (ms > 0 && ms <= LIMITE_DESLOCAMENTO_MS) t.desl.push(ms);
    }
    const exec = tempoEmCampo(o.eventos).ms;
    if (exec > 0 && exec <= LIMITE_EXECUCAO_MS) t.exec.push(exec);
    porTecnico.set(o.responsavel.id, t);
  }

  const media = (l: number[]) => (l.length ? Math.round(l.reduce((a, b) => a + b, 0) / l.length / 60_000) : null);
  return [...porTecnico.values()]
    .map((t) => ({
      tecnico: t.tecnico,
      concluidas: t.n,
      osPorDia: Math.round((t.n / dias) * 10) / 10,
      mediaDeslocamentoMin: media(t.desl),
      mediaExecucaoMin: media(t.exec),
    }))
    .sort((a, b) => b.concluidas - a.concluidas || a.tecnico.nome.localeCompare(b.tecnico.nome));
}
