import "dotenv/config";

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { GrowattOpenApi, JANELA_VISAO_GERAL_MS } from "./openapi";

/**
 * Marca de quando o probe rodou pela última vez.
 *
 * Fica fora do repositório de propósito — é estado da máquina, não do projeto.
 * Existe porque a punição da Growatt por frequência não para no erro: relatos
 * de outros integradores falam em IP bloqueado por dias. Barrar a chamada aqui
 * é mais seguro do que fazê-la e torcer.
 */
const MARCA = join(tmpdir(), "selebi-probe-growatt.txt");

function esperaRestante(): number {
  if (!existsSync(MARCA)) return 0;
  const anterior = Number(readFileSync(MARCA, "utf8").trim());
  if (!Number.isFinite(anterior)) return 0;
  return Math.max(0, JANELA_VISAO_GERAL_MS - (Date.now() - anterior));
}

/**
 * Diagnóstico da OpenAPI v1 da Growatt.
 *
 * Enquanto o token não estiver vinculado às contas dos clientes, este programa
 * serve para uma coisa: dizer, em quinze segundos, se a Growatt já resolveu o
 * chamado. Rodar de vez em quando é mais barato que ficar relendo e-mail.
 *
 * Quando a permissão sair, ele vira o de sempre — lista as usinas e mostra os
 * campos que o coletor vai usar.
 *
 *   npm run probe:growatt-api
 */

function campos(o: unknown): string {
  return o && typeof o === "object"
    ? Object.keys(o as object).sort().join(", ")
    : "—";
}

async function tentar<T>(rotulo: string, fn: () => Promise<T>) {
  try {
    return { rotulo, ok: true as const, valor: await fn() };
  } catch (erro) {
    return {
      rotulo,
      ok: false as const,
      motivo: erro instanceof Error ? erro.message : String(erro),
    };
  }
}

async function main() {
  const token = process.env.GROWATT_API_TOKEN;
  if (!token) {
    console.error(
      "Falta GROWATT_API_TOKEN no .env.\n\n" +
        "O token sai no OSS: System Setting → System Management →\n" +
        "API management → Add API Request. Chega por e-mail, em chinês, com\n" +
        "o token no meio da frase — no .env vai só ele, 32 caracteres.",
    );
    process.exit(1);
  }

  const espera = esperaRestante();
  if (espera > 0) {
    const minutos = Math.ceil(espera / 60000);
    console.log(
      `Rodou há pouco. A Growatt exige cerca de 5 minutos entre consultas de\n` +
        `visão geral, e insistir antes disso arrisca bloquear o IP.\n\n` +
        `Tente de novo em ${minutos} ${minutos === 1 ? "minuto" : "minutos"}.`,
    );
    process.exit(0);
  }
  writeFileSync(MARCA, String(Date.now()));

  console.log(`Token: ${token.length} caracteres\n`);

  const usinas = await tentar("usinas da conta", () =>
    new GrowattOpenApi(token).listarUsinas(1, 100),
  );
  const clientes = await tentar("clientes finais", () =>
    new GrowattOpenApi(token).listarUsuariosFinais(1, 100),
  );

  const qtdUsinas = usinas.ok ? (usinas.valor.data?.count ?? 0) : null;
  const qtdClientes = clientes.ok ? (clientes.valor.data?.count ?? 0) : null;

  const porFrequencia =
    (!usinas.ok && usinas.motivo.includes("10012")) ||
    (!clientes.ok && clientes.motivo.includes("10012"));

  if (porFrequencia) {
    console.log(
      "A Growatt recusou por frequência (10012). Alguma chamada foi feita há\n" +
        "menos de cinco minutos — pode ter sido outro programa, ou a coleta.\n" +
        "Espere e tente de novo; insistir arrisca bloquear o IP.",
    );
    process.exit(0);
  }

  console.log(
    `Usinas na conta do token: ${usinas.ok ? qtdUsinas : `erro — ${usinas.motivo}`}`,
  );
  console.log(
    `Clientes finais:          ${clientes.ok ? qtdClientes : `erro — ${clientes.motivo}`}`,
  );

  if (usinas.ok && qtdUsinas === 0 && clientes.ok && qtdClientes === 0) {
    console.log(
      "\nO token responde, e não enxerga nada. É o estado conhecido desde\n" +
        "09/09/2026: token emitido mas não vinculado às contas dos clientes.\n" +
        "Enquanto isso não mudar, as 137 usinas continuam entrando por\n" +
        "planilha (`npm run import:geracao`).\n\n" +
        "Chamado com br.service@growatt.com e service@growatt.com.\n",
    );
    process.exit(0);
  }

  const lista = usinas.ok ? (usinas.valor.data?.plants ?? []) : [];
  if (lista.length === 0) process.exit(0);

  console.log("\nA permissão saiu. Primeiras usinas:\n");
  for (const u of lista.slice(0, 15)) {
    console.log(
      `  ${u.plant_id}  ${u.name ?? "sem nome"}  ` +
        `${u.peak_power ?? "—"} kWp  total ${u.total_energy ?? "—"} kWh`,
    );
  }
  console.log(`\nCampos da usina:\n  ${campos(lista[0])}`);

  const cliente = new GrowattOpenApi(token);
  const primeira = lista[0].plant_id;

  const dispositivos = await tentar("dispositivos", () =>
    cliente.listarDispositivos(primeira),
  );
  if (dispositivos.ok) {
    const devs = dispositivos.valor.data?.devices ?? [];
    console.log(`\nDispositivos da primeira usina: ${devs.length}`);
    if (devs[0]) console.log(`Campos do dispositivo:\n  ${campos(devs[0])}`);
  } else {
    console.log(`\nDispositivos: erro — ${dispositivos.motivo}`);
  }

  const destino = "probe-growatt-api.json";
  writeFileSync(destino, JSON.stringify({ usinas, clientes, dispositivos }, null, 2));
  console.log(`\nRespostas cruas em ${destino} (está no .gitignore).`);
  process.exit(0);
}

main().catch((erro) => {
  console.error("\nFalhou:", erro instanceof Error ? erro.message : erro);
  process.exit(1);
});
