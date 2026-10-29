import { numeroOs } from "../os/tipos";

import type { Aviso } from "./fcm";

export type MotivoAviso = "atribuida" | "agendada" | "reagendada" | "cancelada";

const TITULO: Record<MotivoAviso, string> = {
  atribuida: "Nova ordem de serviço",
  agendada: "Ordem de serviço agendada",
  reagendada: "Ordem de serviço reagendada",
  cancelada: "Ordem de serviço cancelada",
};

/** "2026-10-30T14:30" (relógio de Sergipe, como o fluxo grava) → "30/10 14:30". */
export function quandoLegivel(campo: string | null | undefined): string | null {
  const m = campo?.match(/^\d{4}-(\d{2})-(\d{2})T(\d{2}:\d{2})/);
  return m ? `${m[2]}/${m[1]} ${m[3]}` : null;
}

/** O texto do aviso. Pura, para conferir nos testes. */
export function textoDoAviso(
  motivo: MotivoAviso,
  os: { numero: number; urgente: boolean; cliente?: string | null; quando?: string | null },
): Aviso & { dados: Record<string, string> } {
  const partes = [numeroOs(os.numero), os.cliente, os.quando].filter(Boolean);
  return {
    titulo: os.urgente && motivo === "atribuida" ? "OS urgente para você" : TITULO[motivo],
    corpo: partes.join(" · "),
    dados: { tipo: "os", motivo },
  };
}
