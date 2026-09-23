import "dotenv/config";

import { and, eq, isNull } from "drizzle-orm";

import { db, schema } from "../db";
import { reconciliarSeriais } from "./reconciliar";

/**
 * Passo do `npm run atualizar`: liga usina órfã ao cliente pelo serial.
 *
 * Vem depois das coletas de propósito — o serial só encontra a usina depois
 * que o portal entregou os equipamentos dela.
 *
 *   npm run reconciliar
 */
async function main() {
  const empresa = await db.query.empresa.findFirst();
  if (!empresa) {
    console.error("Nenhuma empresa no banco. Rode `npm run db:seed` primeiro.");
    process.exit(1);
  }

  const r = await reconciliarSeriais(empresa.id);

  if (r.ligadas) {
    console.log(`${r.ligadas} usinas ligadas ao cliente pelo número de série.`);
  }

  if (r.aguardando) {
    /**
     * Serial anotado e sem confirmação do portal é informação, não erro.
     *
     * Logo depois da instalação é o normal: o datalogger leva horas para
     * aparecer. Passando de uma semana costuma ser datalogger que nunca
     * conectou — e essa é a diferença que a coluna `confirmado_em` guarda.
     */
    console.log(
      `${r.aguardando} seriais anotados que o portal ainda não confirmou.`,
    );
  }

  if (r.conflitos.length) {
    console.log(
      `\n${r.conflitos.length} seriais batem com usina de outro cliente.\n` +
        "Nada foi alterado — é digitação errada ou inversor remanejado, e nos\n" +
        "dois casos é para alguém olhar:",
    );
    for (const c of r.conflitos) {
      console.log(`  ${c.serie}: projeto de ${c.projeto} → usina ${c.usina}`);
    }
  }

  const orfas = await db
    .select({ id: schema.usina.id })
    .from(schema.usina)
    .where(
      and(eq(schema.usina.empresaId, empresa.id), isNull(schema.usina.clienteId)),
    );

  if (orfas.length) {
    console.log(
      `\n${orfas.length} usinas continuam sem dono. Essas nunca tiveram serial ` +
        "anotado\ne precisam ser ligadas à mão em /usinas/sem-dono.",
    );
  }

  if (!r.ligadas && !r.aguardando && !r.conflitos.length && !orfas.length) {
    console.log("Nada a reconciliar: toda usina tem dono.");
  }

  process.exit(0);
}

main().catch((erro) => {
  console.error("Falhou:", erro instanceof Error ? erro.message : erro);
  process.exit(1);
});
