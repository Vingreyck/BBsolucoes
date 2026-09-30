import type { ValorResposta } from "@/db/schema";

import { formatarRelogio, relogioDoCampo } from "./relogio";
import { numeroOs, RESULTADO_ROTULO } from "./tipos";

/**
 * Como uma resposta do checklist aparece escrita — igual no site e no PDF.
 * Fica fora do relatório para a tela não carregar o módulo do PDF.
 */

export function numeroBr(n: number): string {
  return n.toLocaleString("pt-BR", { maximumFractionDigits: 3 });
}

export interface ItemRespondido {
  tipoResposta: string;
  valor: ValorResposta | null;
  unidade: string | null;
  anexos: unknown[];
}

/** A resposta do item em palavras, como o cliente leria. */
export function textoDaResposta(item: ItemRespondido): string {
  const v = item.valor;
  switch (item.tipoResposta) {
    case "check":
      return v === true ? "Feito" : "Não feito";
    case "sim_nao":
      return v === true ? "Sim" : v === false ? "Não" : "Sem resposta";
    case "numero":
      return typeof v === "number" ? `${numeroBr(v)}${item.unidade ? ` ${item.unidade}` : ""}` : "Sem resposta";
    case "multipla":
    case "serial":
      return Array.isArray(v) && v.length ? v.join(", ") : "Sem resposta";
    case "foto": {
      const n = item.anexos.length;
      return n ? `${n} ${n === 1 ? "foto" : "fotos"}` : "Sem foto";
    }
    default:
      return v === null || v === undefined || v === "" ? "Sem resposta" : String(v);
  }
}

function dataDoCampo(valor: unknown): string {
  return typeof valor === "string" ? formatarRelogio(relogioDoCampo(valor)) : "—";
}

/**
 * O que cada evento do histórico diz, além do rótulo: o motivo, de quem para
 * quem, para quando. O site e o app escrevem com as mesmas palavras.
 */
export function detalheDoEvento(e: { tipo: string; dados: unknown }): string {
  const d = (e.dados ?? {}) as Record<string, unknown>;
  switch (e.tipo) {
    case "criada":
      return d.origem === "alerta" ? "a partir de um alerta" : d.origem === "cliente" ? "a pedido do cliente" : "";
    case "atribuida":
      return d.para ? `${d.de ? `de ${d.de} ` : ""}para ${d.para}` : "responsável removido";
    case "agendada":
      return `para ${dataDoCampo(d.para)}`;
    case "reagendada":
      return `de ${dataDoCampo(d.de)} para ${dataDoCampo(d.para)}${d.motivo ? ` — ${d.motivo}` : ""}`;
    case "pausada":
    case "nao_atendida":
    case "cancelada":
    case "reaberta":
      return d.motivo ? String(d.motivo) : "";
    case "concluida":
      return d.resultado ? (RESULTADO_ROTULO[String(d.resultado)] ?? String(d.resultado)) : "";
    case "esteira":
      return d.etapa ? `para "${d.etapa}"` : "";
    case "editada":
      return Array.isArray(d.campos) ? `mudou ${d.campos.join(", ")}` : "";
    case "retorno":
      return typeof d.numero === "number" ? numeroOs(d.numero) : "";
    default:
      return "";
  }
}
