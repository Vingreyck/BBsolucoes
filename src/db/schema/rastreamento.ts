import {
  bigserial,
  index,
  integer,
  numeric,
  pgTable,
  real,
  smallint,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import { empresa, usuario } from "./cadastro";
import { ordemServico } from "./operacao";

/**
 * O rastreamento do técnico em campo (migração 0013). O celular manda posição
 * só entre o "Estou a caminho" e o fim do atendimento.
 */

/** A última posição de cada técnico — uma linha por pessoa. */
export const posicaoAtual = pgTable(
  "posicao_atual",
  {
    usuarioId: uuid("usuario_id")
      .primaryKey()
      .references(() => usuario.id, { onDelete: "cascade" }),
    empresaId: uuid("empresa_id")
      .notNull()
      .references(() => empresa.id, { onDelete: "cascade" }),
    ordemServicoId: uuid("ordem_servico_id").references(() => ordemServico.id, { onDelete: "set null" }),
    latitude: numeric("latitude", { precision: 10, scale: 7 }).notNull(),
    longitude: numeric("longitude", { precision: 10, scale: 7 }).notNull(),
    precisaoM: integer("precisao_m"),
    velocidadeMs: real("velocidade_ms"),
    bateria: smallint("bateria"),
    /** `deslocamento` ou `eco`. */
    modo: varchar("modo", { length: 15 }).notNull().default("deslocamento"),
    capturadoEm: timestamp("capturado_em", { withTimezone: true }).notNull(),
    recebidoEm: timestamp("recebido_em", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("posicao_atual_empresa_idx").on(t.empresaId)],
);

/** O caminho percorrido, filtrado na gravação — ver `src/rastreamento/trilha.ts`. */
export const posicaoTrilha = pgTable(
  "posicao_trilha",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    empresaId: uuid("empresa_id")
      .notNull()
      .references(() => empresa.id, { onDelete: "cascade" }),
    usuarioId: uuid("usuario_id")
      .notNull()
      .references(() => usuario.id, { onDelete: "cascade" }),
    ordemServicoId: uuid("ordem_servico_id").references(() => ordemServico.id, { onDelete: "cascade" }),
    latitude: numeric("latitude", { precision: 10, scale: 7 }).notNull(),
    longitude: numeric("longitude", { precision: 10, scale: 7 }).notNull(),
    precisaoM: integer("precisao_m"),
    velocidadeMs: real("velocidade_ms"),
    capturadoEm: timestamp("capturado_em", { withTimezone: true }).notNull(),
    recebidoEm: timestamp("recebido_em", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("posicao_trilha_os_idx").on(t.ordemServicoId, t.capturadoEm),
    index("posicao_trilha_usuario_idx").on(t.usuarioId, t.capturadoEm),
    index("posicao_trilha_capturado_idx").on(t.capturadoEm),
  ],
);
