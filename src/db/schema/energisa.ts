import { index, integer, pgTable, text, timestamp, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";

import { empresa, usuario } from "./cadastro";
import { projeto } from "./operacao";

/**
 * Cada projeto que a empresa tem no portal de projetos da Energisa (AWGPE), do
 * jeito que o robô leu na última passada.
 *
 * Não há API: o robô (`energisa/robo.ts`) abre a página "Meus projetos" num
 * navegador de verdade, logado com a conta da empresa, e lê a lista que a
 * própria página recebe pronta do servidor. Esta tabela é o retrato dessa
 * lista, mais o vínculo com o projeto do Selebi.
 *
 * Um projeto do Selebi pode ter várias linhas: o indeferido e reenviado vira
 * outra entrada no portal ("V2", "V3"). Qual vale agora sai de `vigente()`.
 */
export const energisaProjeto = pgTable(
  "energisa_projeto",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    empresaId: uuid("empresa_id")
      .notNull()
      .references(() => empresa.id, { onDelete: "cascade" }),
    /** O "ID Geração" do portal (`numeroProjetoEletrico`). */
    numero: varchar("numero", { length: 20 }).notNull(),
    empreendimento: text("empreendimento").notNull(),
    endereco: text("endereco"),
    /** "MICROGERAÇÃO DISTRIBUÍDA", "AUMENTO DE GERAÇÃO - MICROGERAÇÃO". */
    tipo: text("tipo"),
    /** A "Data de Entrada" do portal. */
    dataAbertura: timestamp("data_abertura", { withTimezone: true }),
    /** Código de uma letra do portal ("P" = Projeto Aprovado). Ver `energisa/situacoes.ts`. */
    codigoSituacao: varchar("codigo_situacao", { length: 4 }),
    descricaoSituacao: text("descricao_situacao"),
    /** A fase para a esteira (`FaseEnergisa`). */
    fase: varchar("fase", { length: 30 }).notNull(),
    /** Quando a situação mudou pela última vez (a primeira leitura conta como mudança). */
    situacaoDesde: timestamp("situacao_desde", { withTimezone: true }).notNull().defaultNow(),
    projetoId: uuid("projeto_id").references(() => projeto.id, { onDelete: "set null" }),
    /** `automatico` (pelo nome) ou `manual` (alguém escolheu na tela). */
    vinculo: varchar("vinculo", { length: 12 }),
    /**
     * A situação para a qual a esteira já reagiu. Muda o código, a esteira
     * reage uma vez — e quem mover o cartão à mão depois não é desfeito.
     */
    aplicadoCodigo: varchar("aplicado_codigo", { length: 4 }),
    vistoEm: timestamp("visto_em", { withTimezone: true }).notNull().defaultNow(),
    criadoEm: timestamp("criado_em", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("energisa_projeto_numero_uq").on(t.empresaId, t.numero),
    index("energisa_projeto_projeto_idx").on(t.projetoId),
  ],
);

/**
 * O robô da Energisa e o site conversando: em que pé o robô está, e o que
 * alguém pediu pela tela (entrar, ler agora, o código do SMS).
 *
 * Uma linha por empresa. O robô roda noutro container e lê esta linha a cada
 * poucos segundos enquanto espera o código — o banco é o único lugar que os
 * dois já enxergam.
 */
export const roboEnergisa = pgTable("robo_energisa", {
  empresaId: uuid("empresa_id")
    .primaryKey()
    .references(() => empresa.id, { onDelete: "cascade" }),
  /** conectado | desconectado | entrando | aguardando_codigo | erro | bloqueado | parado */
  estado: varchar("estado", { length: 20 }).notNull().default("parado"),
  mensagem: text("mensagem"),
  ultimaLeituraEm: timestamp("ultima_leitura_em", { withTimezone: true }),
  totalProjetos: integer("total_projetos"),
  /** O que a tela pediu: `entrar` ou `ler`. O robô limpa depois de atender. */
  pedido: varchar("pedido", { length: 10 }),
  pedidoPorId: uuid("pedido_por_id").references(() => usuario.id, { onDelete: "set null" }),
  /** O código do SMS, digitado na tela. Vive só até o robô usar. */
  codigo: varchar("codigo", { length: 12 }),
  codigoEm: timestamp("codigo_em", { withTimezone: true }),
  atualizadoEm: timestamp("atualizado_em", { withTimezone: true }).notNull().defaultNow(),
});
