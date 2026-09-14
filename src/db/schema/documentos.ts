import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import { cliente, empresa, usuario } from "./cadastro";
import { acaoDocumento, statusDocumento, tipoDocumento } from "./enums";
import { etapa, projeto } from "./operacao";

/**
 * Um documento do dossiê.
 *
 * Mora em arquivo próprio porque aponta para os dois lados: `cliente` vem de
 * `cadastro`, `projeto` e `etapa` vêm de `operacao`, e `operacao` já importa
 * `cadastro` — deixar isto lá dentro fecharia um ciclo de import.
 *
 * O sistema **não guarda o arquivo** enquanto o Drive for o depósito: guarda o
 * que ele é, de quem é, de qual venda é e onde está. Quando o upload passar a
 * acontecer aqui dentro, `linkDrive` vira o caminho do arquivo próprio e o
 * resto da tabela continua igual.
 */
export const documento = pgTable(
  "documento",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    empresaId: uuid("empresa_id")
      .notNull()
      .references(() => empresa.id, { onDelete: "cascade" }),
    /**
     * De quem é o papel. Continua obrigatório mesmo com o dossiê existindo:
     * CNH, RG e CPF são da **pessoa**, valem para qualquer venda dela e não
     * deveriam ser pedidos de novo no segundo projeto.
     */
    clienteId: uuid("cliente_id")
      .notNull()
      .references(() => cliente.id, { onDelete: "cascade" }),
    /**
     * De qual venda é o papel. Nulo de propósito: documento pessoal não
     * pertence a uma venda, e o que veio do Drive antes de existir dossiê
     * também não tinha como saber.
     *
     * É esta coluna que resolve o aumento de sistema — no Drive há pastas
     * `PE Aumento GD`, que é venda nova no mesmo cliente. Sem ela, os dois
     * projetos dividem uma pilha só de documento e ninguém sabe qual ART é de
     * qual.
     */
    projetoId: uuid("projeto_id").references(() => projeto.id, {
      onDelete: "set null",
    }),
    tipo: tipoDocumento("tipo").notNull(),
    /**
     * Assinado, esperando assinatura, arquivo de trabalho ou não se sabe.
     *
     * Antes disto a informação vivia no nome do arquivo, e o checklist dava
     * por cumprido o cliente cujo único memorial era a planilha `.xlsm` do
     * engenheiro — eram 9 clientes assim.
     */
    status: statusDocumento("status").notNull().default("indefinido"),
    /** "V2", "ATUALIZADA", "02" no nome viram número. A maior vale. */
    versao: integer("versao").notNull().default(1),
    /** Nome do arquivo como está no Drive — é ele que classifica o tipo. */
    nomeArquivo: text("nome_arquivo").notNull(),
    /**
     * Onde o arquivo estava dentro da pasta do cliente. Vazio = solto na raiz;
     * preenchido = dentro de um pacote, como `PE Solar … / Documentos
     * Assinados`. As pastas não seguem padrão, e é isso que permite responder
     * se a ART está solta ou dentro do projeto elétrico.
     */
    caminho: text("caminho").notNull().default(""),
    linkDrive: text("link_drive"),
    /** Pasta do cliente no Drive. Igual para todos os documentos dele. */
    pastaExterna: varchar("pasta_externa", { length: 80 }),
    /** "CLIENTES 2026", "CLIENTES 2025" — o ano em que o negócio aconteceu. */
    origem: varchar("origem", { length: 40 }),
    tamanhoBytes: integer("tamanho_bytes"),
    modificadoEm: timestamp("modificado_em", { withTimezone: false }),
    /**
     * Quem subiu. Nulo para os 2.788 que vieram do Drive — ninguém subiu, eles
     * já estavam lá. Daqui para a frente é preenchido, e é metade da exigência
     * de rastreabilidade da LGPD: há CNH, RG e conta de luz de 169 pessoas
     * nesta tabela.
     */
    criadoPor: uuid("criado_por").references(() => usuario.id, {
      onDelete: "set null",
    }),
    criadoEm: timestamp("criado_em", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("documento_cliente_idx").on(t.clienteId, t.tipo),
    index("documento_projeto_idx").on(t.projetoId, t.tipo),
    /**
     * Reimportar a mesma listagem não pode duplicar, e o caminho faz parte da
     * identidade: com a varredura recursiva, o mesmo nome de arquivo aparece
     * solto na raiz e dentro de `Documentos Assinados`, e são dois documentos
     * diferentes.
     */
    uniqueIndex("documento_arquivo_uq").on(t.clienteId, t.caminho, t.nomeArquivo),
  ],
);

