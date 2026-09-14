import "dotenv/config";

import ExcelJS from "exceljs";
import { and, eq } from "drizzle-orm";

import { db, schema } from "../db";

/**
 * Importa a listagem das pastas de cliente do Drive.
 *
 * A entrada é o CSV gerado por `scripts/listar-drive.gs`, que roda dentro da
 * conta do Google e percorre `Energia solar / CLIENTES <ano> / <cliente> /`.
 *
 * O sistema não guarda o arquivo, guarda o que ele é e onde está. O ganho não é
 * ter cópia dos PDFs — é conseguir perguntar "quem está com documentação
 * incompleta?", que hoje só se responde abrindo trezentas pastas uma a uma.
 *
 *   npm run import:drive -- "dados/selebi-documentos-2026-09-14.csv"
 *   npm run import:drive -- "dados/...csv" --simular
 */

/**
 * Arquivo que não é documento de ninguém.
 *
 * O AutoCAD grava `.bak`, `.log` e `.dwl` do lado do `.dwg` toda vez que o
 * projetista salva. São 128 no Drive da BB, e nenhum interessa: além de inflar
 * a contagem, um `.bak` de prancha se chama "PE Solar Fulano.bak" e entrava
 * como projeto elétrico — dando a um cliente um documento que ele não tem.
 */
const EXTENSOES_IGNORADAS = new Set(["bak", "log", "dwl", "dwl2", "ini", "tmp"]);

function ignorar(nome: string): boolean {
  const ponto = nome.lastIndexOf(".");
  if (ponto < 0) return false;
  return EXTENSOES_IGNORADAS.has(nome.slice(ponto + 1).toLowerCase());
}

/**
 * Prefixo do nome do arquivo → tipo.
 *
 * A BB nomeia no padrão `TIPO - CLIENTE.pdf`, então o prefixo classifica. A
 * ordem importa: "BOLETO ART" tem que ser testado antes de "ART", senão o
 * boleto vira ART.
 */
