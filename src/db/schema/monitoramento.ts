import { sql } from "drizzle-orm";
import {
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

import { empresa, equipamento, usina, usuario } from "./cadastro";
import { ordemServico } from "./operacao";
import {
  granularidadeLeitura,
  severidadeAlerta,
  statusAlerta,
  tipoAlerta,
} from "./enums";

/**
 * Leitura de um equipamento num instante.
 *
 * Sem particionamento de propósito: 144 usinas a cada 15 min dá ~14 mil linhas
 * por dia, ~5 milhões por ano. Postgres come isso sem suar por vários anos.
 * Particionar por mês só quando o EXPLAIN pedir — antes disso é enfeite.
 *
 * A unique em (equipamento, medido_em) é o que torna o coletor idempotente:
 * ele refaz janelas sobrepostas e grava com ON CONFLICT DO NOTHING, então
 * rodar duas vezes nunca duplica dado.
 */
export const leitura = pgTable(
  "leitura",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    empresaId: uuid("empresa_id")
      .notNull()
      .references(() => empresa.id, { onDelete: "cascade" }),
    usinaId: uuid("usina_id")
      .notNull()
      .references(() => usina.id, { onDelete: "cascade" }),
    equipamentoId: uuid("equipamento_id").references(() => equipamento.id, {
      onDelete: "cascade",
    }),
    medidoEm: timestamp("medido_em", { withTimezone: true }).notNull(),
    /** O que `medido_em` representa: aquele dia, aquele mês ou aquele ano. */
    granularidade: granularidadeLeitura("granularidade").notNull().default("dia"),
    potenciaW: numeric("potencia_w", { precision: 12, scale: 2 }),
    /** Energia gerada no período que a granularidade define, não sempre um dia. */
    energiaKwh: numeric("energia_kwh", { precision: 12, scale: 3 }),
    energiaTotalKwh: numeric("energia_total_kwh", { precision: 14, scale: 3 }),
    /** Status como o portal reporta, antes de normalizar. */
    statusBruto: varchar("status_bruto", { length: 40 }),
    coletadoEm: timestamp("coletado_em", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("leitura_equipamento_instante_uq").on(
      t.equipamentoId,
      t.medidoEm,
      t.granularidade,
    ),
    /**
     * Leitura no nível da usina — o que o relatório mensal do OSS entrega —
     * não tem equipamento. E no Postgres dois nulos não colidem, então o índice
     * acima não a protege: reimportar o mesmo arquivo duplicaria tudo. Daí este
     * índice parcial, que cuida exatamente desse caso.
     *
     * A granularidade entra na chave porque o total de agosto e a leitura do
     * dia 1º de agosto compartilham o mesmo instante e são coisas diferentes.
     */
    uniqueIndex("leitura_usina_instante_uq")
      .on(t.usinaId, t.medidoEm, t.granularidade)
      .where(sql`${t.equipamentoId} is null`),
    index("leitura_usina_tempo_idx").on(t.usinaId, t.granularidade, t.medidoEm),
  ],
);

/**
 * Payload cru da última resposta de cada portal, por usina.
 *
 * Guardar isso parece desperdício até a Growatt mudar um campo sem avisar.
 * Aí é a diferença entre reprocessar o histórico e perdê-lo.
 */
export const leituraBruta = pgTable(
  "leitura_bruta",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    empresaId: uuid("empresa_id")
      .notNull()
      .references(() => empresa.id, { onDelete: "cascade" }),
    usinaId: uuid("usina_id")
      .notNull()
      .references(() => usina.id, { onDelete: "cascade" }),
    payload: text("payload").notNull(),
    coletadoEm: timestamp("coletado_em", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("leitura_bruta_usina_idx").on(t.usinaId, t.coletadoEm)],
);

/**
 * Alerta aberto por regra sobre as leituras. Um alerta pode virar OS
 * automaticamente — é o elo entre "a usina caiu" e "alguém foi lá".
 */
export const alerta = pgTable(
  "alerta",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    empresaId: uuid("empresa_id")
      .notNull()
      .references(() => empresa.id, { onDelete: "cascade" }),
    usinaId: uuid("usina_id")
      .notNull()
      .references(() => usina.id, { onDelete: "cascade" }),
    tipo: tipoAlerta("tipo").notNull(),
    severidade: severidadeAlerta("severidade").notNull().default("atencao"),
    status: statusAlerta("status").notNull().default("aberto"),
    mensagem: text("mensagem").notNull(),
    /** Código do inversor, quando o portal informa. */
    codigoFabricante: varchar("codigo_fabricante", { length: 40 }),
    ordemServicoId: uuid("ordem_servico_id").references(() => ordemServico.id, {
      onDelete: "set null",
    }),
    reconhecidoPorId: uuid("reconhecido_por_id").references(() => usuario.id, {
      onDelete: "set null",
    }),
    abertoEm: timestamp("aberto_em", { withTimezone: true }).notNull().defaultNow(),
    resolvidoEm: timestamp("resolvido_em", { withTimezone: true }),
    /** Evita reabrir o mesmo alerta a cada ciclo de coleta. */
    notificadoEm: timestamp("notificado_em", { withTimezone: true }),
  },
  (t) => [
    index("alerta_empresa_status_idx").on(t.empresaId, t.status),
    index("alerta_usina_idx").on(t.usinaId, t.tipo, t.status),
    /**
     * O Fault Log do OSS é reexportado com períodos que se sobrepõem, então a
     * mesma falha chega várias vezes. Código do fabricante mais instante é o que
     * identifica o evento de forma única. Só vale para alerta vindo de portal —
     * alerta gerado por regra nossa não tem código e fica de fora do índice.
     */
    uniqueIndex("alerta_evento_uq")
      .on(t.usinaId, t.tipo, t.codigoFabricante, t.abertoEm)
      .where(sql`${t.codigoFabricante} is not null`),
    /**
     * Alerta que nasce de regra nossa sobre a série não tem código de
     * fabricante, e nulos não colidem no Postgres — então precisa do seu
     * próprio índice. Rodar o detector duas vezes no mesmo período não pode
     * gerar alerta repetido.
     */
    uniqueIndex("alerta_regra_uq")
      .on(t.usinaId, t.tipo, t.abertoEm)
      .where(sql`${t.codigoFabricante} is null`),
  ],
);

