import "dotenv/config";

import { and, asc, eq } from "drizzle-orm";

import { db, schema } from "../db";

/**
 * Semeia "a partir de qual etapa cada documento é exigido".
 *
 * Esta é a regra que faltava para a tela parar de gritar à toa. Antes dela, o
 * cliente que fechou contrato semana passada aparecia em vermelho por não ter
 * ART — e o engenheiro nem tinha começado o projeto. Com ela, o documento só é
 * cobrado a partir do momento em que **deveria** existir.
 *
 * A esteira da BB já respondia a pergunta e ninguém tinha percebido: as etapas
 * se chamam "Vistoria técnica", "Documentação do cliente", "Contrato e
 * procuração", "Projeto", "Aprovação da concessionária". O nome da etapa **é**
 * o momento em que o papel nasce.
 *
 * O que está aqui é proposta, não verdade revelada — é para o dono corrigir
 * olhando, que é muito mais fácil do que responder a pergunta no vazio.
 * Corrigir é UPDATE, não migration.
 *
 *   npm run seed:exigencias
 *   npm run seed:exigencias -- --forcar   (reescreve o que já existe)
 */

type Tipo = (typeof schema.tipoDocumento.enumValues)[number];

interface Regra {
  tipo: Tipo;
  /** `slug` da etapa a partir da qual passa a ser cobrado. */
  etapa: string;
  obrigatorio: boolean;
  exigeAssinatura: boolean;
  observacao: string;
}

const REGRAS: Regra[] = [
  {
    tipo: "uc_geradora",
    etapa: "coleta",
    obrigatorio: true,
    exigeAssinatura: false,
    observacao:
      "A conta de luz é o primeiro papel do processo: traz 13 meses de histórico numa página e é dela que sai o dimensionamento. Exigida pela NDU 013.",
  },
  {
    tipo: "orcamento",
    etapa: "proposta",
    obrigatorio: false,
    exigeAssinatura: false,
    observacao: "Nem toda venda guarda a proposta depois de fechada.",
  },
  {
    tipo: "simulacao",
    etapa: "proposta",
    obrigatorio: false,
    exigeAssinatura: false,
    observacao: "Simulação de geração e economia usada para vender.",
  },
  {
    tipo: "foto_padrao",
    etapa: "vistoria",
    obrigatorio: true,
    exigeAssinatura: false,
    observacao:
      "Fotos do padrão de entrada, tampa aberta e fechada, exigidas pela NDU 013. Saem da vistoria técnica — quem vai ao local é quem fotografa.",
  },
  {
    tipo: "documento_pessoal",
    etapa: "documentacao",
    obrigatorio: true,
    exigeAssinatura: false,
    observacao: "RG, CPF ou CNH do titular da unidade consumidora.",
  },
  {
    tipo: "ficha_cadastral",
    etapa: "documentacao",
    obrigatorio: false,
    exigeAssinatura: false,
    observacao: "Ficha interna de cadastro do cliente.",
  },
  {
    tipo: "uc_beneficiaria",
    etapa: "documentacao",
    obrigatorio: false,
    exigeAssinatura: false,
    observacao:
      "Só existe em sistema de compensação com mais de uma unidade. Condicional: não contar como falta.",
  },
  {
    tipo: "contrato",
    etapa: "contrato",
    obrigatorio: true,
    exigeAssinatura: true,
    observacao: "Contrato de fornecimento e instalação, assinado pelas partes.",
  },
  {
    tipo: "procuracao",
    etapa: "contrato",
    obrigatorio: false,
    exigeAssinatura: true,
    observacao:
      "Só quando não é o titular quem assina junto à concessionária. Condicional: não contar como falta.",
  },
  {
    tipo: "recibo",
    etapa: "contrato",
    obrigatorio: true,
    exigeAssinatura: false,
    observacao: "Comprovação do que foi pago. Protege a empresa, não trava obra.",
  },
  {
    tipo: "projeto_eletrico",
    etapa: "projeto",
    obrigatorio: true,
    exigeAssinatura: true,
    observacao:
      "As pranchas do projeto, assinadas pelo engenheiro. O `.dwg` é arquivo de trabalho e não substitui o PDF assinado.",
  },
  {
    tipo: "memorial",
    etapa: "projeto",
    obrigatorio: true,
    exigeAssinatura: true,
    observacao:
      "Memorial descritivo assinado. A planilha `.xlsm` que o gera é arquivo de trabalho, não o documento.",
  },
  {
    tipo: "art",
    etapa: "projeto",
    obrigatorio: true,
    exigeAssinatura: true,
    observacao:
      "Anotação de Responsabilidade Técnica do CREA, assinada. Sem ela a Energisa não analisa.",
  },
  {
    tipo: "boleto_art",
    etapa: "projeto",
    obrigatorio: false,
    exigeAssinatura: false,
    observacao: "Comprovante de pagamento da taxa da ART.",
  },
  {
    tipo: "datasheet",
    etapa: "projeto",
    obrigatorio: true,
    exigeAssinatura: false,
    observacao:
      "Ficha técnica e registro Inmetro do inversor e do módulo. A concessionária exige a certificação do equipamento junto do projeto.",
  },
  {
    tipo: "declaracao",
    etapa: "projeto",
    obrigatorio: false,
    exigeAssinatura: false,
    observacao:
      "Termo de solidariedade, posse, titularidade, certidão. Aparece quando o telhado é de terceiro ou o titular não é o dono.",
  },
  {
    tipo: "protocolo",
    etapa: "aprovacao",
    obrigatorio: true,
    exigeAssinatura: false,
    observacao:
      "O protocolo da Energisa é a prova de que o pedido de acesso foi aberto. Sem ele não dá para saber se o processo existe.",
  },
  {
    tipo: "compensativo",
    etapa: "aprovacao",
    obrigatorio: false,
    exigeAssinatura: false,
    observacao:
      "Formulário de adesão ao sistema de compensação. Condicional: só com mais de uma unidade.",
  },
  {
    tipo: "nota_fiscal",
    etapa: "execucao",
    obrigatorio: false,
    exigeAssinatura: false,
    observacao: "Nota do equipamento e do serviço.",
  },
  {
    tipo: "comprovante",
    etapa: "execucao",
    obrigatorio: false,
    exigeAssinatura: false,
    observacao: "Comprovantes diversos: posse, submissão, pagamento.",
  },
  // `outro` não entra de propósito. Ausência de regra significa "nunca
  // cobrado", que é a resposta certa para arquivo que não se sabe o que é.
];