const CLASSIFICACAO: [RegExp, (typeof schema.tipoDocumento.enumValues)[number]][] = [
  [/^boleto/i, "boleto_art"],
  [/^art\b/i, "art"],
  // "CONTRTATO" e "PTOCURACAO" existem no Drive. Erro de digitação na hora de
  // salvar o arquivo apareceria como documento faltando — dois clientes
  // constariam sem contrato tendo contrato.
  [/^contr?[ta]?tato|^contrato/i, "contrato"],
  // Sem o `l` final por causa de "Memoria_Assinado_Junto_-_26_05_2026.pdf".
  [/^memoria/i, "memorial"],
  [/^p[rt]ocura[çc]/i, "procuracao"],
  [/^recibo/i, "recibo"],
  [/^(rg|cpf|cnh|documento|identidade)\b/i, "documento_pessoal"],
  // UCS no plural são as unidades beneficiárias do sistema de compensação, e
  // são 45 arquivos — coisa diferente da conta da UC geradora.
  //
  // "UC BENEFICIARIA - ALDEVAN.pdf" tem que vir **antes** da regra genérica de
  // UC, senão o `^uc\b` a engole: eram 41 arquivos entrando como conta da
  // geradora, e a conta da geradora é item do checklist da concessionária.
  // Quem tinha só a das beneficiárias aparecia na tela como em dia.
  [/^ucs\b|^uc\s*benefici/i, "uc_beneficiaria"],
  // "UC32443141 - FULANO.pdf" não tem espaço depois do UC, então `\b` não
  // resolve — e eram vários arquivos de conta de luz caindo em `outro`.
  [/^(nova\s+)?uc[\s-]?\d/i, "uc_geradora"],
  [/^(uc|conta|fatura)\b/i, "uc_geradora"],
  // "Demonstrativo" aqui é o de crédito de energia do sistema de compensação.
  [/^(compensativ|demonstrativo)/i, "compensativo"],
  [/^(nf|nota)\b/i, "nota_fiscal"],
  // FILHA CADASTRAL existe no Drive. Mais um nome digitado com pressa.
  [/^(ficha|filha|cadastro)/i, "ficha_cadastral"],
  // Fotos do padrão de entrada, que a NDU 013 exige de tampa aberta e fechada.
  // "DIAJUNTOR" e "DIJUNTOR" estão escritos assim no Drive; são fotos tiradas
  // em obra e nomeadas na pressa, e são 58 arquivos.
  [/^(medidor|quadro|padrao|padrão|di[sa]?juntor|qd\b|poste|ramal)/i, "foto_padrao"],
  // Protocolo da Energisa: "SE20260498249.3d6Wc.pdf". O prefixo SE é Sergipe.
  [/^se\d{8,}/i, "protocolo"],
  [/^(energisa|resumocadastral|formul[áa]rio)/i, "protocolo"],
  [/^datasheet/i, "datasheet"],
  // Certificação do equipamento, que a concessionária exige junto do projeto.
  [/^(inmetro|placas?|m[óo]dulos?|inversor|micro)/i, "datasheet"],
  [/^laudo/i, "declaracao"],
  [/^comprovante/i, "comprovante"],
  [/^(declara|termo|certid|atestado|escritura)/i, "declaracao"],
  [/^(or[çc]amento|proposta)/i, "orcamento"],
  // "Registro 011923_2025 _ Avaliação da Conformidade" e "Registro inmetro
  // microinversor growatt 2.25" — são 176 arquivos, e todos os 176 são registro
  // do Inmetro de módulo ou inversor. Estavam em `declaracao`, que é onde ficam
  // certidão, atestado e termo: o bloco inchava com ficha de equipamento.
  [/^registro/i, "datasheet"],
  // P01, P02… são as pranchas do projeto elétrico, uma por folha.
  [/^(pe |projeto|diagrama|unifilar|prancha|p\d{2}\b)/i, "projeto_eletrico"],
  [/^simula/i, "simulacao"],
];

/**
 * Segunda passada: a palavra em qualquer lugar do nome.
 *
 * Metade do Drive segue `TIPO - CLIENTE.pdf` e para essa metade o prefixo
 * basta. A outra metade inverte — "JUSTINO DECLARAÇÃO.pdf", "SOLICITACAO
 * ORCAMENTO - GILMAR.pdf", "WESLEY VIRGILIO DE ALMEIDA_UC_28804205589.pdf" — e
 * aí o prefixo é o nome da pessoa.
 *
 * Só roda depois que **todas** as regras de prefixo falharam, e essa ordem é o
 * que a torna segura: "MEMORIAL - INMETRO INVERSOR" já saiu como memorial na
 * primeira passada e nunca chega aqui para virar datasheet.
 */
const CONTEM: [RegExp, (typeof schema.tipoDocumento.enumValues)[number]][] = [
  // Número da instalação no meio do nome: dentro do pacote do projeto a conta
  // de luz vem batizada com o cliente na frente.
  [/\buc[\s-]?\d{6,}/i, "uc_geradora"],
  [/\b(uc|conta)\s+nova\b|\bnova\s+uc\b/i, "uc_geradora"],
  // Certificação e ficha técnica. As marcas cobrem os arquivos que o
  // fabricante entrega já batizados — "dmegc_605-625w.pdf",
  // "JINKO-565W-MONO-TR-NEO-N-TYPE-JKM565N-72HL4-V.pdf".
  [/\b(inmetro|datasheet)\b/i, "datasheet"],
  [/ficha[\s_]de[\s_]dados|avalia[çc][ãa]o[\s_]da[\s_]conformidade/i, "datasheet"],
  [/\b(jinko|jkm\d|canadian|chsm|astro[\s_-]?n|longi|dmegc|trina|risen|ja[\s_-]?solar)\b/i, "datasheet"],
  [/\b(m[íi]n|mac|mid)[\s_-]?\d{4}|\bneo[\s_-]?\d{4}/i, "datasheet"],
  [/\b(disjuntor|di[sa]juntor|medi[çc][ãa]o)\b/i, "foto_padrao"],
  [/\benergisa\b/i, "protocolo"],
  [/\bmemorial\b/i, "memorial"],
  [/\bcontrato\b/i, "contrato"],
  [/\bprocura[çc]/i, "procuracao"],
  [/\b(declara[çc]|laudo|certid[ãa]o|escritura)/i, "declaracao"],
  [/\bor[çc]amento\b/i, "orcamento"],
  // "COMPENSATICO - GILMAR.pdf" está escrito assim mesmo.
  [/\bcompensat/i, "compensativo"],
  [/\bart\b/i, "art"],
];

