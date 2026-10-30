"use server";

import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { db, schema } from "@/db";
import { exigirGestaoWeb } from "@/os/acesso";

/** Anota que o relatório do mês foi mandado ao cliente (o WhatsApp já abriu no navegador). */
export async function registrarEnvioRelatorio(usinaId: string, mes: string): Promise<void> {
  const ator = await exigirGestaoWeb();
  await db
    .update(schema.relatorioGeracao)
    .set({ enviadoEm: new Date(), enviadoPorId: ator.id, envios: sql`${schema.relatorioGeracao.envios} + 1` })
    .where(
      and(
        eq(schema.relatorioGeracao.empresaId, ator.empresaId),
        eq(schema.relatorioGeracao.usinaId, usinaId),
        eq(schema.relatorioGeracao.mes, mes),
      ),
    );
  revalidatePath("/relatorios");
}

/**
 * A potência que faltava (ou estava errada) no cadastro, direto da linha do
 * relatório. Quem preenche confere no projeto ou na ART — o palpite que a tela
 * mostra, tirado da geração, é só dica e nunca é gravado sozinho.
 */
export async function salvarPotencia(usinaId: string, form: FormData): Promise<void> {
  const ator = await exigirGestaoWeb();
  const kwp = Number(String(form.get("potenciaKwp") ?? "").replace(",", "."));
  // De 300 W (micro) a 5 MW: fora disso é digitação errada.
  if (!Number.isFinite(kwp) || kwp < 0.3 || kwp > 5000) return;
  await db
    .update(schema.usina)
    .set({ potenciaKwp: String(Math.round(kwp * 1000) / 1000) })
    .where(and(eq(schema.usina.id, usinaId), eq(schema.usina.empresaId, ator.empresaId)));
  revalidatePath("/relatorios");
}
