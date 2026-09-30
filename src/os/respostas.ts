import { and, count, eq } from "drizzle-orm";

import { reconciliarSeriais } from "@/collectors/reconciliar";
import { db, schema } from "@/db";
import type { ValorResposta } from "@/db/schema";

import { ErroOs, podeExecutar, type Ator } from "./acesso";
import { encerrada, numeroOs, type TipoResposta } from "./tipos";

type Executor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];
type Item = typeof schema.osChecklistItem.$inferSelect;

/**
 * A resposta de cada item do checklist.
 *
 * O servidor decide se o item está cumprido — nunca aceita o "concluído" pronto
 * do celular. Um item com foto obrigatória só conta quando a foto chegou aqui;
 * um app desatualizado ou adulterado não consegue dar por feito o que não foi.
 */

/** Serial como o portal escreve: maiúsculo e sem espaço — igual a `anotarSerial`. */
export function normalizarSerial(bruto: string): string {
  return bruto.toUpperCase().replace(/\s+/g, "");
}

function numero(bruto: unknown): number {
  if (typeof bruto === "number") return bruto;
  let s = String(bruto).trim();
  // "1.234,5" → 1234.5; "1234.5" continua 1234.5.
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  return Number(s);
}

/** Confere e arruma a resposta conforme o tipo do item. Nulo apaga a resposta. */
export function normalizarValor(
  item: { tipoResposta: string; opcoes: string[] | null; descricao: string },
  bruto: unknown,
): ValorResposta {
  if (bruto === null || bruto === undefined || bruto === "") return null;
  const tipo = item.tipoResposta as TipoResposta;
  const recusa = (frase: string) => new ErroOs("valor_invalido", `${item.descricao}: ${frase}`);

  switch (tipo) {
    case "check":
    case "sim_nao": {
      if (typeof bruto === "boolean") return bruto;
      const s = String(bruto).toLowerCase();
      if (["sim", "true", "1"].includes(s)) return true;
      if (["nao", "não", "false", "0"].includes(s)) return false;
      throw recusa("responda sim ou não.");
    }
    case "numero": {
      const n = numero(bruto);
      if (!Number.isFinite(n) || Math.abs(n) >= 1e9) throw recusa("digite um número.");
      return n;
    }
    case "texto": {
      const s = String(bruto).trim().slice(0, 2000);
      return s || null;
    }
    case "escolha": {
      const s = String(bruto).trim();
      if (item.opcoes?.length && !item.opcoes.includes(s)) throw recusa(`"${s}" não está na lista.`);
      return s || null;
    }
    case "multipla": {
      const lista = (Array.isArray(bruto) ? bruto : String(bruto).split(",")).map((v) =>
        String(v).trim(),
      );
      const validas = [...new Set(lista.filter((v) => v && (!item.opcoes?.length || item.opcoes.includes(v))))];
      return validas.length ? validas : null;
    }
    case "serial": {
      const lista = (Array.isArray(bruto) ? bruto : String(bruto).split(/[\n,;]+/))
        .map((v) => normalizarSerial(String(v)))
        .filter(Boolean);
      for (const s of lista) {
        if (s.length < 4 || s.length > 60 || !/^[A-Z0-9._/-]+$/.test(s)) {
          throw recusa(`"${s}" não parece um número de série.`);
        }
      }
      const unicos = [...new Set(lista)];
      return unicos.length ? unicos : null;
    }
    case "foto":
      return null;
    default:
      throw recusa("tipo de resposta desconhecido.");
  }
}

/** O item está cumprido com esta resposta e esta quantidade de fotos? */
export function cumprido(
  item: { tipoResposta: string; fotosMinimas: number },
  valor: ValorResposta,
  fotos: number,
): boolean {
  const fotosOk = fotos >= item.fotosMinimas;
  switch (item.tipoResposta) {
    case "check":
      return valor === true && fotosOk;
    case "sim_nao":
      return typeof valor === "boolean" && fotosOk;
    case "foto":
      return fotos >= Math.max(1, item.fotosMinimas);
    case "multipla":
    case "serial":
      return Array.isArray(valor) && valor.length > 0 && fotosOk;
    default:
      return valor !== null && valor !== "" && fotosOk;
  }
}

async function contarFotos(executor: Executor, itemId: string): Promise<number> {
  const [linha] = await executor
    .select({ n: count() })
    .from(schema.osAnexo)
    .where(eq(schema.osAnexo.checklistItemId, itemId));
  return Number(linha?.n ?? 0);
}

