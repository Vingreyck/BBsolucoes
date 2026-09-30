import { sql } from "drizzle-orm";
import {
  boolean,
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
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

import { cliente, empresa, usina, usuario } from "./cadastro";
import {
  entidadeComentario,
  origemOs,
  papelUsuario,
  prioridadeOs,
  situacaoProjeto,
  statusOs,
  tipoDocumento,
  tipoOs,
} from "./enums";

/**
 * A resposta de um item do checklist, conforme o tipo dele: marcado (check,
 * sim/não), número, texto, uma opção, várias opções, ou a lista de seriais.
 * Foto não tem valor — é anexo, contado em `os_anexo`.
 */
export type ValorResposta = boolean | number | string | string[] | null;

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

/**
 * O número de série que o técnico anotou no dia da instalação.
 *
 * Inverte a ordem em que cliente e usina se conhecem, e é isso que cura o
 * cadastro duplicado. Hoje o sistema só descobre uma usina quando ela aparece
 * no portal do fabricante, com o nome que o técnico digitou lá — "José
 * Fernando7", "micaely 03" — e sem nada que a ligue ao cliente, que já existe
 * no Selebi desde que a venda foi fechada.
 *
 * O serial do inversor é a única coisa que os dois lados têm em comum: está na
 * etiqueta do aparelho, é único e não muda. Anotado aqui, o coletor reconhece
 * a usina quando ela aparecer no portal e liga sozinho ao cliente certo.
 *
 * `usinaId` nulo é a espera. É a diferença entre "o técnico disse que
 * instalou" e "o portal confirmou que existe", e a diferença entre as duas é
 * informação útil: serial anotado há uma semana e ainda sem confirmação
 * costuma ser datalogger que não conectou.
 */
export const serialInstalado = pgTable(
  "serial_instalado",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    empresaId: uuid("empresa_id")
      .notNull()
      .references(() => empresa.id, { onDelete: "cascade" }),
    projetoId: uuid("projeto_id")
      .notNull()
      .references(() => projeto.id, { onDelete: "cascade" }),
    numeroSerie: varchar("numero_serie", { length: 60 }).notNull(),
    /** "inversor 2", "o do fundo" — o que o técnico precisar lembrar. */
    observacao: text("observacao"),
    /** Preenchido quando o portal confirma que a usina existe. */
    usinaId: uuid("usina_id").references(() => usina.id, { onDelete: "set null" }),
    confirmadoEm: timestamp("confirmado_em", { withTimezone: true }),
    registradoPor: uuid("registrado_por").references(() => usuario.id, {
      onDelete: "set null",
    }),
    registradoEm: timestamp("registrado_em", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    /**
     * Um serial existe uma vez só na empresa.
     *
     * Dois projetos reivindicando o mesmo aparelho é erro de digitação ou
     * inversor remanejado de um cliente para outro. Nos dois casos é para
     * alguém olhar, não para o sistema escolher um dos dois em silêncio.
     */
    uniqueIndex("serial_instalado_uq").on(t.empresaId, t.numeroSerie),
    index("serial_instalado_projeto_idx").on(t.projetoId),
  ],
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

    /**
     * A venda a que a OS serve. É esta coluna que liga a OS à esteira: a
     * vistoria e a instalação são etapas de um projeto, e concluir a OS pode
     * andar o projeto sozinho (ver `modelo_os.etapa_slug`). Nula na corretiva
     * de usina antiga, que não pertence a venda nenhuma.
     */
    projetoId: uuid("projeto_id").references(() => projeto.id, { onDelete: "set null" }),
    /** A OS de onde esta nasceu — o retorno de um atendimento não resolvido. */
    osOrigemId: uuid("os_origem_id").references((): AnyPgColumn => ordemServico.id, {
      onDelete: "set null",
    }),
    /** Como terminou: `resolvido` ou `nao_resolvido` (pede retorno). */
    resultado: varchar("resultado", { length: 20 }),
    /** Quem assinou pelo cliente — nem sempre é o titular. A imagem é anexo. */
    assinaturaNome: text("assinatura_nome"),
    /**
     * Chave do link público do relatório, que vai para o cliente pelo
     * WhatsApp. Aleatória e longa: quem tem o link vê o relatório, quem não tem
     * não adivinha. Gerar outra invalida a anterior.
     */
    relatorioToken: varchar("relatorio_token", { length: 64 }),
    canceladaEm: timestamp("cancelada_em", { withTimezone: true }),
    atualizadoEm: timestamp("atualizado_em", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("os_empresa_status_idx").on(t.empresaId, t.status),
    index("os_responsavel_idx").on(t.responsavelId, t.status),
    index("os_usina_idx").on(t.usinaId),
    index("os_projeto_idx").on(t.projetoId),
    index("os_agenda_idx").on(t.empresaId, t.agendadaPara),
    uniqueIndex("os_relatorio_token_uq")
      .on(t.relatorioToken)
      .where(sql`${t.relatorioToken} IS NOT NULL`),
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
    /**
     * O item está cumprido: resposta dada e fotos mínimas enviadas. É o que o
     * botão de concluir confere — calculado no servidor, nunca aceito pronto.
     */
    concluido: boolean("concluido").notNull().default(false),
    observacao: text("observacao"),
    concluidoEm: timestamp("concluido_em", { withTimezone: true }),

    // Copiados do modelo quando a OS nasce: mudar o modelo depois não mexe no
    // que já foi pedido ao técnico, e o relatório continua batendo.
    secao: text("secao"),
    ajuda: text("ajuda"),
    tipoResposta: varchar("tipo_resposta", { length: 20 }).notNull().default("check"),
    opcoes: jsonb("opcoes").$type<string[]>(),
    unidade: varchar("unidade", { length: 20 }),
    fotosMinimas: integer("fotos_minimas").notNull().default(0),
    /** Só vale foto tirada na hora — três vistorias usaram print do Street View. */
    apenasCamera: boolean("apenas_camera").notNull().default(false),
    /** A foto deste item vira este documento no dossiê da venda. */
    tipoDocumento: tipoDocumento("tipo_documento"),
    /** Nome estável do item ("disjuntor_amperagem"), para cruzar com o projeto. */
    chave: varchar("chave", { length: 60 }),

    valor: jsonb("valor").$type<ValorResposta>(),
    respondidoPorId: uuid("respondido_por_id").references(() => usuario.id, {
      onDelete: "set null",
    }),
    respondidoEm: timestamp("respondido_em", { withTimezone: true }),
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

    /** Nulo para anexo geral da OS (assinatura, foto avulsa). */
    checklistItemId: uuid("checklist_item_id").references(() => osChecklistItem.id, {
      onDelete: "set null",
    }),
    /**
     * Id que o celular dá ao anexo antes de ter sinal. Reenviar depois de uma
     * queda de conexão não duplica a foto: o índice único barra a segunda.
     */
    idCliente: uuid("id_cliente"),
    mime: varchar("mime", { length: 100 }),
    driveId: varchar("drive_id", { length: 100 }),
    latitude: numeric("latitude", { precision: 10, scale: 7 }),
    longitude: numeric("longitude", { precision: 10, scale: 7 }),
    /**
     * O documento que esta foto virou no dossiê da venda. Sem `references`
     * aqui: `documentos.ts` importa este arquivo, e o contrário fecharia um
     * ciclo. A chave estrangeira existe no banco (migração 0012) e a relação,
     * em `relations.ts`.
     */
    documentoId: uuid("documento_id"),
  },
  (t) => [
    index("os_anexo_os_idx").on(t.ordemServicoId),
    index("os_anexo_item_idx").on(t.checklistItemId),
    uniqueIndex("os_anexo_id_cliente_uq")
      .on(t.empresaId, t.idCliente)
      .where(sql`${t.idCliente} IS NOT NULL`),
  ],
);

/**
 * O histórico da OS: quem fez o quê, quando, de onde e por quê.
 *
 * É a "mensagem" do IXC e o que responde, meses depois, "quem esteve lá e
 * quanto tempo ficou". Cada ação vira uma linha — nada se reescreve —, e é
 * daqui que o relatório tira chegada, saída e tempo em campo.
 *
 * `ocorridoEm` é a hora do celular: o técnico sem sinal chega às 9h, e o
 * evento só sobe às 11h. `registradoEm` é quando o servidor soube.
 */
export const osEvento = pgTable(
  "os_evento",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    empresaId: uuid("empresa_id")
      .notNull()
      .references(() => empresa.id, { onDelete: "cascade" }),
    ordemServicoId: uuid("ordem_servico_id")
      .notNull()
      .references(() => ordemServico.id, { onDelete: "cascade" }),
    tipo: varchar("tipo", { length: 30 }).notNull(),
    usuarioId: uuid("usuario_id").references(() => usuario.id, { onDelete: "set null" }),
    /** `web`, `app` ou `sistema`. */
    origem: varchar("origem", { length: 10 }).notNull().default("web"),
    ocorridoEm: timestamp("ocorrido_em", { withTimezone: true }).notNull().defaultNow(),
    registradoEm: timestamp("registrado_em", { withTimezone: true }).notNull().defaultNow(),
    latitude: numeric("latitude", { precision: 10, scale: 7 }),
    longitude: numeric("longitude", { precision: 10, scale: 7 }),
    precisaoM: integer("precisao_m"),
    /** O que muda de ação para ação: motivo, de/para, resultado. */
    dados: jsonb("dados").$type<Record<string, unknown>>(),
    idCliente: uuid("id_cliente"),
  },
  (t) => [
    index("os_evento_os_idx").on(t.ordemServicoId, t.ocorridoEm),
    uniqueIndex("os_evento_id_cliente_uq")
      .on(t.empresaId, t.idCliente)
      .where(sql`${t.idCliente} IS NOT NULL`),
  ],
);

