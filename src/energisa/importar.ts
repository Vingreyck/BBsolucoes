import { revalidatePath } from "next/cache";

import { db, schema } from "@/db";
import type { Ator } from "@/os/acesso";

import { sincronizar } from "./sincronizar";

export type ResultadoImportacao =
  | { ok: true; texto: string; mudaram: number; movidos: string[] }
  | { ok: false; erro: string };

/**
 * A lista "Meus projetos" do portal da Energisa, venha do favorito (um clique)
 * ou da extensão do Chrome (sozinha, a cada 30 min): grava, vincula, faz a
 * esteira reagir e avisa o Healthchecks — se ninguém atualizar, é ele que
 * manda o e-mail.
 */
export async function registrarLista(
  ator: Ator,
  lista: unknown,
  via: "favorito" | "extensao",
): Promise<ResultadoImportacao> {
  if (!Array.isArray(lista) || lista.length === 0) return { ok: false, erro: "A lista chegou vazia." };
  if (lista.length > 5000) return { ok: false, erro: "A lista é grande demais para ser a do portal." };
  const crus = lista.filter((x): x is Record<string, unknown> => Boolean(x) && typeof x === "object");

  const resumo = await sincronizar(ator.empresaId, crus);
  const partes = [`${resumo.lidos} projetos lidos`];
  if (resumo.novos) partes.push(`${resumo.novos} novos`);
  if (resumo.mudaram) partes.push(`${resumo.mudaram} mudaram de situação`);
  if (resumo.vinculados) partes.push(`${resumo.vinculados} vinculados`);
  if (resumo.movidos.length) partes.push(`movidos na esteira: ${resumo.movidos.join(", ")}`);
  const texto = partes.join(" · ");

  const quem = primeiroNome(ator);
  await gravarEstado(ator.empresaId, {
    estado: "conectado",
    mensagem: via === "extensao" ? `${texto} — automático, pelo Chrome de ${quem}` : `${texto} — enviado por ${quem}`,
    ultimaLeituraEm: new Date(),
    totalProjetos: resumo.lidos,
  });

  const check = process.env.ENERGISA_HEALTHCHECK_URL?.trim();
  if (check) {
    await fetch(check, { method: "POST", body: texto, signal: AbortSignal.timeout(8_000) }).catch(() => undefined);
  }

  revalidatePath("/energisa");
  revalidatePath("/esteira");
  return { ok: true, texto, mudaram: resumo.mudaram, movidos: resumo.movidos };
}

/**
 * A extensão leu o portal e a lista é a mesma do último envio: só anota a hora
 * e avisa o Healthchecks, sem regravar nada. É o caso de quase toda leitura.
 */
export async function registrarSemMudanca(ator: Ator, total: unknown): Promise<ResultadoImportacao> {
  const n = typeof total === "number" && Number.isFinite(total) ? Math.trunc(total) : null;
  const texto = `Lista conferida, nada mudou${n !== null ? ` (${n} projetos)` : ""}`;
  await gravarEstado(ator.empresaId, {
    estado: "conectado",
    mensagem: `${texto} — automático, pelo Chrome de ${primeiroNome(ator)}`,
    ultimaLeituraEm: new Date(),
    ...(n !== null ? { totalProjetos: n } : {}),
  });
  const check = process.env.ENERGISA_HEALTHCHECK_URL?.trim();
  if (check) {
    await fetch(check, { method: "POST", body: texto, signal: AbortSignal.timeout(8_000) }).catch(() => undefined);
  }
  revalidatePath("/energisa");
  return { ok: true, texto, mudaram: 0, movidos: [] };
}

/** A extensão viu o portal sair da conta: fica em /energisa até a próxima leitura boa. */
export async function registrarPortalDeslogado(ator: Ator): Promise<void> {
  const hora = new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });
  await gravarEstado(ator.empresaId, {
    estado: "desconectado",
    mensagem: `O portal da Energisa saiu da conta no Chrome de ${primeiroNome(ator)} às ${hora}. Entre de novo (CPF e código do SMS) e a atualização automática volta sozinha.`,
  });
  revalidatePath("/energisa");
}

function primeiroNome(ator: Ator): string {
  return ator.nome.split(" ")[0];
}

async function gravarEstado(
  empresaId: string,
  campos: { estado: string; mensagem: string; ultimaLeituraEm?: Date; totalProjetos?: number },
): Promise<void> {
  const valores = { ...campos, atualizadoEm: new Date() };
  await db
    .insert(schema.roboEnergisa)
    .values({ empresaId, ...valores })
    .onConflictDoUpdate({ target: schema.roboEnergisa.empresaId, set: valores });
}