/**
 * Underscore conta como separador, não como parte da palavra.
 *
 * `ART_Assinada_V1.pdf` não casava com `^art\b` porque, para a expressão
 * regular, `_` é letra — e a ART assinada do WESLEY, que existe, apareceria
 * como faltando. Trocar por espaço antes de classificar resolve para todos os
 * arquivos que o projetista entrega com esse padrão.
 */
function classificar(nome: string) {
  const limpo = nome.trim().replace(/_/g, " ");
  for (const [padrao, tipo] of CLASSIFICACAO) {
    if (padrao.test(limpo)) return tipo;
  }
  for (const [padrao, tipo] of CONTEM) {
    if (padrao.test(limpo)) return tipo;
  }
  return "outro" as const;
}

/**
 * Nome comparável: minúsculo, sem acento, sem pontuação, espaços colapsados.
 *
 * As pastas do Drive são MAIÚSCULAS e os clientes do banco vieram dos portais
 * dos fabricantes, escritos por quem instalou. "MARINA SOBRAL" e
 * "Marina sobral" são a mesma pessoa, e sem normalizar seriam duas.
 */
function normalizar(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Nome sem o ruído que os portais dos fabricantes acrescentam.
 *
 * O cadastro do banco veio dos portais, onde o técnico digitou coisas como
 * "alef 7", "Adelvan ideal", "Antônio Marcos residência" e "Gerinaldo messias
 * 3". A pasta do Drive tem só "ALEF", "ADELVAN", "ANTONIO MARCOS". Sem tirar
 * esse ruído, a mesma pessoa vira dois clientes.
 */
const RUIDO = /\b(adm|residencia|residencial|casa|predio|sitio|\d+)\b/g;

function semRuido(s: string): string {
  return normalizar(s).replace(RUIDO, " ").replace(/\s+/g, " ").trim();
}

/** Tokens do nome, já sem ruído. */
function tokens(s: string): Set<string> {
  return new Set(semRuido(s).split(" ").filter(Boolean));
}

/** Um conjunto contém o outro, em qualquer direção. */
function contido(a: Set<string>, b: Set<string>): boolean {
  if (a.size === 0 || b.size === 0) return false;
  const [menor, maior] = a.size <= b.size ? [a, b] : [b, a];
  for (const t of menor) if (!maior.has(t)) return false;
  return true;
}

function texto(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "object" && "result" in v) return String((v as { result: unknown }).result ?? "");
  if (typeof v === "object" && "text" in v) return String((v as { text: unknown }).text ?? "");
  return String(v).trim();
}

