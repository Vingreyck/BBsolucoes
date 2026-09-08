import "dotenv/config";

import { writeFileSync } from "node:fs";

import { FusionSolarClient } from "./client";

/**
 * Primeiro contato com a conta northbound do FusionSolar.
 *
 * Responde, com uma chamada só, a pergunta que ainda está aberta: **a BB tem
 * alguma usina Huawei?** Se a resposta for zero, o portal fecha aqui e não se
 * gasta mais nada com ele.
 *
 * Não grava no banco e é econômico de propósito — um login, uma lista de usinas
 * e um KPI. A Northbound API castiga quem insiste.
 *
 *   npm run probe:fusionsolar
 */

const HOST_PADRAO = "https://la5.fusionsolar.huawei.com";

/** Huawei manda capacidade em MW. 0,008 MW = 8 kWp. */
function emKwp(capacidade: number | undefined): string {
  if (capacidade === undefined) return "—";
  return `${(capacidade * 1000).toLocaleString("pt-BR")} kWp`;
}

async function main() {
  const usuario = process.env.FUSIONSOLAR_USUARIO;
  const systemCode = process.env.FUSIONSOLAR_SYSTEM_CODE;
  const base = process.env.FUSIONSOLAR_BASE_URL || HOST_PADRAO;

  if (!usuario || !systemCode) {
    console.error(
      "Faltam FUSIONSOLAR_USUARIO e FUSIONSOLAR_SYSTEM_CODE no .env.\n\n" +
        "Não são o login do site. São de uma conta à parte, criada dentro do\n" +
        "FusionSolar em System → Company Management → Northbound Management.\n" +
        "Quem cria é a conta de instalador que administra as usinas.",
    );
    process.exit(1);
  }

  console.log(`Servidor: ${base}`);
  console.log(`Conta northbound: ${usuario}\n`);
  console.log("Entrando...");

  const cliente = new FusionSolarClient(usuario, systemCode, base);
  await cliente.autenticar();
  console.log("  ✓ login aceito, token recebido\n");

  const { usinas, rota } = await cliente.listarUsinas();
  console.log(`Usinas: ${usinas.length}  (rota ${rota})`);

  if (usinas.length === 0) {
    console.log(
      "\nA conta entrou mas não administra nenhuma usina.\n" +
        "Ou a BB não tem equipamento Huawei, ou as usinas estão sob outra\n" +
        "conta de instalador e precisam ser migradas em Plants → Plant Migration.\n" +
        "Vale conferir no portal, na tela de usinas, antes de seguir.",
    );
    process.exit(0);
  }

  for (const u of usinas.slice(0, 30)) {
    console.log(
      `  ${u.codigo}  ${u.nome}  ${emKwp(u.capacidadeBruta)}` +
        (u.capacidadeBruta !== undefined ? `  (bruto: ${u.capacidadeBruta})` : "") +
        (u.endereco ? `  · ${u.endereco}` : ""),
    );
  }
  if (usinas.length > 30) console.log(`  … e mais ${usinas.length - 30}`);

  console.log(
    "\nConfira a potência contra o portal. A Huawei documenta capacidade em MW,\n" +
      "e é por isso que o valor bruto aparece do lado — se as duas colunas não\n" +
      "baterem, a conversão muda antes de qualquer coisa depender dela.",
  );

  console.log("\nCampos disponíveis na usina:");
  console.log("  " + Object.keys(usinas[0].bruto as object).sort().join(", "));

  const codigos = usinas.map((u) => u.codigo).slice(0, 100);

  const kpi = await cliente.kpiAgora(codigos);
  console.log(`\nKPI de agora: ${kpi.data?.length ?? 0} respostas`);
  const primeiro = kpi.data?.[0];
  if (primeiro) {
    const mapa = (primeiro as { dataItemMap?: Record<string, unknown> })
      .dataItemMap;
    console.log("Campos do KPI:");
    console.log("  " + Object.keys(mapa ?? primeiro).sort().join(", "));
  }

  const dispositivos = await cliente.listarDispositivos(codigos);
  console.log(`\nDispositivos: ${dispositivos.data?.length ?? 0}`);
  if (dispositivos.data?.[0]) {
    console.log("Campos do dispositivo:");
    console.log("  " + Object.keys(dispositivos.data[0]).sort().join(", "));
  }

  const destino = "probe-fusionsolar.json";
  writeFileSync(
    destino,
    JSON.stringify({ usinas, kpi, dispositivos }, null, 2),
  );
  console.log(`\nRespostas cruas em ${destino} (está no .gitignore).`);
  process.exit(0);
}

main().catch((erro) => {
  console.error("\nFalhou:", erro instanceof Error ? erro.message : erro);
  process.exit(1);
});
