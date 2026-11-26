import { relations, sql } from "drizzle-orm";
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import { empresa, usuario } from "./cadastro";
import { modeloEquipamento, ordemServico } from "./operacao";

/**
 * O estoque (migração 0031): itens, entradas por nota ou pedido, o material
 * usado em cada OS e o livro de movimentos. O saldo é a soma dos movimentos —
 * nada se apaga, corrigir grava um estorno.
 */

/** Uma linha lida da nota ou do pedido, como fica guardada no rascunho da entrada. */
export interface LinhaDaEntrada {
  descricao: string;
  quantidade: number;
  unidade: string;
  codigo: string | null;
  valorUnitario: number | null;
  /** lista (itens da nota), observacao (informações complementares) ou pedido. */
  origem: "lista" | "observacao" | "pedido";
  /** Entra no estoque? O resumo do kit e as repetidas começam fora. */
  entra: boolean;
  /** Por que começou fora, em poucas palavras. */
  motivo: string | null;
  /** O item do estoque sugerido (ou escolhido na conferência). */
  itemId: string | null;
  /** O modelo do catálogo sugerido, para quando vira item novo. */
  modeloId: string | null;
}

export const itemEstoque = pgTable(
  "item_estoque",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    empresaId: uuid("empresa_id")
      .notNull()
      .references(() => empresa.id, { onDelete: "cascade" }),
    nome: text("nome").notNull(),
    /** O nome sem acento, caixa e pontuação: impede dois itens iguais. */
    chave: text("chave").notNull(),
    /** Código do fornecedor (cProd da nota). */
    codigo: text("codigo"),
    unidade: varchar("unidade", { length: 10 }).notNull().default("un"),
    modeloEquipamentoId: uuid("modelo_equipamento_id").references(() => modeloEquipamento.id, {
      onDelete: "set null",
    }),
    minimo: numeric("minimo", { precision: 12, scale: 3 }),
    ativo: boolean("ativo").notNull().default(true),
    criadoEm: timestamp("criado_em", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("item_estoque_chave_uq").on(t.empresaId, t.chave)],
);

export const entradaEstoque = pgTable(
  "entrada_estoque",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    empresaId: uuid("empresa_id")
      .notNull()
      .references(() => empresa.id, { onDelete: "cascade" }),
    /** rascunho | lancada | desfeita */
    situacao: varchar("situacao", { length: 12 }).notNull().default("rascunho"),
    numero: text("numero"),
    fornecedor: text("fornecedor"),
    cnpjFornecedor: varchar("cnpj_fornecedor", { length: 14 }),
    emitidaEm: date("emitida_em"),
    chaveAcesso: varchar("chave_acesso", { length: 44 }),
    valorTotal: numeric("valor_total", { precision: 14, scale: 2 }),
    /** xml | ia | manual */
    leitura: varchar("leitura", { length: 10 }),
    aviso: text("aviso"),
    itensLidos: jsonb("itens_lidos").$type<LinhaDaEntrada[]>().notNull().default([]),
    criadoPor: uuid("criado_por").references(() => usuario.id, { onDelete: "set null" }),
    criadoEm: timestamp("criado_em", { withTimezone: true }).notNull().defaultNow(),
    lancadaPor: uuid("lancada_por").references(() => usuario.id, { onDelete: "set null" }),
    lancadaEm: timestamp("lancada_em", { withTimezone: true }),
    desfeitaPor: uuid("desfeita_por").references(() => usuario.id, { onDelete: "set null" }),
    desfeitaEm: timestamp("desfeita_em", { withTimezone: true }),
  },
  (t) => [
    index("entrada_estoque_empresa_idx").on(t.empresaId, t.criadoEm),
    uniqueIndex("entrada_estoque_chave_uq")
      .on(t.empresaId, t.chaveAcesso)
      .where(sql`${t.chaveAcesso} IS NOT NULL AND ${t.situacao} = 'lancada'`),
  ],
);

export const entradaEstoqueArquivo = pgTable(
  "entrada_estoque_arquivo",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    empresaId: uuid("empresa_id")
      .notNull()
      .references(() => empresa.id, { onDelete: "cascade" }),
    entradaId: uuid("entrada_id")
      .notNull()
      .references(() => entradaEstoque.id, { onDelete: "cascade" }),
    /** nota | pedido */
    papel: varchar("papel", { length: 10 }).notNull(),
    nome: text("nome").notNull(),
    mime: varchar("mime", { length: 100 }).notNull(),
    tamanho: integer("tamanho"),
    driveId: text("drive_id"),
    driveLink: text("drive_link"),
    criadoEm: timestamp("criado_em", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("entrada_estoque_arquivo_entrada_idx").on(t.entradaId)],
);

