import "dotenv/config";

import { spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";

/**
 * Roda a atualização diária inteira num comando só.
 *
 * Hoje são quatro comandos em sequência, e esquecer o último — a detecção —
 * significa dados novos no banco e nenhum alerta aberto. Juntar tudo remove
 * essa chance de erro, e é o passo antes de isso rodar sozinho por agendamento.
 *
 * Cada etapa continua funcionando sozinha: este arquivo apenas chama os mesmos
 * scripts, em ordem. Uma etapa que falha não derruba as seguintes — a FoxESS
 * fora do ar não pode impedir a detecção de rodar sobre o que já está no banco.
 *
 *   npm run atualizar
 */

interface Etapa {
  nome: string;
  script: string;
  argumentos?: string[];
  /** Quando devolve false, a etapa é pulada com o motivo explicado. */
  quando?: () => { rodar: boolean; motivo?: string };
}

const PASTA_DADOS = "dados";

const ETAPAS: Etapa[] = [
  {
    nome: "Geração exportada do Growatt",
    script: "src/collectors/growatt/importar-geracao.ts",
    argumentos: [PASTA_DADOS],
    quando: () => {
      if (!existsSync(PASTA_DADOS)) {
        return { rodar: false, motivo: `a pasta ${PASTA_DADOS}/ não existe` };
      }
      const arquivos = readdirSync(PASTA_DADOS).filter((n) => /\.(csv|xlsx)$/i.test(n));
      return arquivos.length > 0
        ? { rodar: true }
        : { rodar: false, motivo: `nenhum arquivo em ${PASTA_DADOS}/` };
    },
  },
  {
    nome: "Coleta FoxESS",
    script: "src/collectors/foxess/coletar.ts",
    quando: () =>
      process.env.FOXESS_API_KEY
        ? { rodar: true }
        : { rodar: false, motivo: "FOXESS_API_KEY não está no .env" },
  },
  {
    nome: "Coleta Solis",
    script: "src/collectors/solis/coletar.ts",
    quando: () =>
      process.env.SOLIS_KEY_ID && process.env.SOLIS_KEY_SECRET
        ? { rodar: true }
        : { rodar: false, motivo: "SOLIS_KEY_ID/SOLIS_KEY_SECRET não estão no .env" },
  },
  {
    nome: "Detecção de usina parada",
    script: "src/collectors/detectar.ts",
  },
];

function executar(etapa: Etapa): Promise<boolean> {
  return new Promise((resolve) => {
    const processo = spawn(
      "npx",
      ["tsx", etapa.script, ...(etapa.argumentos ?? [])],
      { stdio: "inherit", shell: process.platform === "win32" },
    );
    processo.on("close", (codigo) => resolve(codigo === 0));
    processo.on("error", () => resolve(false));
  });
}

async function main() {
  const inicio = Date.now();
  const resultados: { nome: string; estado: "ok" | "falhou" | "pulada"; motivo?: string }[] =
    [];

  for (const etapa of ETAPAS) {
    const condicao = etapa.quando?.() ?? { rodar: true };

    if (!condicao.rodar) {
      console.log(`\n── ${etapa.nome}: pulada (${condicao.motivo})`);
      resultados.push({ nome: etapa.nome, estado: "pulada", motivo: condicao.motivo });
      continue;
    }

    console.log(`\n── ${etapa.nome} ──────────────────────────────`);
    const ok = await executar(etapa);
    resultados.push({ nome: etapa.nome, estado: ok ? "ok" : "falhou" });
  }

  const segundos = Math.round((Date.now() - inicio) / 1000);
  console.log(`\n═══ Resumo (${segundos}s) ═══`);
  for (const r of resultados) {
    const marca = r.estado === "ok" ? "✓" : r.estado === "pulada" ? "–" : "✗";
    console.log(`  ${marca} ${r.nome}${r.motivo ? ` — ${r.motivo}` : ""}`);
  }

  const falhas = resultados.filter((r) => r.estado === "falhou").length;
  if (falhas) {
    console.log(`\n${falhas} etapa(s) falharam. O que passou foi gravado assim mesmo.`);
    process.exit(1);
  }
  process.exit(0);
}

main();
