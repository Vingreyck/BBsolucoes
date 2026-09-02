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

import {
  fabricantePortal,
  papelUsuario,
  statusUsina,
  tipoEquipamento,
  tipoPessoa,
} from "./enums";

/**
 * Tenant. Toda tabela do sistema carrega `empresaId` desde a primeira migration:
 * a BB Soluções é a empresa nº 1, não a única. Retrofitar isso depois é reescrita.
 */
export const empresa = pgTable("empresa", {
  id: uuid("id").primaryKey().defaultRandom(),
  nome: text("nome").notNull(),
  cnpj: varchar("cnpj", { length: 14 }),
  ativa: boolean("ativa").notNull().default(true),
  criadoEm: timestamp("criado_em", { withTimezone: true }).notNull().defaultNow(),
});

/** Usuário nominal. Acaba com o login compartilhado — requisito de LGPD. */
export const usuario = pgTable(
  "usuario",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    empresaId: uuid("empresa_id")
      .notNull()
      .references(() => empresa.id, { onDelete: "cascade" }),
    nome: text("nome").notNull(),
    email: text("email").notNull(),
    senhaHash: text("senha_hash").notNull(),
    papel: papelUsuario("papel").notNull().default("vendedor"),
    telefone: varchar("telefone", { length: 20 }),
    ativo: boolean("ativo").notNull().default(true),
    criadoEm: timestamp("criado_em", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("usuario_email_uq").on(t.email),
    index("usuario_empresa_idx").on(t.empresaId),
  ],
);

/**
 * Sessão de login.
 *
 * O que fica guardado aqui é o SHA-256 do token, nunca o token em si — se o
 * banco vazar, ninguém consegue montar um cookie válido a partir dele. É o
 * mesmo raciocínio de guardar senha com hash.
 *
 * Sessão em tabela, e não cookie assinado, porque assim dá para revogar: tirar
 * acesso de um funcionário desligado é um DELETE, e não esperar o token expirar.
 */
export const sessao = pgTable(
  "sessao",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    usuarioId: uuid("usuario_id")
      .notNull()
      .references(() => usuario.id, { onDelete: "cascade" }),
    expiraEm: timestamp("expira_em", { withTimezone: true }).notNull(),
    criadoEm: timestamp("criado_em", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("sessao_usuario_idx").on(t.usuarioId)],
);

export const cliente = pgTable(
  "cliente",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    empresaId: uuid("empresa_id")
      .notNull()
      .references(() => empresa.id, { onDelete: "cascade" }),
    tipo: tipoPessoa("tipo").notNull().default("pf"),
    nome: text("nome").notNull(),
    cpfCnpj: varchar("cpf_cnpj", { length: 14 }),
    email: text("email"),
    telefone: varchar("telefone", { length: 20 }),
    cep: varchar("cep", { length: 8 }),
    logradouro: text("logradouro"),
    numero: varchar("numero", { length: 20 }),
    complemento: text("complemento"),
    bairro: text("bairro"),
    cidade: text("cidade"),
    uf: varchar("uf", { length: 2 }),
    observacoes: text("observacoes"),
    criadoEm: timestamp("criado_em", { withTimezone: true }).notNull().defaultNow(),
    atualizadoEm: timestamp("atualizado_em", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("cliente_empresa_idx").on(t.empresaId),
    uniqueIndex("cliente_doc_uq").on(t.empresaId, t.cpfCnpj),
    index("cliente_nome_idx").on(t.empresaId, t.nome),
  ],
);

/**
 * Unidade consumidora: o número de instalação junto à concessionária.
 * É a chave que liga a usina à conta de luz — sem ela não existe cálculo de economia.
 */
export const unidadeConsumidora = pgTable(
  "unidade_consumidora",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    empresaId: uuid("empresa_id")
      .notNull()
      .references(() => empresa.id, { onDelete: "cascade" }),
    clienteId: uuid("cliente_id")
      .notNull()
      .references(() => cliente.id, { onDelete: "restrict" }),
    numeroInstalacao: varchar("numero_instalacao", { length: 30 }).notNull(),
    concessionaria: text("concessionaria").notNull(),
    titular: text("titular"),
    classe: text("classe"),
    criadoEm: timestamp("criado_em", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("uc_empresa_idx").on(t.empresaId),
    index("uc_cliente_idx").on(t.clienteId),
    uniqueIndex("uc_instalacao_uq").on(
      t.empresaId,
      t.concessionaria,
      t.numeroInstalacao,
    ),
  ],
);

