import { pgEnum } from "drizzle-orm/pg-core";

/** Os cinco atores que a BB Soluções nomeou na reunião. */
export const papelUsuario = pgEnum("papel_usuario", [
  "adm",
  "vendedor",
  "engenheiro",
  "tecnico",
  "estoque",
]);

export const tipoPessoa = pgEnum("tipo_pessoa", ["pf", "pj"]);

/** Plataformas de monitoramento em uso hoje. `outro` cobre usina sem portal. */
export const fabricantePortal = pgEnum("fabricante_portal", [
  "growatt",
  "hoymiles",
  "solis",
  "foxess",
  "huawei",
  "solarportal_plus",
  "nep",
  "outro",
]);

export const tipoEquipamento = pgEnum("tipo_equipamento", [
  "inversor",
  "microinversor",
  "modulo",
  "datalogger",
  "bateria",
  "medidor",
]);

export const statusUsina = pgEnum("status_usina", [
  "em_implantacao",
  "gerando",
  "inativa",
]);

/** Situação do projeto na esteira, independente de em qual etapa ele está. */
export const situacaoProjeto = pgEnum("situacao_projeto", [
  "em_andamento",
  "concluido",
  "cancelado",
  "pausado",
]);

/**
 * A esteira NÃO é um enum de propósito — virou a tabela `etapa`.
 *
 * O fluxo ainda está sendo levantado com o cliente e há etapas em aberto (a
 * instalação, por exemplo, não apareceu na lista que eles escreveram à mão).
 * Além disso, cada integradora tem o seu fluxo, e o sistema é multi-tenant.
 * Como tabela, mudar a esteira é INSERT e UPDATE; como enum, seria migration
 * a cada conversa.
 */

export const tipoOs = pgEnum("tipo_os", [
  "instalacao",
  "preventiva",
  "corretiva",
  "limpeza",
  "garantia",
  "vistoria",
]);

export const statusOs = pgEnum("status_os", [
  "aberta",
  "agendada",
  "em_andamento",
  "aguardando_peca",
  "concluida",
  "cancelada",
]);

export const prioridadeOs = pgEnum("prioridade_os", [
  "baixa",
  "normal",
  "alta",
  "urgente",
]);

export const origemOs = pgEnum("origem_os", ["manual", "alerta", "cliente"]);

/**
 * Granularidade de uma leitura.
 *
 * O OSS exporta o mesmo indicador em três agregações — o relatório diário traz
 * colunas "2026-08-24" e o mensal traz "2026-08". Sem marcar qual é qual, um
 * total de mês entra no banco parecendo um dia e qualquer soma vira ficção.
 */
export const granularidadeLeitura = pgEnum("granularidade_leitura", [
  "dia",
  "mes",
  "ano",
]);

export const tipoAlerta = pgEnum("tipo_alerta", [
  "offline",
  "sem_comunicacao",
  "geracao_baixa",
  "alarme_inversor",
]);

export const severidadeAlerta = pgEnum("severidade_alerta", [
  "info",
  "atencao",
  "critico",
]);

export const statusAlerta = pgEnum("status_alerta", [
  "aberto",
  "reconhecido",
  "resolvido",
]);

/** Entidades que aceitam comentário. Discussão presa ao objeto, não a um grupo. */
export const entidadeComentario = pgEnum("entidade_comentario", [
  "projeto",
  "ordem_servico",
  "cliente",
  "usina",
]);