export const osMaterial = pgTable(
  "os_material",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    empresaId: uuid("empresa_id")
      .notNull()
      .references(() => empresa.id, { onDelete: "cascade" }),
    ordemServicoId: uuid("ordem_servico_id")
      .notNull()
      .references(() => ordemServico.id, { onDelete: "cascade" }),
    itemId: uuid("item_id")
      .notNull()
      .references(() => itemEstoque.id, { onDelete: "no action" }),
    quantidade: numeric("quantidade", { precision: 12, scale: 3 }).notNull(),
    observacao: text("observacao"),
    registradoPor: uuid("registrado_por").references(() => usuario.id, { onDelete: "set null" }),
    registradoEm: timestamp("registrado_em", { withTimezone: true }).notNull().defaultNow(),
    idCliente: varchar("id_cliente", { length: 64 }),
  },
  (t) => [
    index("os_material_os_idx").on(t.ordemServicoId),
    uniqueIndex("os_material_id_cliente_uq").on(t.empresaId, t.idCliente).where(sql`${t.idCliente} IS NOT NULL`),
  ],
);

export const movimentoEstoque = pgTable(
  "movimento_estoque",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    empresaId: uuid("empresa_id")
      .notNull()
      .references(() => empresa.id, { onDelete: "cascade" }),
    itemId: uuid("item_id")
      .notNull()
      .references(() => itemEstoque.id, { onDelete: "no action" }),
    /** Positivo entra, negativo sai. */
    quantidade: numeric("quantidade", { precision: 12, scale: 3 }).notNull(),
    /** entrada | ajuste | os | estorno */
    motivo: varchar("motivo", { length: 10 }).notNull(),
    entradaId: uuid("entrada_id").references(() => entradaEstoque.id, { onDelete: "set null" }),
    ordemServicoId: uuid("ordem_servico_id").references(() => ordemServico.id, { onDelete: "set null" }),
    observacao: text("observacao"),
    usuarioId: uuid("usuario_id").references(() => usuario.id, { onDelete: "set null" }),
    /** web | app | sistema */
    origem: varchar("origem", { length: 10 }).notNull().default("web"),
    criadoEm: timestamp("criado_em", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("movimento_estoque_item_idx").on(t.itemId, t.criadoEm),
    index("movimento_estoque_empresa_idx").on(t.empresaId, t.criadoEm),
    index("movimento_estoque_os_idx").on(t.ordemServicoId).where(sql`${t.ordemServicoId} IS NOT NULL`),
  ],
);

export const itemEstoqueRelations = relations(itemEstoque, ({ one, many }) => ({
  modelo: one(modeloEquipamento, {
    fields: [itemEstoque.modeloEquipamentoId],
    references: [modeloEquipamento.id],
  }),
  movimentos: many(movimentoEstoque),
}));

export const entradaEstoqueRelations = relations(entradaEstoque, ({ one, many }) => ({
  arquivos: many(entradaEstoqueArquivo),
  criador: one(usuario, { fields: [entradaEstoque.criadoPor], references: [usuario.id] }),
}));

export const entradaEstoqueArquivoRelations = relations(entradaEstoqueArquivo, ({ one }) => ({
  entrada: one(entradaEstoque, { fields: [entradaEstoqueArquivo.entradaId], references: [entradaEstoque.id] }),
}));

export const osMaterialRelations = relations(osMaterial, ({ one }) => ({
  item: one(itemEstoque, { fields: [osMaterial.itemId], references: [itemEstoque.id] }),
  registrador: one(usuario, { fields: [osMaterial.registradoPor], references: [usuario.id] }),
}));

export const movimentoEstoqueRelations = relations(movimentoEstoque, ({ one }) => ({
  item: one(itemEstoque, { fields: [movimentoEstoque.itemId], references: [itemEstoque.id] }),
  entrada: one(entradaEstoque, { fields: [movimentoEstoque.entradaId], references: [entradaEstoque.id] }),
  ordemServico: one(ordemServico, { fields: [movimentoEstoque.ordemServicoId], references: [ordemServico.id] }),
  usuario: one(usuario, { fields: [movimentoEstoque.usuarioId], references: [usuario.id] }),
}));