/** Recalcula o "cumprido" depois que uma foto chega ou sai. */
export async function recalcularItem(executor: Executor, itemId: string): Promise<void> {
  const item = await executor.query.osChecklistItem.findFirst({
    where: eq(schema.osChecklistItem.id, itemId),
  });
  if (!item) return;
  const agora = cumprido(item, item.valor ?? null, await contarFotos(executor, itemId));
  if (agora === item.concluido) return;
  await executor
    .update(schema.osChecklistItem)
    .set({ concluido: agora, concluidoEm: agora ? new Date() : null })
    .where(eq(schema.osChecklistItem.id, itemId));
}

export interface EntradaResposta {
  valor: unknown;
  /** `undefined` mantém a observação; `null` ou vazio apaga. */
  observacao?: string | null;
  /** Hora do celular. Resposta mais velha que a gravada é descartada. */
  respondidoEm?: Date | null;
}

export async function responderItem(
  ator: Ator,
  osId: string,
  itemId: string,
  entrada: EntradaResposta,
): Promise<{ ignorado: boolean; avisos: string[] }> {
  const os = await db.query.ordemServico.findFirst({
    where: and(eq(schema.ordemServico.id, osId), eq(schema.ordemServico.empresaId, ator.empresaId)),
  });
  if (!os) throw new ErroOs("nao_encontrada", "Ordem de serviço não encontrada.", 404);
  if (!podeExecutar(ator, os)) throw new ErroOs("sem_permissao", "Esta OS não é sua.", 403);
  if (encerrada(os.status)) {
    throw new ErroOs("os_encerrada", "A OS já foi encerrada; o checklist não muda mais.", 409);
  }

  const item: Item | undefined = await db.query.osChecklistItem.findFirst({
    where: and(eq(schema.osChecklistItem.id, itemId), eq(schema.osChecklistItem.ordemServicoId, os.id)),
  });
  if (!item) throw new ErroOs("nao_encontrado", "Item do checklist não encontrado.", 404);

  // Sem sinal, o celular guarda a resposta e manda depois. Se alguém já
  // respondeu depois disso — o escritório, ou o próprio técnico noutro
  // aparelho —, a resposta velha não passa por cima da nova.
  if (entrada.respondidoEm && item.respondidoEm && entrada.respondidoEm < item.respondidoEm) {
    return { ignorado: true, avisos: [] };
  }

  const valor = normalizarValor(item, entrada.valor);
  const observacao =
    entrada.observacao === undefined
      ? item.observacao
      : entrada.observacao?.trim().slice(0, 2000) || null;
  const fotos = await contarFotos(db, item.id);
  const ok = cumprido(item, valor, fotos);
  const agora = new Date();

  await db.transaction(async (tx) => {
    await tx
      .update(schema.osChecklistItem)
      .set({
        valor,
        observacao,
        concluido: ok,
        concluidoEm: ok ? (item.concluidoEm ?? agora) : null,
        respondidoPorId: ator.id,
        respondidoEm:
          entrada.respondidoEm && entrada.respondidoEm <= agora ? entrada.respondidoEm : agora,
      })
      .where(eq(schema.osChecklistItem.id, item.id));
    await tx
      .update(schema.ordemServico)
      .set({ atualizadoEm: agora })
      .where(eq(schema.ordemServico.id, os.id));
  });

  const avisos: string[] = [];
  if (item.tipoResposta === "serial" && Array.isArray(valor) && os.projetoId) {
    avisos.push(...(await anotarSeriais(ator, os.projetoId, valor, `${numeroOs(os.numero)} — ${item.descricao}`)));
  }
  return { ignorado: false, avisos };
}

/**
 * O serial respondido no checklist vai para `serial_instalado`, e a usina se
 * liga ao cliente assim que aparecer no portal — o mesmo caminho do campo de
 * serial da tela do projeto.
 *
 * Serial que já está noutro projeto não é gravado: é digitação errada ou
 * inversor remanejado, e quem decide é gente. Vira aviso.
 */
async function anotarSeriais(
  ator: Ator,
  projetoId: string,
  seriais: string[],
  observacao: string,
): Promise<string[]> {
  const avisos: string[] = [];
  let novos = 0;
  for (const numeroSerie of seriais) {
    const existente = await db.query.serialInstalado.findFirst({
      where: and(
        eq(schema.serialInstalado.empresaId, ator.empresaId),
        eq(schema.serialInstalado.numeroSerie, numeroSerie),
      ),
      columns: { projetoId: true },
    });
    if (existente) {
      if (existente.projetoId !== projetoId) {
        avisos.push(`O serial ${numeroSerie} já está anotado em outro projeto — confira a etiqueta.`);
      }
      continue;
    }
    const gravado = await db
      .insert(schema.serialInstalado)
      .values({
        empresaId: ator.empresaId,
        projetoId,
        numeroSerie,
        observacao,
        registradoPor: ator.id,
      })
      .onConflictDoNothing()
      .returning({ id: schema.serialInstalado.id });
    novos += gravado.length;
  }
  if (novos) await reconciliarSeriais(ator.empresaId);
  return avisos;
}
