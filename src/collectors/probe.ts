import "dotenv/config";

import { writeFileSync } from "node:fs";

import { GrowattColetor } from "./growatt/collector";

/**
 * Primeiro contato com a conta real.
 *
 * Não grava nada no banco. O trabalho aqui é descobrir o que a API de sessão da
 * Growatt devolve de fato para uma conta de distribuidor com 137 usinas — quais
 * campos existem, como o status vem escrito, se a lista é paginada. Só depois
 * disso o mapeamento em `collector.ts` para de ser hipótese.
 *
 *   npm run probe:growatt
 */
async function main() {
  const usuario = process.env.GROWATT_USER;
  const senha = process.env.GROWATT_PASSWORD;

  if (!usuario || !senha) {
    console.error(
      "Faltam GROWATT_USER e GROWATT_PASSWORD no .env.\n" +
        "Copie .env.example para .env e preencha — nunca commite esse arquivo.",
    );
    process.exit(1);
  }

  const coletor = new GrowattColetor(usuario, senha, {
    debug: true,
    // Só fixa o host se você quiser forçar um; senão o cliente varre a lista.
    base: process.env.GROWATT_BASE_URL || undefined,
  });

  console.log("Autenticando...");
  await coletor.autenticar();
  console.log(`Login OK em ${coletor.host}\n`);

  console.log("Buscando usinas...");
  const usinas = await coletor.listarUsinas();
  console.log(`${usinas.length} usinas reconhecidas.\n`);

  const primeira = usinas[0];
  if (primeira) {
    console.log("Campos disponíveis na primeira usina:");
    console.log(Object.keys(primeira.bruto as object).sort().join(", "));
    console.log("\nExemplo mapeado:");
    console.log({ ...primeira, bruto: "[omitido]" });
  }

  // Distribuição de status: mostra como a Growatt escreve "offline" e "anormal",
  // que é o que as regras de alerta vão precisar reconhecer.
  const porStatus = new Map<string, number>();
  for (const u of usinas) {
    const k = u.statusBruto ?? "(sem status)";
    porStatus.set(k, (porStatus.get(k) ?? 0) + 1);
  }
  console.log("\nStatus encontrados:");
  for (const [status, n] of [...porStatus].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(4)}  ${status}`);
  }

  // Confere o problema de kWp visto no print: valores mil vezes menores que o real.
  const suspeitas = usinas.filter(
    (u) => u.potenciaKwp !== undefined && u.potenciaKwp > 0 && u.potenciaKwp < 1,
  );
  if (suspeitas.length) {
    console.log(
      `\nATENÇÃO: ${suspeitas.length} usinas com potência abaixo de 1 kWp — ` +
        "provável erro de cadastro (0.072 em vez de 72). Afeta alerta de geração baixa:",
    );
    for (const u of suspeitas.slice(0, 10)) {
      console.log(`  ${u.idExterno}  ${u.nome}  ${u.potenciaKwp} kWp`);
    }
  }

  if (primeira) {
    console.log(`\nDispositivos da usina ${primeira.nome}...`);
    const equipamentos = await coletor.listarEquipamentos(primeira.idExterno);
    console.log(`${equipamentos.length} dispositivos.`);
    if (equipamentos[0]) {
      console.log("Campos disponíveis no primeiro dispositivo:");
      console.log(Object.keys(equipamentos[0].bruto as object).sort().join(", "));
    }
  }

  const destino = "probe-growatt.json";
  writeFileSync(destino, JSON.stringify(coletor.capturas, null, 2));
  console.log(`\nRespostas cruas salvas em ${destino} (está no .gitignore).`);
}

main().catch((erro) => {
  console.error("\nFalhou:", erro instanceof Error ? erro.message : erro);
  process.exit(1);
});
