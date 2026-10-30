import { randomBytes } from "node:crypto";

import { and, desc, eq, gte, inArray, isNotNull, isNull, lt, lte, or, sql } from "drizzle-orm";

import { db, schema } from "@/db";

import {
  diasDoMes,
  mesAnterior,
  referenciaDoParque,
  rendimento,
  resumirMes,
  type DiaGerado,
  type ResumoDoMes,
} from "./relatorio-mensal";

/**
 * O que o relatório mensal lê do banco.
 *
 * A geração do dia de uma usina é a **soma dos inversores** quando o portal
 * entrega por equipamento, e a leitura da usina quando entrega só o total —
 * nunca as duas somadas, senão a usina que tem as duas gera em dobro no papel.
 */

function limitesDoMes(mes: string): { inicio: Date; fim: Date } {
  const [a, m] = mes.split("-").map(Number);
  return { inicio: new Date(Date.UTC(a, m - 1, 1)), fim: new Date(Date.UTC(a, m, 1)) };
}

/** Geração por dia de cada usina no mês. */
export async function geracaoDoMes(
  empresaId: string,
  mes: string,
  usinaIds?: string[],
): Promise<Map<string, DiaGerado[]>> {
  const { inicio, fim } = limitesDoMes(mes);
  const l = schema.leitura;
  const linhas = await db
    .select({
      usinaId: l.usinaId,
      dia: sql<string>`(${l.medidoEm} at time zone 'UTC')::date::text`,
      kwh: sql<number | null>`coalesce(
        sum(${l.energiaKwh}) filter (where ${l.equipamentoId} is not null),
        max(${l.energiaKwh}) filter (where ${l.equipamentoId} is null)
      )::float8`,
    })
    .from(l)
    .where(
      and(
        eq(l.empresaId, empresaId),
        eq(l.granularidade, "dia"),
        gte(l.medidoEm, inicio),
        lt(l.medidoEm, fim),
        ...(usinaIds ? [inArray(l.usinaId, usinaIds)] : []),
      ),
    )
    .groupBy(l.usinaId, sql`(${l.medidoEm} at time zone 'UTC')::date`);

  const porUsina = new Map<string, DiaGerado[]>();
  for (const r of linhas) {
    if (r.kwh === null) continue;
    const lista = porUsina.get(r.usinaId) ?? [];
    lista.push({ dia: r.dia, kwh: r.kwh });
    porUsina.set(r.usinaId, lista);
  }
  return porUsina;
}

const reguas = new Map<string, { valor: number | null; quando: number }>();

/**
 * A mediana de kWh/kWp/dia do parque da empresa no mês — a régua do
 * "esperado". Guardada por 10 minutos: o link público de cada cliente a
 * consultaria de novo a cada PDF aberto.
 */
export async function referenciaDoMes(empresaId: string, mes: string): Promise<number | null> {
  const chave = `${empresaId}:${mes}`;
  const ja = reguas.get(chave);
  if (ja && Date.now() - ja.quando < 600_000) return ja.valor;
  const [usinas, geracao] = await Promise.all([
    db.query.usina.findMany({
      where: and(eq(schema.usina.empresaId, empresaId), isNotNull(schema.usina.potenciaKwp)),
      columns: { id: true, potenciaKwp: true },
    }),
    geracaoDoMes(empresaId, mes),
  ]);
  const valor = referenciaDoParque(
    usinas.map((u) => rendimento(mes, geracao.get(u.id) ?? [], Number(u.potenciaKwp))),
  );
  reguas.set(chave, { valor, quando: Date.now() });
  return valor;
}

/** Alertas que estiveram abertos em algum momento do mês, por usina. */
export async function alertasDoMes(empresaId: string, mes: string, usinaIds?: string[]) {
  const { inicio, fim } = limitesDoMes(mes);
  const a = schema.alerta;
  return db
    .select({ usinaId: a.usinaId, tipo: a.tipo, abertoEm: a.abertoEm, resolvidoEm: a.resolvidoEm, mensagem: a.mensagem })
    .from(a)
    .where(
      and(
        eq(a.empresaId, empresaId),
        lt(a.abertoEm, fim),
        or(isNull(a.resolvidoEm), gte(a.resolvidoEm, inicio)),
        ...(usinaIds ? [inArray(a.usinaId, usinaIds)] : []),
      ),
    );
}

/** A tarifa vigente no fim do mês, se alguém cadastrou. Sem ela, o relatório não fala em reais. */
export async function tarifaVigente(empresaId: string, mes: string): Promise<number | null> {
  const { fim } = limitesDoMes(mes);
  const t = schema.tarifa;
  const [linha] = await db
    .select({ valor: t.valorKwh })
    .from(t)
    .where(and(eq(t.empresaId, empresaId), lte(t.vigenciaInicio, fim), or(isNull(t.vigenciaFim), gte(t.vigenciaFim, fim))))
    .orderBy(desc(t.vigenciaInicio))
    .limit(1);
  const v = linha ? Number(linha.valor) : NaN;
  return Number.isFinite(v) && v > 0 ? v : null;
}

export interface LinhaRelatorio {
  usinaId: string;
  usina: string;
  potenciaKwp: number | null;
  clienteId: string;
  cliente: string;
  telefone: string | null;
  resumo: ResumoDoMes;
  totalMesAnterior: number | null;
  alertas: number;
  token: string;
  enviadoEm: Date | null;
  enviadoPor: string | null;
  envios: number;
}

/**
 * As usinas com dono e com algum dado no mês, cada uma com o seu resumo e o
 * link do relatório (criado aqui na primeira vez que a lista abre).
 */
