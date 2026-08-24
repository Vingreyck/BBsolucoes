import "dotenv/config";

import ExcelJS from "exceljs";
import { eq } from "drizzle-orm";

import { db, schema } from "../../db";

/**
 * Importa a lista de usinas exportada do Growatt OSS.
 *
 * A API de sessão não autentica a conta de distribuidor e o token da OpenAPI v1
 * depende da Growatt responder. Enquanto isso, o próprio OSS exporta a Plant
 * List em planilha — mesmo dado, sem depender de ninguém.
 *
 * O importador é idempotente: roda quantas vezes quiser que ele atualiza em vez
 * de duplicar, casando pelo id externo da usina no portal.
 *
 *   npm run import:growatt -- "C:/caminho/plant list.xlsx"
 */

/**
 * Cabeçalhos possíveis por campo, em ordem de preferência — o OSS muda de
 * idioma conforme a conta.
 *
 * Duas armadilhas que a planilha do OSS tem:
 *
 *   - existe uma coluna "Alias" logo antes de "User Name", e ela é o apelido da
 *     usina, não o nome do cliente. Por isso não entra em `cliente`.
 *   - a coluna "No." é só a numeração da linha na exportação, não um id estável
 *     da usina. Usar ela como chave quebraria a reimportação, então ela não
 *     entra em `idExterno` — sem uma coluna de id de verdade, a chave passa a
 *     ser o nome da usina.
 */
const COLUNAS = {
  nome: ["plant name", "nome da planta", "nome da usina", "plantname"],
  cliente: ["user name", "username", "nome do usuário", "usuário", "usuario"],
  cidade: ["city", "cidade"],
  potenciaKwp: ["pv panels power", "potência", "potencia", "capacidade"],
  dataInstalacao: ["installation date", "data de instalação", "data de instalacao"],
  totalKwh: ["total"],
  geracaoDia: ["daily generation", "geração diária", "geracao diaria"],
  estado: ["state", "estado", "status"],
  idExterno: ["plant id", "id da usina"],
} as const;

type Campo = keyof typeof COLUNAS;