/**
 * Tarifa por concessionária, com vigência. Sem isto não existe relatório de
 * economia — e é exatamente o que nunca foi configurado nos portais.
 */
export const tarifa = pgTable(
  "tarifa",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    empresaId: uuid("empresa_id")
      .notNull()
      .references(() => empresa.id, { onDelete: "cascade" }),
    concessionaria: text("concessionaria").notNull(),
    uf: varchar("uf", { length: 2 }),
    valorKwh: numeric("valor_kwh", { precision: 10, scale: 6 }).notNull(),
    vigenciaInicio: timestamp("vigencia_inicio", { withTimezone: false }).notNull(),
    vigenciaFim: timestamp("vigencia_fim", { withTimezone: false }),
    criadoEm: timestamp("criado_em", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("tarifa_lookup_idx").on(t.empresaId, t.concessionaria, t.vigenciaInicio),
  ],
);

/**
 * Fila de notificação. O WhatsApp é o canal, mas o disparo nasce aqui —
 * assim dá pra reenviar, auditar e não depender do WhatsApp estar de pé.
 */
export const notificacao = pgTable(
  "notificacao",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    empresaId: uuid("empresa_id")
      .notNull()
      .references(() => empresa.id, { onDelete: "cascade" }),
    destinatarioId: uuid("destinatario_id").references(() => usuario.id, {
      onDelete: "cascade",
    }),
    telefone: varchar("telefone", { length: 20 }),
    /** Nome do template aprovado na Meta. */
    template: text("template").notNull(),
    parametros: text("parametros"),
    /** pendente | enviada | falhou */
    status: varchar("status", { length: 20 }).notNull().default("pendente"),
    tentativas: integer("tentativas").notNull().default(0),
    erro: text("erro"),
    enviadaEm: timestamp("enviada_em", { withTimezone: true }),
    criadoEm: timestamp("criado_em", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("notificacao_pendente_idx").on(t.status, t.criadoEm)],
);
