import {
  boolean,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import { cliente, empresa, usina, usuario } from "./cadastro";
import {
  entidadeComentario,
  origemOs,
  papelUsuario,
  prioridadeOs,
  situacaoProjeto,
  statusOs,
  tipoOs,
} from "./enums";

/**
 * Uma etapa da esteira, por empresa.
 *
 * Tabela e não enum: o fluxo da BB tem 12 etapas levantadas à mão e ainda há
 * buraco conhecido (a instalação não apareceu na lista deles). Mudar a esteira
 * precisa ser conversa com o cliente virando dado, não migration.
 */
export const etapa = pgTable(
  "etapa",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    empresaId: uuid("empresa_id")
      .notNull()
      .references(() => empresa.id, { onDelete: "cascade" }),
    slug: varchar("slug", { length: 40 }).notNull(),
    nome: text("nome").notNull(),
    /** Posição na esteira. Deixa buraco entre os números para caber etapa nova. */
    ordem: integer("ordem").notNull(),
    descricao: text("descricao"),
    /** Papel que costuma tocar esta etapa — sugere o responsável na entrada. */
    papelResponsavel: papelUsuario("papel_responsavel"),
    /** Prazo esperado. Estourou, vira alerta. Null = sem prazo definido. */
    prazoPadraoDias: integer("prazo_padrao_dias"),
    /** Etapa que encerra o projeto com sucesso. */
    terminal: boolean("terminal").notNull().default(false),
    ativa: boolean("ativa").notNull().default(true),
    criadoEm: timestamp("criado_em", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("etapa_slug_uq").on(t.empresaId, t.slug),
    index("etapa_ordem_idx").on(t.empresaId, t.ordem),
  ],
);

/**
 * A esteira: um projeto atravessa etapas, cada uma com dono e prazo.
 * O painel disso é o que responde "e aí, saiu?" sem ninguém precisar perguntar.
 */
export const projeto = pgTable(
  "projeto",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    empresaId: uuid("empresa_id")
      .notNull()
      .references(() => empresa.id, { onDelete: "cascade" }),
    clienteId: uuid("cliente_id")
      .notNull()
      .references(() => cliente.id, { onDelete: "restrict" }),
    usinaId: uuid("usina_id").references(() => usina.id, { onDelete: "set null" }),
    titulo: text("titulo").notNull(),
    etapaId: uuid("etapa_id")
      .notNull()
      .references(() => etapa.id, { onDelete: "restrict" }),
    situacao: situacaoProjeto("situacao").notNull().default("em_andamento"),
    responsavelId: uuid("responsavel_id").references(() => usuario.id, {
      onDelete: "set null",
    }),
    /** Prazo da etapa atual. Estourou, vira alerta. */
    prazoEtapa: timestamp("prazo_etapa", { withTimezone: false }),
    /** Quando entrou na etapa atual — base do tempo médio por etapa. */
    etapaDesde: timestamp("etapa_desde", { withTimezone: true })
      .notNull()
      .defaultNow(),
    valor: numeric("valor", { precision: 12, scale: 2 }),
    potenciaKwp: numeric("potencia_kwp", { precision: 10, scale: 3 }),

    /**
     * Etapa 2, coleta de informações.
     *
     * O consumo médio é a base do dimensionamento, e sai da conta de luz — que
     * traz 13 meses de histórico numa página só. O cliente disse que hoje faz
     * "a média dos talões" com uma calculadora do setor de engenharia; aqui o
     * número fica registrado junto do projeto em vez de morrer na planilha.
     */
    consumoMedioKwh: numeric("consumo_medio_kwh", { precision: 10, scale: 2 }),
    concessionaria: text("concessionaria"),
    /** O que o cliente pediu, incluindo aparelhos que pretende acrescentar. */
    observacoes: text("observacoes"),

    /**
     * Etapa 5, vistoria técnica — feita pelo técnico, antes de vender.
     *
     * Não confundir com o pedido de vistoria da etapa 11, que é da Energisa
     * para ligar o sistema. São processos diferentes, com gente diferente, e o
     * cliente confirmou isso no questionário.
     */
    vistoriaEm: timestamp("vistoria_em", { withTimezone: false }),
    vistoriaPorId: uuid("vistoria_por_id").references(() => usuario.id, {
      onDelete: "set null",
    }),
    vistoriaObservacoes: text("vistoria_observacoes"),
    /** Protocolo do parecer de acesso — o gargalo clássico do setor. */
    protocoloConcessionaria: text("protocolo_concessionaria"),
    /** ART do engenheiro responsável, emitida na etapa de projeto. */
    numeroArt: text("numero_art"),
    criadoEm: timestamp("criado_em", { withTimezone: true }).notNull().defaultNow(),
    atualizadoEm: timestamp("atualizado_em", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("projeto_empresa_etapa_idx").on(t.empresaId, t.etapaId),
    index("projeto_situacao_idx").on(t.empresaId, t.situacao),
    index("projeto_responsavel_idx").on(t.responsavelId),
    index("projeto_prazo_idx").on(t.empresaId, t.prazoEtapa),
  ],
);

/**
 * Histórico de movimentação na esteira. É daqui que sai o tempo médio por
 * etapa — o número que mostra onde a empresa realmente trava.
 */
export const projetoEvento = pgTable(
  "projeto_evento",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    empresaId: uuid("empresa_id")
      .notNull()
      .references(() => empresa.id, { onDelete: "cascade" }),
    projetoId: uuid("projeto_id")
      .notNull()
      .references(() => projeto.id, { onDelete: "cascade" }),
    etapaDeId: uuid("etapa_de_id").references(() => etapa.id, {
      onDelete: "set null",
    }),
    etapaParaId: uuid("etapa_para_id")
      .notNull()
      .references(() => etapa.id, { onDelete: "restrict" }),
    /** Quanto tempo o projeto passou na etapa anterior, em horas. */
    horasNaEtapaAnterior: integer("horas_na_etapa_anterior"),
    usuarioId: uuid("usuario_id").references(() => usuario.id, {
      onDelete: "set null",
    }),
    observacao: text("observacao"),
    ocorridoEm: timestamp("ocorrido_em", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("projeto_evento_projeto_idx").on(t.projetoId, t.ocorridoEm)],
);

export const ordemServico = pgTable(
  "ordem_servico",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    empresaId: uuid("empresa_id")
      .notNull()
      .references(() => empresa.id, { onDelete: "cascade" }),
    /** Sequencial por empresa, o número que o cliente usa pra falar da OS. */
    numero: integer("numero").notNull(),
    clienteId: uuid("cliente_id")
      .notNull()
      .references(() => cliente.id, { onDelete: "restrict" }),
    usinaId: uuid("usina_id").references(() => usina.id, { onDelete: "set null" }),
    tipo: tipoOs("tipo").notNull(),
    status: statusOs("status").notNull().default("aberta"),
    prioridade: prioridadeOs("prioridade").notNull().default("normal"),
    origem: origemOs("origem").notNull().default("manual"),
    descricao: text("descricao").notNull(),
    responsavelId: uuid("responsavel_id").references(() => usuario.id, {
      onDelete: "set null",
    }),
    abertaPorId: uuid("aberta_por_id").references(() => usuario.id, {
      onDelete: "set null",
    }),
    agendadaPara: timestamp("agendada_para", { withTimezone: false }),
    prazoSla: timestamp("prazo_sla", { withTimezone: false }),
    iniciadaEm: timestamp("iniciada_em", { withTimezone: true }),
    concluidaEm: timestamp("concluida_em", { withTimezone: true }),
    laudo: text("laudo"),
    criadoEm: timestamp("criado_em", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("os_empresa_status_idx").on(t.empresaId, t.status),
    index("os_responsavel_idx").on(t.responsavelId, t.status),
    index("os_usina_idx").on(t.usinaId),
    /**
     * O número da OS é o que o cliente cita ao telefone, então dois chamados
     * com o mesmo número seria confusão garantida. Como ele é sequencial por
     * empresa e calculado a partir do maior existente, duas aberturas
     * simultâneas leriam o mesmo máximo — é este índice que barra a segunda.
     */
    uniqueIndex("os_numero_uq").on(t.empresaId, t.numero),
  ],
);

/**
 * Checklist do técnico. Itens obrigatórios travam o botão de concluir —
 * é o que garante que foto e assinatura voltem do campo.
 */
export const osChecklistItem = pgTable(
  "os_checklist_item",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    empresaId: uuid("empresa_id")
      .notNull()
      .references(() => empresa.id, { onDelete: "cascade" }),
    ordemServicoId: uuid("ordem_servico_id")
      .notNull()
      .references(() => ordemServico.id, { onDelete: "cascade" }),
    ordem: integer("ordem").notNull().default(0),
    descricao: text("descricao").notNull(),
    obrigatorio: boolean("obrigatorio").notNull().default(false),
    concluido: boolean("concluido").notNull().default(false),
    observacao: text("observacao"),
    concluidoEm: timestamp("concluido_em", { withTimezone: true }),
  },
  (t) => [index("os_checklist_os_idx").on(t.ordemServicoId, t.ordem)],
);

