import "dotenv/config";

import { and, eq, inArray, isNull, sql } from "drizzle-orm";

import { db, schema } from "@/db";

import type { Ator } from "./acesso";
import { criarOs } from "./fluxo";
import { descricaoDaOs, FRACAO_MAXIMA_PARADA, usinasParadas } from "./usina-parada";

/**
 * Abre a OS da usina parada, sem ninguém precisar clicar — roda na rodada de
 * hora em hora, logo depois da detecção (`atualizar.ts`). A regra mora em
 * `usina-parada.ts`.
 *
 * A OS nasce "A agendar", sem responsável: quem decide quem vai e quando
 * continua sendo o escritório. O que muda é que ela existe no mesmo dia, e não
 * no fim do mês, quando alguém abre o relatório.
 *
 *   npm run os:automaticas              (abre)
 *   npm run os:automaticas -- --simular (só mostra o que abriria)
 *
 * Desligar: `OS_AUTOMATICA=0` no `.env`.
 */
const SIMULAR = process.argv.includes("--simular");
const ABERTAS = ["aberta", "agendada", "em_deslocamento", "em_andamento", "aguardando_peca"] as const;

async function main() {
  if (process.env.OS_AUTOMATICA === "0") {
    console.log("OS automática desligada (OS_AUTOMATICA=0).");
    return;
  }
  const empresas = await db.query.empresa.findMany({ columns: { id: true, nome: true } });
  for (const empresa of empresas) {
    const alertas = await db
      .select({
        id: schema.alerta.id,
        usinaId: schema.alerta.usinaId,
        abertoEm: schema.alerta.abertoEm,
        mensagem: schema.alerta.mensagem,
      })
      .from(schema.alerta)
      .where(
        and(
          eq(schema.alerta.empresaId, empresa.id),
          eq(schema.alerta.tipo, "offline"),
          eq(schema.alerta.status, "aberto"),
          isNull(schema.alerta.ordemServicoId),
          // Só o que a nossa regra detectou pela geração; o alarme do portal tem código.
          isNull(schema.alerta.codigoFabricante),
          // Usina arquivada no recomeço não gera OS.
          sql`${schema.alerta.usinaId} in (select id from usina where arquivada_em is null)`,
        ),
      );
    const paradas = usinasParadas(alertas);
    if (!paradas.length) {
      console.log(`${empresa.nome}: nenhuma usina parada pedindo OS.`);
      continue;
    }

    const usinas = await db.query.usina.findMany({
      where: and(eq(schema.usina.empresaId, empresa.id), isNull(schema.usina.arquivadaEm)),
      columns: { id: true, nome: true, clienteId: true },
    });
    if (paradas.length > usinas.length * FRACAO_MAXIMA_PARADA) {
      console.log(
        `${empresa.nome}: ${paradas.length} de ${usinas.length} usinas pareceriam paradas ao mesmo tempo — ` +
          "isso é o portal ou a coleta, não as usinas. Nenhuma OS aberta.",
      );
      process.exitCode = 1;
      continue;
    }
    const porId = new Map(usinas.map((u) => [u.id, u]));

    const jaComOs = await db
      .select({ id: schema.ordemServico.id, usinaId: schema.ordemServico.usinaId, numero: schema.ordemServico.numero })
      .from(schema.ordemServico)
      .where(
        and(
          eq(schema.ordemServico.empresaId, empresa.id),
          inArray(
            schema.ordemServico.usinaId,
            paradas.map((p) => p.usinaId),
          ),
          inArray(schema.ordemServico.status, [...ABERTAS]),
        ),
      );
    const osAberta = new Map(jaComOs.map((o) => [o.usinaId!, o]));

    const sistema: Ator = {
      id: "",
      nome: "Monitoramento",
      empresaId: empresa.id,
      papel: "sistema",
      origem: "sistema",
      gestao: true,
    };

    for (const p of paradas) {
      const usina = porId.get(p.usinaId);
      if (!usina) continue;
      const nome = usina.nome;
      const existente = osAberta.get(p.usinaId);
      if (existente) {
        // Já tem gente cuidando: os alertas novos vão para a mesma OS.
        console.log(`  ${nome}: já tem a OS #${String(existente.numero).padStart(4, "0")} aberta — alertas ligados a ela.`);
        if (!SIMULAR) await ligarAlertas(p.alertaIds, existente.id);
        continue;
      }
      if (!usina.clienteId) {
        console.log(`  ${nome}: parada, mas sem dono no cadastro — ligue ao cliente em Monitoramento → Sem dono.`);
        continue;
      }
      if (SIMULAR) {
        console.log(`  ${nome}: abriria OS corretiva (${p.semGeracao ? "sem geração no período" : `${p.dias.length} dias parada`}).`);
        continue;
      }
      const os = await criarOs(sistema, {
        clienteId: usina.clienteId,
        usinaId: usina.id,
        tipo: "corretiva",
        prioridade: "alta",
        descricao: descricaoDaOs(p),
        origem: "alerta",
      });
      await ligarAlertas(p.alertaIds, os.id);
      console.log(`  ${nome}: OS #${String(os.numero).padStart(4, "0")} aberta.`);
    }
  }
}

async function ligarAlertas(ids: string[], osId: string) {
  if (!ids.length) return;
  await db
    .update(schema.alerta)
    .set({ ordemServicoId: osId, status: "reconhecido" })
    .where(inArray(schema.alerta.id, ids));
}

main()
  .catch((e) => {
    console.error("Falhou:", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => process.exit());