function normalizar(s: unknown): string {
  return String(s ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

/** Converte "60kWp", "0.072kWp", "166223.7kWh" em número. */
function numero(v: unknown): number | undefined {
  if (v === null || v === undefined || v === "") return undefined;
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  const limpo = String(v).replace(/[^\d.,-]/g, "").replace(",", ".");
  const n = Number(limpo);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Potência instalada, sempre devolvida em kWp.
 *
 * A tela do OSS mostra "60kWp", mas a exportação da mesma usina traz `60000.0`
 * — ou seja, watts. A soma da coluna bruta desta exportação deu 1.095.107, que
 * é exatamente o "1095.1kWp" do painel: confirma a unidade. Importar sem dividir
 * inflaria toda usina em mil vezes.
 */
function potenciaKwp(v: unknown): number | undefined {
  const n = numero(v);
  if (n === undefined) return undefined;
  // Se o valor veio com unidade explícita de kWp, respeita.
  if (/kwp/i.test(String(v))) return n;
  return n / 1000;
}

function data(v: unknown): Date | undefined {
  if (v instanceof Date) return v;
  const s = String(v ?? "").trim();
  if (!s) return undefined;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

function texto(v: unknown): string | undefined {
  const s = String(v ?? "").trim();
  return s === "" || s === "--" ? undefined : s;
}

/**
 * Acha a linha de cabeçalho e mapeia cada campo para o índice da coluna.
 *
 * Quando duas colunas casam com o mesmo campo, ganha a que bate com o candidato
 * de maior preferência — não a que aparece primeiro na planilha. Sem isso,
 * "Alias" roubaria o lugar de "User Name" só por vir antes.
 */
function mapearColunas(planilha: ExcelJS.Worksheet) {
  for (let linha = 1; linha <= Math.min(10, planilha.rowCount); linha++) {
    const celulas = planilha.getRow(linha).values as unknown[];
    const mapa = new Map<Campo, number>();
    const prioridade = new Map<Campo, number>();

    celulas.forEach((valor, indice) => {
      const cabecalho = normalizar(valor);
      if (!cabecalho) return;
      for (const [campo, nomes] of Object.entries(COLUNAS) as [Campo, readonly string[]][]) {
        const posicao = nomes.findIndex(
          (n) => cabecalho === n || cabecalho.startsWith(n),
        );
        if (posicao === -1) continue;
        const atual = prioridade.get(campo);
        if (atual === undefined || posicao < atual) {
          mapa.set(campo, indice);
          prioridade.set(campo, posicao);
        }
      }
    });

    if (mapa.has("nome")) return { linhaCabecalho: linha, mapa };
  }
  return null;
}

async function main() {
  const caminho = process.argv[2];
  if (!caminho) {
    console.error(
      'Uso: npm run import:growatt -- "caminho/para/plant list.xlsx"\n\n' +
        "O arquivo sai do oss.growatt.com, na Plant Management List, no botão\n" +
        '"Export List" (canto superior direito) ou "Export" (abaixo da tabela).',
    );
    process.exit(1);
  }

  const empresa = await db.query.empresa.findFirst();
  if (!empresa) {
    console.error("Nenhuma empresa no banco. Rode `npm run db:seed` primeiro.");
    process.exit(1);
  }

  if (caminho.toLowerCase().endsWith(".xls")) {
    console.error(
      "Este arquivo é .xls (Excel 97-2003), formato que o leitor não abre.\n\n" +
        "Converta antes:\n" +
        `  python scripts/xls-para-csv.py "${caminho}"\n\n` +
        "Ou abra no Excel e salve como .xlsx ou CSV.",
    );
    process.exit(1);
  }

  const wb = new ExcelJS.Workbook();
  if (caminho.toLowerCase().endsWith(".csv")) {
    await wb.csv.readFile(caminho);
  } else {
    await wb.xlsx.readFile(caminho);
  }

  const planilha = wb.worksheets[0];
  if (!planilha) {
    console.error("A planilha está vazia.");
    process.exit(1);
  }

  const achado = mapearColunas(planilha);
  if (!achado) {
    console.error(
      "Não reconheci o cabeçalho. Colunas da primeira linha:\n  " +
        (planilha.getRow(1).values as unknown[])
          .filter(Boolean)
          .map(String)
          .join("\n  ") +
        "\n\nMe mande essa lista que eu ajusto o mapeamento.",
    );
    process.exit(1);
  }

  const { linhaCabecalho, mapa } = achado;
  console.log(`Cabeçalho na linha ${linhaCabecalho}. Colunas reconhecidas:`);
  for (const [campo, indice] of mapa) {
    console.log(`  ${campo.padEnd(16)} → coluna ${indice}`);
  }
  const faltando = (Object.keys(COLUNAS) as Campo[]).filter((c) => !mapa.has(c));
  if (faltando.length) console.log(`  (não encontradas: ${faltando.join(", ")})`);
  console.log("");

  // Uma conta de portal por empresa+fabricante, reaproveitada entre execuções.
  let conta = await db.query.contaPortal.findFirst({
    where: eq(schema.contaPortal.fabricante, "growatt"),
  });
  if (!conta) {
    [conta] = await db
      .insert(schema.contaPortal)
      .values({
        empresaId: empresa.id,
        fabricante: "growatt",
        apelido: "Growatt OSS (planilha)",
        cadenciaMinutos: 15,
      })
      .returning();
  }

  const ler = (linha: ExcelJS.Row, campo: Campo) => {
    const i = mapa.get(campo);
    if (i === undefined) return undefined;
    const c = linha.getCell(i).value;
    // Células de fórmula vêm como { result: ... }
    return c !== null && typeof c === "object" && "result" in c
      ? (c as { result: unknown }).result
      : c;
  };

  let criadas = 0;
  let atualizadas = 0;
  let ignoradas = 0;
  const cidades = new Map<string, number>();
  const estados = new Map<string, number>();
  const suspeitasKwp: string[] = [];
  const semCliente: string[] = [];

  for (let n = linhaCabecalho + 1; n <= planilha.rowCount; n++) {
    const linha = planilha.getRow(n);
    const nomeUsina = texto(ler(linha, "nome"));
    if (!nomeUsina) {
      ignoradas++;
      continue;
    }

    const nomeCliente = texto(ler(linha, "cliente")) ?? nomeUsina;
    const cidade = texto(ler(linha, "cidade"));
    const kwp = potenciaKwp(ler(linha, "potenciaKwp"));
    const instalacao = data(ler(linha, "dataInstalacao"));
    const estado = texto(ler(linha, "estado"));
    const idExterno = texto(ler(linha, "idExterno")) ?? nomeUsina;

    if (cidade) cidades.set(cidade, (cidades.get(cidade) ?? 0) + 1);
    if (estado) estados.set(estado, (estados.get(estado) ?? 0) + 1);

    /**
     * Detecta potência cadastrada errada por física, não por chute.
     *
     * `geração do dia ÷ potência` é o número de horas de sol a pleno que a usina
     * teria precisado para gerar aquilo. No Nordeste isso fica entre 4 e 6 horas;
     * acima de 8 é fisicamente impossível e denuncia que a potência está errada.
     * A própria coluna "Full hours" do OSS calcula isso — e mostra 437, 653, 711
     * em várias usinas, o que não existe.
     *
     * Um corte simples por "abaixo de 1 kWp" deixaria passar casos como uma
     * usina de 1,4 kWp com 44 MWh acumulados.
     */
    const geracao = numero(ler(linha, "geracaoDia"));
    if (kwp !== undefined && kwp > 0 && geracao !== undefined && geracao > 0) {
      const horasEquivalentes = geracao / kwp;
      if (horasEquivalentes > 8) {
        suspeitasKwp.push(
          `${nomeUsina} — ${kwp} kWp geraria ${horasEquivalentes.toFixed(0)}h de sol pleno`,
        );
      }
    }
    if (!texto(ler(linha, "cliente"))) semCliente.push(nomeUsina);

    // Cliente pelo nome. Provisório: a planilha do OSS não traz CPF, então
    // homônimo vira o mesmo cliente. A deduplicação de verdade só dá para
    // fazer quando os dados do Drive/Conta Azul entrarem.
    let cliente = await db.query.cliente.findFirst({
      where: eq(schema.cliente.nome, nomeCliente),
    });
    if (!cliente) {
      [cliente] = await db
        .insert(schema.cliente)
        .values({ empresaId: empresa.id, nome: nomeCliente, cidade, uf: null })
        .returning();
    }

    const vinculo = await db.query.vinculoPortal.findFirst({
      where: eq(schema.vinculoPortal.idExterno, idExterno),
    });

    if (vinculo) {
      await db
        .update(schema.usina)
        .set({
          nome: nomeUsina,
          potenciaKwp: kwp !== undefined ? String(kwp) : null,
          cidade,
          dataInstalacao: instalacao,
        })
        .where(eq(schema.usina.id, vinculo.usinaId));
      atualizadas++;
    } else {
      const [usina] = await db
        .insert(schema.usina)
        .values({
          empresaId: empresa.id,
          clienteId: cliente.id,
          nome: nomeUsina,
          potenciaKwp: kwp !== undefined ? String(kwp) : null,
          cidade,
          dataInstalacao: instalacao,
          /**
           * Toda usina que aparece na Plant List já está comissionada — o
           * "State" do OSS (Online, Offline, Abnormal) diz se ela está
           * comunicando agora, o que é condição de alerta, não estágio de vida.
           * Misturar as duas coisas faria usina offline parecer obra em
           * andamento.
           */
          status: "gerando",
        })
        .returning();

      await db.insert(schema.vinculoPortal).values({
        empresaId: empresa.id,
        usinaId: usina.id,
        contaPortalId: conta.id,
        idExterno,
        nomeExterno: nomeUsina,
      });
      criadas++;
    }
  }

  console.log(`Usinas criadas:     ${criadas}`);
  console.log(`Usinas atualizadas: ${atualizadas}`);
  if (ignoradas) console.log(`Linhas ignoradas:   ${ignoradas} (sem nome de usina)`);

  console.log(`\nCidades encontradas (${cidades.size}):`);
  for (const [cidade, n] of [...cidades].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(4)}  ${cidade}`);
  }

  if (estados.size) {
    console.log("\nSituação das usinas no portal:");
    for (const [estado, n] of [...estados].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${String(n).padStart(4)}  ${estado}`);
    }
    const comProblema = [...estados]
      .filter(([e]) => !/online/i.test(e))
      .reduce((soma, [, n]) => soma + n, 0);
    if (comProblema) {
      console.log(
        `\n  ${comProblema} usinas não estão online agora — e ninguém foi avisado.`,
      );
    }
  }

  if (suspeitasKwp.length) {
    console.log(
      `\nATENÇÃO: ${suspeitasKwp.length} usinas com potência impossível para a` +
        "\ngeração que registram. Um dia de sol rende de 4 a 6 horas equivalentes;" +
        "\nesses números só fecham se a potência estiver errada no cadastro do" +
        "\nportal. Enquanto não for corrigido na origem, alerta de geração baixa" +
        "\nvai disparar errado nessas usinas:",
    );
    for (const s of suspeitasKwp.slice(0, 20)) console.log(`  ${s}`);
    if (suspeitasKwp.length > 20) console.log(`  ... e mais ${suspeitasKwp.length - 20}`);
  }

  if (semCliente.length) {
    console.log(
      `\n${semCliente.length} usinas sem nome de usuário na planilha — ` +
        "o nome da usina foi usado como nome do cliente.",
    );
  }

  process.exit(0);
}

main().catch((erro) => {
  console.error("Falhou:", erro instanceof Error ? erro.message : erro);
  process.exit(1);
});
