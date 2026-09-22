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

/**
 * Janela em que vale a pena falar com os portais.
 *
 * Depois que o sol se põe nenhuma usina gera mais nada, e o total do dia já
 * está fechado. Continuar consultando de hora em hora até o amanhecer gasta
 * orçamento de chamada e risco de bloqueio para reler o mesmo número dez vezes
 * — e o orçamento é a parte escassa: a Growatt bloqueia IP por frequência e a
 * Northbound da Huawei tem teto diário de chamadas.
 *
 * `ANOITECE = 19` é uma hora depois do pôr do sol em Sergipe, de propósito: a
 * rodada das 19h é a que fecha o dia, com o total definitivo. Das 20h às 4h não
 * se consulta ninguém.
 *
 * Corta 9 das 24 rodadas — quase 40% das chamadas, sem perder um dado sequer.
 * A detecção e as importações de planilha continuam rodando, porque são locais
 * e não custam chamada nenhuma.
 */
const AMANHECE = 5;
const ANOITECE = 19;

function horaLocal(): number {
  return Number(
    new Intl.DateTimeFormat("pt-BR", {
      hour: "numeric",
      hour12: false,
      timeZone: "America/Sao_Paulo",
    }).format(new Date()),
  );
}

/** As coletas que falam com portal usam isto; as locais, não. */
function dentroDoDiaSolar(): { rodar: boolean; motivo?: string } {
  const hora = horaLocal();
  if (hora >= AMANHECE && hora <= ANOITECE) return { rodar: true };
  return {
    rodar: false,
    motivo: `são ${hora}h e nenhuma usina gera à noite — consultar o portal agora só gastaria chamada`,
  };
}

/** Junta a janela solar com outra condição, como a credencial estar no `.env`. */
function soDeDia(
  extra: () => { rodar: boolean; motivo?: string },
): () => { rodar: boolean; motivo?: string } {
  return () => {
    const credencial = extra();
    if (!credencial.rodar) return credencial;
    return dentroDoDiaSolar();
  };
}

/**
 * As duas importações de planilha só rodam quando a API está fora.
 *
 * Elas foram o caminho enquanto o token da OpenAPI não enxergava as usinas.
 * Agora que enxerga, deixá-las no automático relê uma exportação de dias atrás
 * a cada rodada e reescreve por cima do que veio fresco da API.
 *
 * Os scripts ficam: o contrato da Growatt diz que ela pode suspender o serviço
 * quando quiser e sem indenizar, então o plano B não se apaga. Tirando
 * `GROWATT_API_TOKEN` do `.env`, eles voltam a rodar sozinhos.
 */
const PLANO_B =
  "a OpenAPI está ligada; a planilha é plano B e roda à mão com npm run import:geracao";

const ETAPAS: Etapa[] = [
  {
    nome: "Geração exportada do Growatt",
    script: "src/collectors/growatt/importar-geracao.ts",
    argumentos: [PASTA_DADOS],
    quando: () => {
      if (process.env.GROWATT_API_TOKEN) return { rodar: false, motivo: PLANO_B };
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
    /**
     * Enquanto o token da OpenAPI não enxerga as usinas, esta exportação é o
     * que traz inversor, datalogger e — o que mais vale — há quantos dias cada
     * aparelho está mudo. Sai em Device List → Export data → Export the device
     * data. Pega sempre o arquivo mais recente da pasta.
     */
    nome: "Dispositivos exportados do Growatt",
    script: "src/collectors/growatt/importar-dispositivos.ts",
    argumentos: [],
    quando: () => {
      if (process.env.GROWATT_API_TOKEN) return { rodar: false, motivo: PLANO_B };
      if (!existsSync(PASTA_DADOS)) {
        return { rodar: false, motivo: `a pasta ${PASTA_DADOS}/ não existe` };
      }
      const arquivos = readdirSync(PASTA_DADOS)
        .filter((n) => /^dispositivos.*\.(csv|xlsx)$/i.test(n))
        .sort();
      const escolhido = arquivos.at(-1);
      if (!escolhido) {
        return { rodar: false, motivo: `nenhum dispositivos*.csv em ${PASTA_DADOS}/` };
      }
      ETAPAS[1].argumentos = [`${PASTA_DADOS}/${escolhido}`];
      return { rodar: true };
    },
  },
  {
    nome: "Coleta FoxESS",
    script: "src/collectors/foxess/coletar.ts",
    quando: soDeDia(() =>
      process.env.FOXESS_API_KEY
        ? { rodar: true }
        : { rodar: false, motivo: "FOXESS_API_KEY não está no .env" }),
  },
  {
    nome: "Coleta FusionSolar",
    script: "src/collectors/fusionsolar/coletar.ts",
    quando: soDeDia(() =>
      process.env.FUSIONSOLAR_USUARIO && process.env.FUSIONSOLAR_SYSTEM_CODE
        ? { rodar: true }
        : {
            rodar: false,
            motivo: "FUSIONSOLAR_USUARIO/FUSIONSOLAR_SYSTEM_CODE não estão no .env",
          }),
  },
  {
    nome: "Coleta Solis",
    script: "src/collectors/solis/coletar.ts",
    quando: soDeDia(() =>
      process.env.SOLIS_KEY_ID && process.env.SOLIS_KEY_SECRET
        ? { rodar: true }
        : { rodar: false, motivo: "SOLIS_KEY_ID/SOLIS_KEY_SECRET não estão no .env" }),
  },
  {
    /**
     * Última das coletas de propósito: é a maior, com 143 usinas, e a única
     * que a Growatt pode recusar por frequência. Vindo no fim, um `10012`
     * aqui não atrapalha as outras três, que já terminaram.
     */
    nome: "Coleta Growatt",
    script: "src/collectors/growatt/coletar.ts",
    quando: soDeDia(() =>
      process.env.GROWATT_API_TOKEN
        ? { rodar: true }
        : { rodar: false, motivo: "GROWATT_API_TOKEN não está no .env" }),
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
