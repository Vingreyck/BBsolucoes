import "dotenv/config";

import { eq, inArray } from "drizzle-orm";

import { db, schema } from "@/db";

import { geracaoDoMes } from "./dados";
import {
  LIMITE_IMPOSSIVEL,
  mesValido,
  numeroBr,
  referenciaDoParque,
  rendimento,
  resumirMes,
  ultimoMesFechado,
} from "./relatorio-mensal";

/**
 * Propõe (e, com `--aplicar`, grava) a potência certa das usinas cuja potência
 * cadastrada não fecha com o que elas geram.
 *
 *   npm run potencia:corrigir                 (só mostra, usando o último mês fechado)
 *   npm run potencia:corrigir -- 2026-10
 *   npm run potencia:corrigir -- 2026-10 --aplicar
 *
 * O defeito principal veio da planilha da Growatt: o importador dividia tudo
 * por mil achando que era watt, e onde já estava em kWp 7 kWp virou 0,007.
 * Para cada usina suspeita, testa nesta ordem e fica com a primeira que faz a
 * usina gerar como as vizinhas no mês (entre 60% e 140% da mediana do parque):
 *
 *   1. ×1000, quando a potência é menor que 0,1 kWp (ninguém tem usina de 100 W);
 *   2. a soma dos inversores cadastrados (o modelo diz "5 kW" sem ambiguidade);
 *   3. ×10 (vírgula no lugar errado: 0,7 em vez de 7).
 *
 * O que nenhuma explica fica listado para conferir à mão, com a potência que a
 * geração sugere — palpite, nunca gravado sozinho.
 */
const APLICAR = process.argv.includes("--aplicar");
const MES = mesValido(process.argv[2]) ? process.argv[2] : ultimoMesFechado();

interface Proposta {
  usinaId: string;
  nome: string;
  atual: number | null;
  nova: number;
  origem: string;
  rendimentoNovo: number;
}

async function main() {
  const empresas = await db.query.empresa.findMany({ columns: { id: true, nome: true } });
  for (const empresa of empresas) {
    const [usinas, geracao] = await Promise.all([
      db.query.usina.findMany({
        where: eq(schema.usina.empresaId, empresa.id),
        columns: { id: true, nome: true, potenciaKwp: true },
      }),
      geracaoDoMes(empresa.id, MES),
    ]);
    const potencia = (u: { potenciaKwp: string | null }) => (u.potenciaKwp ? Number(u.potenciaKwp) : null);
    const regua = referenciaDoParque(usinas.map((u) => rendimento(MES, geracao.get(u.id) ?? [], potencia(u))));
    console.log(`\n${empresa.nome} — ${MES}`);
    if (regua === null) {
      console.log("  Sem usinas suficientes com potência confiável para servir de régua. Nada a propor.");
      continue;
    }
    console.log(`  Régua do mês (mediana do parque): ${numeroBr(regua, 2)} kWh/kWp/dia.`);

    const inversores = await db
      .select({
        usinaId: schema.equipamento.usinaId,
        potenciaW: schema.equipamento.potenciaW,
        quantidade: schema.equipamento.quantidade,
      })
      .from(schema.equipamento)
      .where(inArray(schema.equipamento.tipo, ["inversor", "microinversor"]));
    const somaInversores = new Map<string, number>();
    for (const i of inversores) {
      const w = Number(i.potenciaW);
      if (!Number.isFinite(w) || w <= 0) continue;
      somaInversores.set(i.usinaId, (somaInversores.get(i.usinaId) ?? 0) + (w * (i.quantidade || 1)) / 1000);
    }

    const propostas: Proposta[] = [];
    const aMao: { nome: string; atual: number | null; palpite: number }[] = [];
    for (const u of usinas) {
      const r = resumirMes(MES, geracao.get(u.id) ?? [], potencia(u));
      if (r.diasComDado < 7 || r.mediaDiaKwh === null || r.mediaDiaKwh <= 0) continue;
      const atual = potencia(u);
      const suspeita = atual === null || atual < 0.1 || (r.kwhPorKwpDia ?? 0) > LIMITE_IMPOSSIVEL;
      if (!suspeita) continue;

      const media = r.mediaDiaKwh;
      const plausivel = (kwp: number) => kwp > 0 && media / kwp / regua >= 0.6 && media / kwp / regua <= 1.4;
      const candidatos: [number | undefined, string][] = [
        [atual !== null && atual < 0.1 ? atual * 1000 : undefined, "×1000 (estava em MW)"],
        [somaInversores.get(u.id), "soma dos inversores"],
        [atual !== null ? atual * 10 : undefined, "×10 (vírgula no lugar errado)"],
      ];
      const escolhido = candidatos.find(([kwp]) => kwp !== undefined && plausivel(kwp));
      if (escolhido) {
        const nova = Math.round(escolhido[0]! * 100) / 100;
        propostas.push({ usinaId: u.id, nome: u.nome, atual, nova, origem: escolhido[1], rendimentoNovo: media / nova });
      } else {
        aMao.push({ nome: u.nome, atual, palpite: media / regua });
      }
    }

    if (!propostas.length && !aMao.length) {
      console.log("  Nenhuma potência suspeita.");
      continue;
    }
    if (propostas.length) {
      console.log(`\n  ${propostas.length} correções propostas:`);
      for (const p of propostas) {
        console.log(
          `    ${p.nome}: ${p.atual ?? "vazio"} → ${numeroBr(p.nova, 2)} kWp (${p.origem}; passa a ${numeroBr(p.rendimentoNovo, 1)} kWh/kWp/dia)`,
        );
      }
    }
    if (aMao.length) {
      console.log(`\n  ${aMao.length} para conferir à mão (nenhuma correção automática fecha):`);
      for (const a of aMao) {
        console.log(`    ${a.nome}: ${a.atual ?? "vazio"} kWp — pela geração, algo perto de ${numeroBr(a.palpite, 1)} kWp`);
      }
    }

    if (APLICAR && propostas.length) {
      for (const p of propostas) {
        await db.update(schema.usina).set({ potenciaKwp: String(p.nova) }).where(eq(schema.usina.id, p.usinaId));
      }
      console.log(`\n  ${propostas.length} potências gravadas.`);
    } else if (propostas.length) {
      console.log("\n  Nada foi gravado. Para gravar as correções propostas: npm run potencia:corrigir -- " + MES + " --aplicar");
    }
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => process.exit());