function numero(v: unknown): number | undefined {
  const n = Number(texto(v).replace(/[^\d]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function data(v: unknown): Date | undefined {
  const s = texto(v);
  if (!s) return undefined;
  const d = new Date(`${s}T12:00:00`);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

async function main() {
  const caminho = process.argv[2];
  const simular = process.argv.includes("--simular");
  /**
   * Mostra exemplos de arquivo por tipo.
   *
   * Regra de classificação errada não dá erro: ela grava com o rótulo trocado e
   * fica quieta. A única forma de conferir uma regra nova é ler o que ela
   * pegou, e com 2.900 arquivos isso precisa ser por amostra.
   */
  const amostra = process.argv.includes("--amostra");

  if (!caminho || caminho.startsWith("--")) {
    console.error(
      'Uso: npm run import:drive -- "dados/selebi-documentos-AAAA-MM-DD.csv"\n\n' +
        "O CSV sai de scripts/listar-drive.gs, que roda no Apps Script dentro da\n" +
        "conta do Google. Instruções no cabeçalho do arquivo.\n\n" +
        "Acrescente --simular para ver o que aconteceria sem gravar nada.",
    );
    process.exit(1);
  }

  const empresa = await db.query.empresa.findFirst();
  if (!empresa) {
    console.error("Nenhuma empresa no banco. Rode `npm run db:seed` primeiro.");
    process.exit(1);
  }

  const wb = new ExcelJS.Workbook();
  if (caminho.toLowerCase().endsWith(".csv")) await wb.csv.readFile(caminho);
  else await wb.xlsx.readFile(caminho);
  const planilha = wb.worksheets[0];
  if (!planilha) {
    console.error("A planilha está vazia.");
    process.exit(1);
  }

  /**
   * Colunas pelo nome do cabeçalho, não pela posição.
   *
   * A coluna `caminho` entrou no meio do CSV quando o script passou a descer
   * nas subpastas. Ler por posição quebraria silenciosamente com a listagem
   * antiga — e silêncio aqui significa arquivo importado com o nome errado.
   */
  const cabecalho = planilha.getRow(1).values as unknown[];
  const coluna = new Map<string, number>();
  cabecalho.forEach((valor, indice) => {
    const nome = normalizar(texto(valor));
    if (nome) coluna.set(nome, indice);
  });

  const faltando = ["cliente", "arquivo"].filter((c) => !coluna.has(c));
  if (faltando.length) {
    console.error(
      `O CSV não tem as colunas: ${faltando.join(", ")}.\n` +
        `Cabeçalho encontrado: ${[...coluna.keys()].join(", ")}\n\n` +
        "Gere de novo com scripts/listar-drive.gs.",
    );
    process.exit(1);
  }

  const ler = (linha: ExcelJS.Row, nome: string) => {
    const i = coluna.get(nome);
    return i === undefined ? "" : texto(linha.getCell(i).value);
  };

  // Índice dos clientes que já existem, nas duas formas de comparação.
  const clientes = await db.query.cliente.findMany({
    where: eq(schema.cliente.empresaId, empresa.id),
  });
  /**
   * Pasta do Drive → cliente, de importações anteriores.
   *
   * É esta a identidade estável, não o nome. O casamento por nome depende de
   * quem já está no catálogo, e o catálogo cresce durante a própria importação:
   * na segunda rodada a pasta "MELO" deixou de casar sozinha porque "DIEGO
   * MELO" tinha acabado de ser criada, e virou um cliente separado. Guardando o
   * id da pasta, reimportar é idempotente de verdade.
   */
  const jaVistas = await db
    .selectDistinct({
      pasta: schema.documento.pastaExterna,
      clienteId: schema.documento.clienteId,
    })
    .from(schema.documento)
    .where(eq(schema.documento.empresaId, empresa.id));
  const porPasta = new Map<string, string>();
  for (const v of jaVistas) if (v.pasta) porPasta.set(v.pasta, v.clienteId);

  const porNome = new Map<string, string>();
  const porLimpo = new Map<string, string>();
  let catalogo = clientes.map((c) => ({ id: c.id, nome: c.nome, tokens: tokens(c.nome) }));
  for (const c of clientes) {
    porNome.set(normalizar(c.nome), c.id);
    const limpo = semRuido(c.nome);
    if (!porLimpo.has(limpo)) porLimpo.set(limpo, c.id);
  }

  let linhasLidas = 0;
  let documentos = 0;
  let jaExistiam = 0;
  let pastasVazias = 0;
  let ignorados = 0;
  const casadosPasta = new Set<string>();
  const casadosExato = new Set<string>();
  const casadosLimpo = new Set<string>();
  const casadosToken = new Set<string>();
  const ambiguos = new Map<string, string[]>();
  const novos = new Set<string>();
  const porTipo = new Map<string, number>();
  const exemplos = new Map<string, string[]>();
  const resolvidos = new Map<string, string>();

  console.log(simular ? "SIMULAÇÃO — nada será gravado.\n" : "");

  for (let n = 2; n <= planilha.rowCount; n++) {
    const linha = planilha.getRow(n);
    const ano = ler(linha, "ano");
    const nomePasta = ler(linha, "cliente");
    const arquivo = ler(linha, "arquivo");
    const caminho = ler(linha, "caminho");
    if (!nomePasta) continue;
    if (arquivo && ignorar(arquivo)) {
      ignorados++;
      continue;
    }
    linhasLidas++;

    /**
     * Resolve o cliente em três passadas, da mais segura para a mais frouxa.
     *
     * Casar errado é pior que criar duplicata: junta dois clientes diferentes
     * numa pessoa só, e isso não se desfaz olhando a tela. Por isso a terceira
     * passada só aceita quando há **um** candidato — havendo dois, o nome vai
     * para a lista de ambíguos e um cliente novo é criado, que é o erro
     * reversível.
     */
    const idPasta = ler(linha, "idpasta");

    let clienteId = resolvidos.get(nomePasta);

    // A pasta manda. Se ela já foi importada antes, o cliente é aquele, mesmo
    // que alguém tenha renomeado a pasta no Drive desde então.
    if (!clienteId && idPasta) {
      clienteId = porPasta.get(idPasta);
      if (clienteId) casadosPasta.add(nomePasta);
    }

    if (!clienteId) {
      clienteId = porNome.get(normalizar(nomePasta));
      if (clienteId) casadosExato.add(nomePasta);
    }

    if (!clienteId) {
      clienteId = porLimpo.get(semRuido(nomePasta));
      if (clienteId) casadosLimpo.add(nomePasta);
    }

    if (!clienteId) {
      const alvo = tokens(nomePasta);
      const candidatos = catalogo.filter((c) => contido(alvo, c.tokens));
      if (candidatos.length === 1) {
        clienteId = candidatos[0].id;
        casadosToken.add(nomePasta);
      } else if (candidatos.length > 1) {
        ambiguos.set(nomePasta, candidatos.map((c) => c.nome));
      }
    }

    if (!clienteId) {
      novos.add(nomePasta);
      if (!simular) {
        const [criado] = await db
          .insert(schema.cliente)
          .values({ empresaId: empresa.id, nome: nomePasta })
          .returning();
        clienteId = criado.id;
        porNome.set(normalizar(nomePasta), clienteId);
        porLimpo.set(semRuido(nomePasta), clienteId);
        if (idPasta) porPasta.set(idPasta, clienteId);
        catalogo = [
          ...catalogo,
          { id: clienteId, nome: nomePasta, tokens: tokens(nomePasta) },
        ];
      }
    }

    if (clienteId) resolvidos.set(nomePasta, clienteId);

    if (!arquivo) {
      pastasVazias++;
      continue;
    }

    const tipo = classificar(arquivo);
    porTipo.set(tipo, (porTipo.get(tipo) ?? 0) + 1);
    if (amostra) {
      const lista = exemplos.get(tipo) ?? [];
      if (lista.length < 12) lista.push(arquivo);
      exemplos.set(tipo, lista);
    }

    if (simular || !clienteId) continue;

    const gravado = await db
      .insert(schema.documento)
      .values({
        empresaId: empresa.id,
        clienteId,
        tipo,
        nomeArquivo: arquivo,
        caminho,
        linkDrive: ler(linha, "link") || null,
        pastaExterna: idPasta.slice(0, 80) || null,
        origem: ano.slice(0, 40) || null,
        tamanhoBytes: numero(ler(linha, "tamanho")) ?? null,
        modificadoEm: data(ler(linha, "modificado")) ?? null,
      })
      // Reimportar a listagem atualiza em vez de duplicar: arquivo renomeado
      // vira linha nova, arquivo igual só tem os metadados refrescados.
      .onConflictDoUpdate({
        target: [
          schema.documento.clienteId,
          schema.documento.caminho,
          schema.documento.nomeArquivo,
        ],
        set: {
          tipo,
          linkDrive: ler(linha, "link") || null,
          tamanhoBytes: numero(ler(linha, "tamanho")) ?? null,
          modificadoEm: data(ler(linha, "modificado")) ?? null,
        },
      })
      .returning({ id: schema.documento.id });

    if (gravado.length) documentos++;
    else jaExistiam++;
  }

  const pastas =
    casadosPasta.size +
    casadosExato.size +
    casadosLimpo.size +
    casadosToken.size +
    novos.size;

  console.log(`Linhas lidas:        ${linhasLidas}`);
  console.log(`Pastas de cliente:   ${pastas}`);
  if (casadosPasta.size) {
    console.log(`  já importadas antes: ${casadosPasta.size}`);
  }
  console.log(`  nome igual:        ${casadosExato.size}`);
  console.log(`  sem o ruído do portal: ${casadosLimpo.size}`);
  console.log(`  por nome contido:  ${casadosToken.size}`);
  console.log(`  clientes novos:    ${novos.size}`);
  console.log(`Documentos gravados: ${documentos}${jaExistiam ? ` (${jaExistiam} já existiam)` : ""}`);
  if (pastasVazias) console.log(`Pastas sem arquivo:  ${pastasVazias}`);
  if (ignorados) console.log(`Ignorados (lixo CAD): ${ignorados}`);

  if (porTipo.size) {
    console.log("\nPor tipo:");
    for (const [tipo, n] of [...porTipo].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${String(n).padStart(5)}  ${tipo}`);
      if (amostra) {
        for (const nome of exemplos.get(tipo) ?? []) {
          console.log(`           ${nome.slice(0, 88)}`);
        }
        console.log("");
      }
    }
  }

  if (casadosToken.size) {
    console.log(
      `\n${casadosToken.size} pastas casaram por um nome estar contido no outro.` +
        "\nVale uma conferida por amostragem:",
    );
    for (const nome of [...casadosToken].slice(0, 8)) console.log(`  ${nome}`);
    if (casadosToken.size > 8) console.log(`  ... e mais ${casadosToken.size - 8}`);
  }

  if (ambiguos.size) {
    console.log(
      `\n${ambiguos.size} pastas com mais de um cliente parecido. Um cliente novo` +
        "\nfoi criado em vez de adivinhar — juntar depois é fácil, separar não:",
    );
    for (const [nome, cands] of [...ambiguos].slice(0, 10)) {
      console.log(`  ${nome} → ${cands.join(" | ")}`);
    }
    if (ambiguos.size > 10) console.log(`  ... e mais ${ambiguos.size - 10}`);
  }

  if (novos.size) {
    console.log(
      `\n${novos.size} clientes que não existiam no banco` +
        (simular ? " (seriam criados)" : " (criados)") + ":",
    );
    for (const nome of [...novos].slice(0, 15)) console.log(`  ${nome}`);
    if (novos.size > 15) console.log(`  ... e mais ${novos.size - 15}`);
  }

  if (simular) {
    console.log("\nNada foi gravado. Rode sem --simular para valer.");
  }
  process.exit(0);
}

main().catch((erro) => {
  console.error("Falhou:", erro instanceof Error ? erro.message : erro);
  process.exit(1);
});
