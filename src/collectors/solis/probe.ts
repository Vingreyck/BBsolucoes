import "dotenv/config";

import { writeFileSync } from "node:fs";

import { SolisClient } from "./client";

/**
 * Primeiro contato com a conta SolisCloud.
 *
 * Mostra o que a conta enxerga e, principalmente, **quais campos** cada rota
 * devolve — é dessa lista que o coletor é escrito, em vez de adivinhar nome de
 * campo pela documentação, que nem sempre bate com o que o servidor manda.
 *
 * Não grava no banco.
 *
 *   npm run probe:solis
 */

function campos(o: unknown): string {
  return o && typeof o === "object"
    ? Object.keys(o as object).sort().join(", ")
    : "—";
}

async function main() {
  const id = process.env.SOLIS_KEY_ID;
  const segredo = process.env.SOLIS_KEY_SECRET;

  if (!id || !segredo) {
    console.error(
      "Faltam SOLIS_KEY_ID e SOLIS_KEY_SECRET no .env.\n" +
        "Saem no SolisCloud, em Serviço → Gerenciamento de API, depois que o\n" +
        "suporte libera o acesso para a conta.",
    );
    process.exit(1);
  }

  const cliente = new SolisClient(id, segredo, process.env.SOLIS_BASE_URL);

  const usinas = await cliente.listarUsinas();
  const lista = usinas.data?.page?.records ?? [];
  const contadores = usinas.data?.stationStatusVo;

  console.log(`Usinas: ${lista.length}`);
  if (contadores) {
    console.log(
      `  ${contadores.normal ?? 0} normais · ${contadores.fault ?? 0} em falha · ` +
        `${contadores.offline ?? 0} offline`,
    );
  }
  for (const u of lista.slice(0, 20)) {
    console.log(
      `  ${u.id}  ${u.stationName ?? "sem nome"}  ` +
        `${u.capacity ?? "—"} ${u.capacityStr ?? ""}  ` +
        `hoje ${u.dayPowerGeneration ?? "—"} kWh  estado ${u.state ?? "—"}`,
    );
  }
  if (lista[0]) console.log(`\nCampos da usina:\n  ${campos(lista[0])}`);

  const inversores = await cliente.listarInversores();
  const listaInv = inversores.data?.page?.records ?? [];
  console.log(`\nInversores: ${listaInv.length}`);
  for (const i of listaInv.slice(0, 20)) {
    console.log(
      `  ${i.sn ?? i.id}  ${i.productModel ?? i.model ?? "sem modelo"}  ` +
        `hoje ${i.etoday ?? "—"} kWh  estado ${i.state ?? "—"}`,
    );
  }
  if (listaInv[0]) console.log(`\nCampos do inversor:\n  ${campos(listaInv[0])}`);

  const coletores = await cliente.listarColetores();
  const listaCol = coletores.data?.page?.records ?? [];
  console.log(`\nDataloggers: ${listaCol.length}`);
  if (listaCol[0]) console.log(`Campos do datalogger:\n  ${campos(listaCol[0])}`);

  const destino = "probe-solis.json";
  writeFileSync(
    destino,
    JSON.stringify({ usinas, inversores, coletores }, null, 2),
  );
  console.log(`\nRespostas cruas em ${destino} (está no .gitignore).`);
  process.exit(0);
}

main().catch((erro) => {
  console.error("\nFalhou:", erro instanceof Error ? erro.message : erro);
  process.exit(1);
});
