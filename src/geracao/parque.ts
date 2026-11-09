import { eq, max } from "drizzle-orm";

import { db, schema } from "@/db";

import { geracaoNoPeriodo } from "./dados";

/**
 * A geração do parque inteiro, para o Início: os últimos dias completos, dia a
 * dia, e o que hoje já gerou.
 *
 * A regra é a do relatório mensal (`dados.ts`): por usina, a soma dos
 * inversores quando o portal entrega por equipamento, senão a leitura da
 * usina; só depois se soma o parque. O dia é o de Sergipe, porque os coletores
 * gravam a leitura do dia ao meio-dia UTC daquela data.
 */

const FUSO = "America/Maceio";

/**
 * O Início abre muitas vezes por dia, e os coletores só trazem dado novo de
 * meia em meia hora. Cinco minutos de memória poupam o banco sem a tela ficar
 * velha.
 */
const GUARDAR_MS = 5 * 60_000;

export interface DiaDoParque {
  /** AAAA-MM-DD */
  dia: string;
  /** `null`: nenhuma usina mandou leitura nesse dia. */
  kwh: number | null;
}

export interface GeracaoDoParque {
  /** Os dias completos, do mais antigo até ontem. */
  dias: DiaDoParque[];
  total: number;
  /** O que hoje já gerou: o dia ainda não terminou, por isso fica fora do gráfico. */
  hoje: number | null;
  mediaDia: number | null;
  melhorDia: DiaDoParque | null;
  /** kWh por kWp por dia, só das usinas com potência cadastrada. */
  rendimento: number | null;
  usinas: number;
  ultimaColeta: Date | null;
}

/** AAAA-MM-DD de hoje em Sergipe (en-CA já escreve nesse formato). */
export function hojeEmSergipe(agora = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: FUSO,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(agora);
}

function somarDias(dia: string, n: number): string {
  const d = new Date(`${dia}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Um por empresa: a chave muda com o dia, e o de ontem é substituído, não acumulado. */
const guardados = new Map<string, { chave: string; valor: GeracaoDoParque; quando: number }>();

export async function geracaoDoParque(empresaId: string, quantosDias = 30): Promise<GeracaoDoParque> {
  const hoje = hojeEmSergipe();
  const chave = `${quantosDias}:${hoje}`;
  const ja = guardados.get(empresaId);
  if (ja && ja.chave === chave && Date.now() - ja.quando < GUARDAR_MS) return ja.valor;

  const [usinas, [coleta]] = await Promise.all([
    db.query.usina.findMany({
      where: eq(schema.usina.empresaId, empresaId),
      columns: { id: true, potenciaKwp: true },
    }),
    db
      .select({ quando: max(schema.contaPortal.ultimaColetaEm) })
      .from(schema.contaPortal)
      .where(eq(schema.contaPortal.empresaId, empresaId)),
  ]);

  // Pelos ids das usinas, para o banco usar o índice (usina, granularidade, instante).
  const porUsina = usinas.length
    ? await geracaoNoPeriodo(
        empresaId,
        new Date(`${somarDias(hoje, -quantosDias)}T00:00:00Z`),
        new Date(`${somarDias(hoje, 1)}T00:00:00Z`),
        usinas.map((u) => u.id),
      )
    : new Map<string, { dia: string; kwh: number }[]>();

  const potencia = new Map(usinas.map((u) => [u.id, u.potenciaKwp ? Number(u.potenciaKwp) : 0]));
  const somaDoDia = new Map<string, number>();
  let kwhComPotencia = 0;
  let kwpVezesDias = 0;
  for (const [usinaId, dias] of porUsina) {
    const kwp = potencia.get(usinaId) ?? 0;
    for (const d of dias) {
      somaDoDia.set(d.dia, (somaDoDia.get(d.dia) ?? 0) + d.kwh);
      if (d.dia !== hoje && kwp > 0) {
        kwhComPotencia += d.kwh;
        kwpVezesDias += kwp;
      }
    }
  }

  const dias: DiaDoParque[] = [];
  for (let i = quantosDias; i >= 1; i--) {
    const dia = somarDias(hoje, -i);
    dias.push({ dia, kwh: somaDoDia.get(dia) ?? null });
  }
  const comDado = dias.filter((d): d is { dia: string; kwh: number } => d.kwh !== null);
  const total = comDado.reduce((s, d) => s + d.kwh, 0);
  const melhorDia = comDado.reduce<DiaDoParque | null>((m, d) => (!m || d.kwh > (m.kwh ?? 0) ? d : m), null);

  const valor: GeracaoDoParque = {
    dias,
    total,
    hoje: somaDoDia.get(hoje) ?? null,
    mediaDia: comDado.length ? total / comDado.length : null,
    melhorDia,
    rendimento: kwpVezesDias > 0 ? kwhComPotencia / kwpVezesDias : null,
    usinas: usinas.length,
    ultimaColeta: coleta?.quando ?? null,
  };
  guardados.set(empresaId, { chave, valor, quando: Date.now() });
  return valor;
}
