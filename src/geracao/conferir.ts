import "dotenv/config";

import { and, eq, isNotNull } from "drizzle-orm";

import { db, schema } from "@/db";

import { geracaoDoMes, referenciaDoMes } from "./dados";
import { mesValido, numeroBr, resumirMes, ultimoMesFechado } from "./relatorio-mensal";

/**
 * Confere o relatório mensal contra o banco de verdade, sem gravar nada e sem
 * mandar nada: quantas usinas teriam relatório, quantas abaixo do esperado, e
 * as que parecem estranhas (geração impossível para o tamanho, potência
 * faltando) — para olhar antes de o primeiro PDF ir a um cliente.
 *
 *   npm run relatorio:conferir            (o último mês fechado)
 *   npm run relatorio:conferir -- 2026-10
 */
async function main() {
  const mes = mesValido(process.argv[2]) ? process.argv[2] : ultimoMesFechado();
  const empresas = await db.query.empresa.findMany({ columns: { id: true, nome: true } });
  for (const empresa of empresas) {
    const usinas = await db.query.usina.findMany({
      where: and(eq(schema.usina.empresaId, empresa.id), isNotNull(schema.usina.clienteId)),
      columns: { id: true, nome: true, potenciaKwp: true },
    });
    const [geracao, regua] = await Promise.all([geracaoDoMes(empresa.id, mes), referenciaDoMes(empresa.id, mes)]);
    const resumos = usinas
      .map((u) => ({ u, r: resumirMes(mes, geracao.get(u.id) ?? [], u.potenciaKwp ? Number(u.potenciaKwp) : null, regua) }))
      .filter((x) => x.r.diasComDado > 0);

    const conta = (f: string | null) => resumos.filter((x) => x.r.faixa === f).length;
    console.log(`\n${empresa.nome} — ${mes}`);
    console.log(`  ${usinas.length} usinas com dono; ${resumos.length} com dado no mês (estas teriam relatório).`);
    console.log(`  régua do mês (mediana do parque): ${regua !== null ? `${numeroBr(regua, 2)} kWh/kWp/dia` : "sem parque suficiente"}`);
    console.log(`  normal ${conta("dentro")} · abaixo ${conta("abaixo")} · potência a conferir ${conta("suspeita")} · sem avaliação ${conta(null)}`);
    const total = resumos.reduce((s, x) => s + x.r.totalKwh, 0);
    console.log(`  geração somada: ${numeroBr(total)} kWh`);

    // Acima de 8 kWh/kWp/dia não existe em Sergipe: é potência errada (ver `npm run potencia:corrigir`).
    const impossiveis = resumos.filter((x) => x.r.faixa === "suspeita");
    if (impossiveis.length) {
      console.log("  Potência a conferir (o relatório sai sem avaliação; corrija com npm run potencia:corrigir):");
      for (const { u, r } of impossiveis) {
        console.log(`    ${u.nome}: ${numeroBr(r.kwhPorKwpDia ?? 0, 1)} kWh/kWp/dia (${u.potenciaKwp ?? "?"} kWp)`);
      }
    }
    const abaixo = resumos.filter((x) => x.r.faixa === "abaixo").sort((a, b) => (a.r.kwhPorKwpDia ?? 0) - (b.r.kwhPorKwpDia ?? 0));
    if (abaixo.length) {
      console.log("  Abaixo do esperado (o relatório vai dizer que a equipe verifica):");
      for (const { u, r } of abaixo.slice(0, 15)) {
        console.log(`    ${u.nome}: ${numeroBr(r.kwhPorKwpDia ?? 0, 1)} kWh/kWp/dia, ${r.diasSemDado} dias sem dado`);
      }
    }
    const semPotencia = resumos.filter((x) => !x.u.potenciaKwp).length;
    if (semPotencia) console.log(`  ${semPotencia} sem potência cadastrada: o relatório sai sem a avaliação de desempenho.`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => process.exit());