export async function relatoriosDoMes(empresaId: string, mes: string): Promise<LinhaRelatorio[]> {
  const usinas = await db.query.usina.findMany({
    where: and(eq(schema.usina.empresaId, empresaId), isNotNull(schema.usina.clienteId)),
    with: { cliente: { columns: { id: true, nome: true, telefone: true } } },
    columns: { id: true, nome: true, potenciaKwp: true },
  });
  if (!usinas.length) return [];
  const ids = usinas.map((u) => u.id);
  const [doMes, doAnterior, alertas, referencia] = await Promise.all([
    geracaoDoMes(empresaId, mes, ids),
    geracaoDoMes(empresaId, mesAnterior(mes), ids),
    alertasDoMes(empresaId, mes, ids),
    referenciaDoMes(empresaId, mes),
  ]);
  const comDado = usinas.filter((u) => doMes.get(u.id)?.length);
  if (!comDado.length) return [];
  const links = await garantirLinks(empresaId, mes, comDado.map((u) => u.id));

  const alertasPorUsina = new Map<string, number>();
  for (const a of alertas) alertasPorUsina.set(a.usinaId, (alertasPorUsina.get(a.usinaId) ?? 0) + 1);

  return comDado.map((u) => {
    const potencia = u.potenciaKwp ? Number(u.potenciaKwp) : null;
    const anterior = doAnterior.get(u.id);
    const link = links.get(u.id)!;
    return {
      usinaId: u.id,
      usina: u.nome,
      potenciaKwp: potencia,
      clienteId: u.cliente!.id,
      cliente: u.cliente!.nome,
      telefone: u.cliente!.telefone,
      resumo: resumirMes(mes, doMes.get(u.id) ?? [], potencia, referencia),
      totalMesAnterior: anterior?.length ? anterior.reduce((s, d) => s + d.kwh, 0) : null,
      alertas: alertasPorUsina.get(u.id) ?? 0,
      token: link.token,
      enviadoEm: link.enviadoEm,
      enviadoPor: link.enviadoPor,
      envios: link.envios,
    };
  });
}

/** Cria o link que falta (um por usina por mês) e devolve todos. */
async function garantirLinks(empresaId: string, mes: string, usinaIds: string[]) {
  const r = schema.relatorioGeracao;
  const lerTodos = () =>
    db
      .select({
        usinaId: r.usinaId,
        token: r.token,
        enviadoEm: r.enviadoEm,
        envios: r.envios,
        enviadoPor: schema.usuario.nome,
      })
      .from(r)
      .leftJoin(schema.usuario, eq(schema.usuario.id, r.enviadoPorId))
      .where(and(eq(r.empresaId, empresaId), eq(r.mes, mes), inArray(r.usinaId, usinaIds)));
  let existentes = await lerTodos();
  const faltam = usinaIds.filter((id) => !existentes.some((e) => e.usinaId === id));
  if (faltam.length) {
    await db
      .insert(r)
      .values(faltam.map((usinaId) => ({ empresaId, usinaId, mes, token: randomBytes(24).toString("base64url") })))
      .onConflictDoNothing();
    existentes = await lerTodos();
  }
  return new Map(existentes.map((e) => [e.usinaId, e]));
}

/** Tudo o que o PDF precisa, a partir do link público. */
export async function relatorioPeloToken(token: string) {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return null;
  const link = await db.query.relatorioGeracao.findFirst({ where: eq(schema.relatorioGeracao.token, token) });
  if (!link) return null;
  return montarRelatorio(link.empresaId, link.usinaId, link.mes);
}

export async function montarRelatorio(empresaId: string, usinaId: string, mes: string) {
  const usina = await db.query.usina.findFirst({
    where: and(eq(schema.usina.id, usinaId), eq(schema.usina.empresaId, empresaId)),
    with: {
      cliente: { columns: { nome: true } },
      empresa: { columns: { nome: true } },
      vinculosPortal: { with: { contaPortal: { columns: { fabricante: true } } } },
    },
  });
  if (!usina || !usina.cliente) return null;
  const potencia = usina.potenciaKwp ? Number(usina.potenciaKwp) : null;
  const [doMes, doAnterior, alertas, tarifa, referencia] = await Promise.all([
    geracaoDoMes(empresaId, mes, [usinaId]),
    geracaoDoMes(empresaId, mesAnterior(mes), [usinaId]),
    alertasDoMes(empresaId, mes, [usinaId]),
    tarifaVigente(empresaId, mes),
    referenciaDoMes(empresaId, mes),
  ]);
  const anterior = doAnterior.get(usinaId);
  return {
    mes,
    empresa: usina.empresa.nome,
    cliente: usina.cliente.nome,
    usina: usina.nome,
    cidade: [usina.cidade, usina.uf].filter(Boolean).join(" - ") || null,
    potenciaKwp: potencia,
    fabricantes: [...new Set(usina.vinculosPortal.map((v) => v.contaPortal.fabricante))],
    resumo: resumirMes(mes, doMes.get(usinaId) ?? [], potencia, referencia),
    totalMesAnterior: anterior?.length ? anterior.reduce((s, d) => s + d.kwh, 0) : null,
    diasMesAnterior: diasDoMes(mesAnterior(mes)),
    alertas: alertas.map((a) => ({ mensagem: a.mensagem, abertoEm: a.abertoEm, resolvidoEm: a.resolvidoEm })),
    tarifaKwh: tarifa,
  };
}

export type DadosRelatorio = NonNullable<Awaited<ReturnType<typeof montarRelatorio>>>;