/**
 * O modelo de cada tipo de OS — o "assunto" do IXC.
 *
 * Dado, não código: a lista do que o técnico precisa trazer do campo muda
 * conforme a empresa aprende, e mudar precisa ser um formulário no site, não
 * uma versão nova do app instalada em doze celulares.
 */
export const modeloOs = pgTable(
  "modelo_os",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    empresaId: uuid("empresa_id")
      .notNull()
      .references(() => empresa.id, { onDelete: "cascade" }),
    tipo: tipoOs("tipo").notNull(),
    nome: text("nome").notNull(),
    /** Mostrado ao técnico ao abrir a OS. */
    instrucoes: text("instrucoes"),
    /** Prazo a partir da abertura. Nulo = sem prazo. */
    prazoHoras: integer("prazo_horas"),
    exigeAssinatura: boolean("exige_assinatura").notNull().default(false),
    /**
     * A etapa da esteira que esta OS cumpre. Concluída com o problema resolvido
     * e com o projeto parado nessa etapa, o projeto anda para a próxima.
     */
    etapaSlug: varchar("etapa_slug", { length: 40 }),
    atualizadoEm: timestamp("atualizado_em", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("modelo_os_tipo_uq").on(t.empresaId, t.tipo)],
);

export const modeloOsItem = pgTable(
  "modelo_os_item",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    empresaId: uuid("empresa_id")
      .notNull()
      .references(() => empresa.id, { onDelete: "cascade" }),
    modeloId: uuid("modelo_id")
      .notNull()
      .references(() => modeloOs.id, { onDelete: "cascade" }),
    ordem: integer("ordem").notNull().default(0),
    secao: text("secao"),
    descricao: text("descricao").notNull(),
    ajuda: text("ajuda"),
    tipoResposta: varchar("tipo_resposta", { length: 20 }).notNull().default("check"),
    opcoes: jsonb("opcoes").$type<string[]>(),
    unidade: varchar("unidade", { length: 20 }),
    obrigatorio: boolean("obrigatorio").notNull().default(false),
    fotosMinimas: integer("fotos_minimas").notNull().default(0),
    apenasCamera: boolean("apenas_camera").notNull().default(false),
    tipoDocumento: tipoDocumento("tipo_documento"),
    chave: varchar("chave", { length: 60 }),
  },
  (t) => [index("modelo_os_item_modelo_idx").on(t.modeloId, t.ordem)],
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
    /** Id dado pelo celular: a nota escrita sem sinal e reenviada não duplica. */
    idCliente: uuid("id_cliente"),
  },
  (t) => [
    index("comentario_entidade_idx").on(t.empresaId, t.entidade, t.entidadeId),
    uniqueIndex("comentario_id_cliente_uq")
      .on(t.empresaId, t.idCliente)
      .where(sql`${t.idCliente} IS NOT NULL`),
  ],
);