async function main() {
  const forcar = process.argv.includes("--forcar");

  const empresa = await db.query.empresa.findFirst();
  if (!empresa) {
    console.error("Nenhuma empresa no banco. Rode `npm run db:seed` primeiro.");
    process.exit(1);
  }

  const etapas = await db.query.etapa.findMany({
    where: eq(schema.etapa.empresaId, empresa.id),
    orderBy: asc(schema.etapa.ordem),
  });
  if (etapas.length === 0) {
    console.error("Nenhuma etapa cadastrada. Rode `npm run db:seed` primeiro.");
    process.exit(1);
  }

  /**
   * Casa a regra com a etapa pelo começo do slug.
   *
   * O slug real da BB é `coleta-informacoes`, `vistoria-tecnica`,
   * `documentacao-cliente` — escrever o slug inteiro aqui amarraria este
   * arquivo à grafia exata de uma empresa, e o sistema é multi-tenant.
   */
  const acharEtapa = (prefixo: string) =>
    etapas.find((e) => e.slug.startsWith(prefixo)) ??
    etapas.find((e) => e.slug.includes(prefixo));

  let criadas = 0;
  let atualizadas = 0;
  let semEtapa = 0;

  for (const regra of REGRAS) {
    const etapa = acharEtapa(regra.etapa);
    if (!etapa) {
      console.warn(`  ! etapa "${regra.etapa}" não existe — ${regra.tipo} ficou de fora`);
      semEtapa++;
      continue;
    }

    const existente = await db.query.exigenciaDocumento.findFirst({
      where: and(
        eq(schema.exigenciaDocumento.empresaId, empresa.id),
        eq(schema.exigenciaDocumento.tipo, regra.tipo),
      ),
    });

    if (existente && !forcar) continue;

    const valores = {
      empresaId: empresa.id,
      tipo: regra.tipo,
      etapaId: etapa.id,
      obrigatorio: regra.obrigatorio,
      exigeAssinatura: regra.exigeAssinatura,
      observacao: regra.observacao,
    };

    if (existente) {
      await db
        .update(schema.exigenciaDocumento)
        .set(valores)
        .where(eq(schema.exigenciaDocumento.id, existente.id));
      atualizadas++;
    } else {
      await db.insert(schema.exigenciaDocumento).values(valores);
      criadas++;
    }
  }

  console.log(`Exigências criadas:    ${criadas}`);
  if (atualizadas) console.log(`Exigências atualizadas: ${atualizadas}`);
  if (semEtapa) console.log(`Sem etapa correspondente: ${semEtapa}`);

  const todas = await db.query.exigenciaDocumento.findMany({
    where: eq(schema.exigenciaDocumento.empresaId, empresa.id),
    with: { etapa: true },
  });
  todas.sort((a, b) => a.etapa.ordem - b.etapa.ordem);

  console.log("\nCobrado a partir de:");
  let ultima = "";
  for (const e of todas) {
    if (e.etapa.nome !== ultima) {
      console.log(`\n  ${e.etapa.ordem}. ${e.etapa.nome}`);
      ultima = e.etapa.nome;
    }
    const marcas = [
      e.obrigatorio ? "obrigatório" : "condicional",
      e.exigeAssinatura ? "só vale assinado" : null,
    ].filter(Boolean);
    console.log(`       ${e.tipo.padEnd(18)} ${marcas.join(", ")}`);
  }

  process.exit(0);
}

main().catch((erro) => {
  console.error("Falhou:", erro instanceof Error ? erro.message : erro);
  process.exit(1);
});
