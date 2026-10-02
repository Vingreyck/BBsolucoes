"use server";

import { and, eq, inArray, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { exigirUsuario } from "@/auth/sessao";
import { db } from "@/db";
import { alerta as alertaTable } from "@/db/schema";

import { abrirOsDoAlerta } from "../os/actions";

/**
 * As ações da tela de alertas valem para um grupo: o detector abre um alerta
 * a cada rodada enquanto a usina segue parada, e a tela junta os repetidos numa linha
 * só ("repetiu 8 vezes"). Reconhecer ou resolver a linha vale para todos eles.
 *
 * Toda ação confere quem está logado e filtra pela empresa dele. A primeira
 * versão não conferia nada — ação de servidor sem essa checagem responde a
 * qualquer um que mande o id certo.
 */

function ids(dados: FormData): string[] {
  return dados
    .getAll("alertaId")
    .map(String)
    .filter((id) => /^[0-9a-f-]{36}$/i.test(id))
    .slice(0, 500);
}

/**
 * Marca que alguém viu o alerta e está cuidando.
 *
 * Reconhecer não é resolver: a usina continua parada. Serve para o resto da
 * equipe parar de tratar como novidade e para saber há quanto tempo alguém
 * sabe do problema sem ter ido lá.
 */
export async function reconhecerAlertas(dados: FormData): Promise<void> {
  const usuario = await exigirUsuario();
  const lista = ids(dados);
  if (!lista.length) return;
  await db
    .update(alertaTable)
    .set({ status: "reconhecido", reconhecidoPorId: usuario.id })
    .where(and(inArray(alertaTable.id, lista), eq(alertaTable.empresaId, usuario.empresaId)));
  revalidatePath("/alertas");
  revalidatePath("/", "layout");
}

export async function resolverAlertas(dados: FormData): Promise<void> {
  const usuario = await exigirUsuario();
  const lista = ids(dados);
  if (!lista.length) return;
  await db
    .update(alertaTable)
    .set({ status: "resolvido", resolvidoEm: new Date() })
    .where(and(inArray(alertaTable.id, lista), eq(alertaTable.empresaId, usuario.empresaId)));
  revalidatePath("/alertas");
  revalidatePath("/", "layout");
}

/**
 * Abre uma OS só para o grupo inteiro e liga todos os alertas a ela — assim,
 * concluir a OS resolve todas as repetições de "inversor offline" de uma vez, e não
 * só o último.
 *
 * Quem abre a OS é `abrirOsDoAlerta` (com as regras dela: só a gestão, usina
 * sem dono vai para a fila de ligação). Ela termina redirecionando, e o
 * redirecionamento é uma exceção: o `finally` liga os outros alertas antes de
 * a exceção seguir.
 */
export async function abrirOsDoGrupo(dados: FormData): Promise<void> {
  const usuario = await exigirUsuario();
  const [maisRecente, ...outros] = ids(dados);
  if (!maisRecente) return;

  try {
    await abrirOsDoAlerta(maisRecente);
  } finally {
    if (outros.length) {
      const principal = await db.query.alerta.findFirst({
        where: and(eq(alertaTable.id, maisRecente), eq(alertaTable.empresaId, usuario.empresaId)),
        columns: { ordemServicoId: true },
      });
      if (principal?.ordemServicoId) {
        await db
          .update(alertaTable)
          .set({ ordemServicoId: principal.ordemServicoId, status: "reconhecido" })
          .where(
            and(
              inArray(alertaTable.id, outros),
              eq(alertaTable.empresaId, usuario.empresaId),
              isNull(alertaTable.ordemServicoId),
            ),
          );
      }
    }
  }
}
