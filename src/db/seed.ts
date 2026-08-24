import "dotenv/config";

import { sql } from "drizzle-orm";

import { gerarHash } from "../auth/senha";
import { db, schema } from "./index";

/**
 * Senha de desenvolvimento, igual para os cinco usuários semeados.
 *
 * Só serve para entrar na tela enquanto o sistema não sai da máquina de quem
 * desenvolve. Antes de qualquer instalação real, cada pessoa precisa da sua —
 * senão o login nominal, que é o motivo de existir usuário separado, não vale
 * nada.
 */
const SENHA_DEV = process.env.SEED_SENHA || "bbsolucoes";

/**
 * Semeia a empresa, a esteira e um punhado de projetos de demonstração.
 *
 * As 12 etapas são as que a BB Soluções escreveu à mão na reunião. A ordem vai
 * de 10 em 10 de propósito: sabemos que falta pelo menos uma etapa (a
 * instalação, entre a aprovação da concessionária e o pedido de vistoria) e
 * possivelmente outras. Com espaço entre os números, encaixar etapa nova é um
 * INSERT — sem renumerar nada.
 *
 * CLIENTES E PROJETOS AQUI SÃO FICTÍCIOS. Servem para a tela ter o que mostrar.
 *
 *   npm run db:seed
 */

const ETAPAS = [
  {
    slug: "lead",
    nome: "Lead",
    ordem: 10,
    papelResponsavel: "vendedor",
    descricao: "Entrada por Instagram, tráfego pago e anúncios.",
  },
  {
    slug: "coleta_info",
    nome: "Coleta de informações",
    ordem: 20,
    papelResponsavel: "vendedor",
    descricao: "Via WhatsApp, ligação ou presencial.",
  },
  {
    slug: "proposta",
    nome: "Proposta comercial",
    ordem: 30,
    papelResponsavel: "vendedor",
    descricao: "Apresentação ao cliente.",
  },
  {
    slug: "pagamento",
    nome: "Forma de pagamento",
    ordem: 40,
    papelResponsavel: "vendedor",
    descricao: "Simulação: banco, cartão, cheque, boleto comercial ou à vista.",
  },
  {
    slug: "vistoria_tecnica",
    nome: "Vistoria técnica",
    ordem: 50,
    papelResponsavel: "tecnico",
    descricao:
      "Localização, fotos e vídeo: quadro, medidas, frente da residência, local do aparelho e drone no telhado.",
  },
  {
    slug: "documentacao",
    nome: "Documentação do cliente",
    ordem: 60,
    papelResponsavel: "vendedor",
    descricao: "RG ou CNH, talão de energia e e-mail.",
  },
  {
    slug: "contrato",
    nome: "Contrato e procuração",
    ordem: 70,
    papelResponsavel: "adm",
    descricao: "Com foto do cliente segurando o documento pessoal.",
  },
  {
    slug: "projeto",
    nome: "Projeto",
    ordem: 80,
    papelResponsavel: "engenheiro",
    descricao: "Boleto da ART, ART, memorial descritivo, submissão e aprovação.",
  },
  {
    slug: "aprovacao_concessionaria",
    nome: "Aprovação da concessionária",
    ordem: 90,
    papelResponsavel: "engenheiro",
    descricao: "Em caso de obra, a concessionária atesta um novo prazo.",
  },
  // Espaço reservado em 100: a instalação provavelmente entra aqui.
  {
    slug: "pedido_vistoria",
    nome: "Pedido de vistoria",
    ordem: 110,
    papelResponsavel: "engenheiro",
    descricao: "Ligação do sistema pela concessionária.",
    prazoPadraoDias: 5,
  },
  {
    slug: "monitoramento",
    nome: "Monitoramento",
    ordem: 120,
    papelResponsavel: "adm",
    descricao: "Usina gerando e sob acompanhamento.",
  },
  {
    slug: "pos_venda",
    nome: "Pós-venda",
    ordem: 130,
    papelResponsavel: "adm",
    descricao:
      "Nos 2 primeiros meses, solicitar as contas de energia para conferir o abatimento.",
    terminal: true,
  },
] as const;

const USUARIOS = [
  { nome: "Administração", email: "adm@bbsolucoes.local", papel: "adm" },
  { nome: "Vendedor", email: "vendas@bbsolucoes.local", papel: "vendedor" },
  { nome: "Engenharia", email: "engenharia@bbsolucoes.local", papel: "engenheiro" },
  { nome: "Técnico", email: "tecnico@bbsolucoes.local", papel: "tecnico" },
  { nome: "Estoque", email: "estoque@bbsolucoes.local", papel: "estoque" },
] as const;

/**
 * Clientes fictícios, só para a esteira ter o que mostrar.
 *
 * `dias` é há quanto tempo o projeto está parado na etapa. Os números não são
 * aleatórios: concentram o atraso na aprovação da concessionária, que é o
 * gargalo clássico do setor. Se na conversa com o cliente o acúmulo aparecer em
 * outra etapa, é essa etapa que o sistema precisa vigiar.
 */