export const osAnexo = pgTable(
  "os_anexo",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    empresaId: uuid("empresa_id")
      .notNull()
      .references(() => empresa.id, { onDelete: "cascade" }),
    ordemServicoId: uuid("ordem_servico_id")
      .notNull()
      .references(() => ordemServico.id, { onDelete: "cascade" }),
    /** foto | assinatura | documento */
    categoria: text("categoria").notNull().default("foto"),
    caminho: text("caminho").notNull(),
    nomeOriginal: text("nome_original"),
    tamanhoBytes: integer("tamanho_bytes"),
    enviadoPorId: uuid("enviado_por_id").references(() => usuario.id, {
      onDelete: "set null",
    }),
    /** Data/hora do aparelho: o app é offline-first e sobe o anexo depois. */
    capturadoEm: timestamp("capturado_em", { withTimezone: true }),
    criadoEm: timestamp("criado_em", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("os_anexo_os_idx").on(t.ordemServicoId)],
);

/**
 * Comentário preso ao objeto — a OS, o projeto, o cliente. É o que substitui
 * a comunidade do WhatsApp sem virar chat: contexto junto, e pesquisável.
 */
export const comentario = pgTable(
  "comentario",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    empresaId: uuid("empresa_id")
      .notNull()
      .references(() => empresa.id, { onDelete: "cascade" }),
    entidade: entidadeComentario("entidade").notNull(),
    entidadeId: uuid("entidade_id").notNull(),
    autorId: uuid("autor_id").references(() => usuario.id, { onDelete: "set null" }),
    texto: text("texto").notNull(),
    criadoEm: timestamp("criado_em", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("comentario_entidade_idx").on(t.empresaId, t.entidade, t.entidadeId),
  ],
);