export const usina = pgTable(
  "usina",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    empresaId: uuid("empresa_id")
      .notNull()
      .references(() => empresa.id, { onDelete: "cascade" }),
    clienteId: uuid("cliente_id")
      .notNull()
      .references(() => cliente.id, { onDelete: "restrict" }),
    unidadeConsumidoraId: uuid("unidade_consumidora_id").references(
      () => unidadeConsumidora.id,
      { onDelete: "set null" },
    ),
    nome: text("nome").notNull(),
    potenciaKwp: numeric("potencia_kwp", { precision: 10, scale: 3 }),
    dataInstalacao: timestamp("data_instalacao", { withTimezone: false }),
    status: statusUsina("status").notNull().default("em_implantacao"),
    cidade: text("cidade"),
    uf: varchar("uf", { length: 2 }),
    latitude: numeric("latitude", { precision: 10, scale: 7 }),
    longitude: numeric("longitude", { precision: 10, scale: 7 }),
    /**
     * Até que passo da ficha de cadastro esta usina chegou. 5 = completa.
     *
     * A ficha grava a cada passo em vez de só no fim: fechar o navegador no
     * passo 4 não pode custar o que já foi digitado. E quando vocês quiserem
     * preencher em dias diferentes — a vistoria hoje, o número de série quando
     * o inversor chegar — já funciona sem mudar nada.
     */
    cadastroPasso: integer("cadastro_passo").notNull().default(5),
    /** Pasta do cliente no Drive, que hoje é onde os documentos moram. */
    linkDrive: text("link_drive"),
    observacoesVistoria: text("observacoes_vistoria"),
    criadoEm: timestamp("criado_em", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("usina_empresa_idx").on(t.empresaId),
    index("usina_cliente_idx").on(t.clienteId),
    index("usina_status_idx").on(t.empresaId, t.status),
  ],
);

export const equipamento = pgTable(
  "equipamento",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    empresaId: uuid("empresa_id")
      .notNull()
      .references(() => empresa.id, { onDelete: "cascade" }),
    usinaId: uuid("usina_id")
      .notNull()
      .references(() => usina.id, { onDelete: "cascade" }),
    tipo: tipoEquipamento("tipo").notNull(),
    fabricante: text("fabricante"),
    modelo: text("modelo"),
    numeroSerie: varchar("numero_serie", { length: 60 }),
    quantidade: integer("quantidade").notNull().default(1),
    potenciaW: numeric("potencia_w", { precision: 12, scale: 2 }),
    criadoEm: timestamp("criado_em", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("equipamento_usina_idx").on(t.usinaId),
    uniqueIndex("equipamento_sn_uq").on(t.empresaId, t.numeroSerie),
  ],
);

/**
 * Uma credencial de portal de fabricante.
 *
 * `credenciaisCifradas` guarda um blob cifrado pela aplicação (chave em
 * APP_ENCRYPTION_KEY), nunca senha em texto puro. O banco não deve ser capaz
 * de entregar acesso aos portais de ninguém se vazar.
 */
export const contaPortal = pgTable(
  "conta_portal",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    empresaId: uuid("empresa_id")
      .notNull()
      .references(() => empresa.id, { onDelete: "cascade" }),
    fabricante: fabricantePortal("fabricante").notNull(),
    apelido: text("apelido").notNull(),
    credenciaisCifradas: text("credenciais_cifradas"),
    ativa: boolean("ativa").notNull().default(true),
    /**
     * Cada fabricante impõe um limite diferente, então não existe uma cadência
     * global: a FoxESS aceita 1.440 chamadas/dia por device, a Solis atualiza os
     * dados a cada 5 min, e a Huawei limita o dia inteiro a
     * ∑ arredondaPraCima(dispositivos de cada tipo / 10) + 24 chamadas.
     * O coletor lê a cadência daqui, por conta.
     */
    cadenciaMinutos: integer("cadencia_minutos").notNull().default(15),
    chamadasDiaMax: integer("chamadas_dia_max"),
    ultimaColetaEm: timestamp("ultima_coleta_em", { withTimezone: true }),
    ultimoErro: text("ultimo_erro"),
    criadoEm: timestamp("criado_em", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("conta_portal_empresa_idx").on(t.empresaId, t.fabricante)],
);

/**
 * Liga uma usina nossa ao id que ela tem lá no portal do fabricante.
 * É este elo que torna o sistema imune a marca: trocar de portal é trocar
 * o vínculo, não remodelar o cadastro.
 */
export const vinculoPortal = pgTable(
  "vinculo_portal",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    empresaId: uuid("empresa_id")
      .notNull()
      .references(() => empresa.id, { onDelete: "cascade" }),
    usinaId: uuid("usina_id")
      .notNull()
      .references(() => usina.id, { onDelete: "cascade" }),
    contaPortalId: uuid("conta_portal_id")
      .notNull()
      .references(() => contaPortal.id, { onDelete: "cascade" }),
    idExterno: varchar("id_externo", { length: 60 }).notNull(),
    nomeExterno: text("nome_externo"),
    criadoEm: timestamp("criado_em", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("vinculo_portal_uq").on(t.contaPortalId, t.idExterno),
    index("vinculo_portal_usina_idx").on(t.usinaId),
  ],
);