const DEMO = [
  { nome: "Maria Souza", cidade: "Aracaju", etapa: "lead", kwp: 5.4, dias: 1 },
  { nome: "João Batista", cidade: "Itabaiana", etapa: "lead", kwp: 8.1, dias: 3 },
  { nome: "Padaria Central", cidade: "Lagarto", etapa: "coleta_info", kwp: 22, dias: 2 },
  { nome: "Rita Andrade", cidade: "Aracaju", etapa: "proposta", kwp: 6.6, dias: 4 },
  { nome: "Mercado do Bairro", cidade: "Itabaiana", etapa: "proposta", kwp: 35, dias: 9 },
  { nome: "Carlos Meneses", cidade: "Estância", etapa: "pagamento", kwp: 9.9, dias: 6 },
  {
    nome: "Clínica São Lucas",
    cidade: "Aracaju",
    etapa: "vistoria_tecnica",
    kwp: 48,
    dias: 3,
  },
  {
    nome: "Antônio Ribeiro",
    cidade: "Lagarto",
    etapa: "documentacao",
    kwp: 7.2,
    dias: 11,
  },
  { nome: "Fernanda Lima", cidade: "Aracaju", etapa: "contrato", kwp: 11.5, dias: 2 },
  { nome: "Oficina do Zé", cidade: "Itabaiana", etapa: "projeto", kwp: 18.7, dias: 8 },
  { nome: "Escola Nova Era", cidade: "Aracaju", etapa: "projeto", kwp: 62, dias: 15 },
  {
    nome: "Roberto Nunes",
    cidade: "Estância",
    etapa: "aprovacao_concessionaria",
    kwp: 10.3,
    dias: 34,
  },
  {
    nome: "Supermercado Bom Preço",
    cidade: "Lagarto",
    etapa: "aprovacao_concessionaria",
    kwp: 75,
    dias: 47,
  },
  {
    nome: "Luciana Prado",
    cidade: "Aracaju",
    etapa: "pedido_vistoria",
    kwp: 8.8,
    dias: 7,
  },
  {
    nome: "Marcos Vieira",
    cidade: "Itabaiana",
    etapa: "monitoramento",
    kwp: 12.1,
    dias: 20,
  },
  {
    nome: "Pousada Maré Alta",
    cidade: "Aracaju",
    etapa: "pos_venda",
    kwp: 27.5,
    dias: 40,
  },
] as const;

async function main() {
  console.log("Semeando...\n");

  // Repetível de propósito: rode antes de mostrar a tela para alguém e a demo
  // volta ao estado original, com os projetos nas etapas certas.
  await db.execute(sql`TRUNCATE TABLE empresa CASCADE`);

  const [empresa] = await db
    .insert(schema.empresa)
    .values({ nome: "BB Soluções", cnpj: null })
    .returning();
  console.log(`Empresa: ${empresa.nome}`);

  const etapas = await db
    .insert(schema.etapa)
    .values(
      ETAPAS.map((e) => ({
        empresaId: empresa.id,
        slug: e.slug,
        nome: e.nome,
        ordem: e.ordem,
        descricao: e.descricao,
        papelResponsavel: e.papelResponsavel,
        prazoPadraoDias: "prazoPadraoDias" in e ? e.prazoPadraoDias : null,
        terminal: "terminal" in e ? e.terminal : false,
      })),
    )
    .returning();
  console.log(`Etapas: ${etapas.length}`);

  const porSlug = new Map(etapas.map((e) => [e.slug, e]));

  const hash = await gerarHash(SENHA_DEV);
  const usuarios = await db
    .insert(schema.usuario)
    .values(
      USUARIOS.map((u) => ({
        empresaId: empresa.id,
        nome: u.nome,
        email: u.email,
        senhaHash: hash,
        papel: u.papel,
      })),
    )
    .returning();
  console.log(`Usuários: ${usuarios.length} (senha "${SENHA_DEV}" para todos)`);

  const porPapel = new Map(usuarios.map((u) => [u.papel, u]));

  const clientes = await db
    .insert(schema.cliente)
    .values(
      DEMO.map((d) => ({
        empresaId: empresa.id,
        nome: d.nome,
        cidade: d.cidade,
        uf: "SE",
        tipo: "pf" as const,
      })),
    )
    .returning();

  const agora = Date.now();
  await db.insert(schema.projeto).values(
    DEMO.map((d, i) => {
      const etapa = porSlug.get(d.etapa)!;
      const responsavel = etapa.papelResponsavel
        ? porPapel.get(etapa.papelResponsavel)
        : undefined;
      const desde = new Date(agora - d.dias * 86_400_000);
      return {
        empresaId: empresa.id,
        clienteId: clientes[i].id,
        etapaId: etapa.id,
        titulo: `${d.kwp} kWp — ${d.cidade}`,
        potenciaKwp: String(d.kwp),
        responsavelId: responsavel?.id ?? null,
        etapaDesde: desde,
        prazoEtapa: etapa.prazoPadraoDias
          ? new Date(desde.getTime() + etapa.prazoPadraoDias * 86_400_000)
          : null,
        situacao: etapa.terminal ? ("concluido" as const) : ("em_andamento" as const),
      };
    }),
  );
  console.log(`Projetos de demonstração: ${DEMO.length}`);

  console.log("\nPronto. Rode `npm run dev` e abra http://localhost:3000");
  process.exit(0);
}

main().catch((erro) => {
  console.error("Falhou:", erro instanceof Error ? erro.message : erro);
  process.exit(1);
});