/**
 * Quem olhou o quê, e quando.
 *
 * A outra metade da rastreabilidade. Esta tabela guarda CNH, RG, CPF e conta de
 * luz de 169 pessoas; a LGPD espera registro das operações de tratamento, e
 * "quem baixou o documento de quem" é exatamente isso. Também é o que permite
 * responder, no dia em que um cliente perguntar, quem na empresa acessou os
 * papéis dele.
 *
 * Fica em tabela separada porque cresce muito mais rápido que `documento`: é
 * uma linha por visualização, não por arquivo.
 */
export const documentoAcesso = pgTable(
  "documento_acesso",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    empresaId: uuid("empresa_id")
      .notNull()
      .references(() => empresa.id, { onDelete: "cascade" }),
    /**
     * `set null` e não `cascade`: apagar o documento não pode apagar o registro
     * de quem o acessou enquanto ele existia. Auditoria que some quando o
     * objeto some não é auditoria.
     */
    documentoId: uuid("documento_id").references(() => documento.id, {
      onDelete: "set null",
    }),
    /** Guardado em texto para o registro sobreviver ao documento apagado. */
    descricao: text("descricao").notNull(),
    usuarioId: uuid("usuario_id").references(() => usuario.id, {
      onDelete: "set null",
    }),
    acao: acaoDocumento("acao").notNull(),
    ocorridoEm: timestamp("ocorrido_em", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("documento_acesso_doc_idx").on(t.documentoId, t.ocorridoEm),
    index("documento_acesso_usuario_idx").on(t.usuarioId, t.ocorridoEm),
  ],
);

/**
 * A partir de qual etapa cada documento passa a ser exigido.
 *
 * Tabela e não código, pelo mesmo motivo de `etapa`: o fluxo é da empresa, cada
 * integradora tem o seu, e mudar a regra precisa ser conversa virando dado.
 *
 * É isto que impede a tela de gritar à toa. Sem a regra, quem fechou contrato
 * semana passada aparecia em vermelho por não ter ART — sendo que o engenheiro
 * nem começou o projeto. Com ela, o documento só é cobrado a partir do momento
 * em que **deveria** existir.
 */
export const exigenciaDocumento = pgTable(
  "exigencia_documento",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    empresaId: uuid("empresa_id")
      .notNull()
      .references(() => empresa.id, { onDelete: "cascade" }),
    tipo: tipoDocumento("tipo").notNull(),
    /** A partir desta etapa (pela `ordem` dela) o documento é cobrado. */
    etapaId: uuid("etapa_id")
      .notNull()
      .references(() => etapa.id, { onDelete: "restrict" }),
    /**
     * Condicional não conta como falta. Procuração só existe quando não é o
     * titular que assina; UC beneficiária e compensativo, só em sistema de
     * compensação com mais de uma unidade.
     */
    obrigatorio: boolean("obrigatorio").notNull().default(true),
    /**
     * Documento que só vale assinado. Ter o memorial sem assinatura não é ter
     * o memorial — a concessionária devolve.
     */
    exigeAssinatura: boolean("exige_assinatura").notNull().default(false),
    /** Por que este documento existe. Aparece na tela como ajuda. */
    observacao: text("observacao"),
  },
  (t) => [uniqueIndex("exigencia_documento_uq").on(t.empresaId, t.tipo)],
);
