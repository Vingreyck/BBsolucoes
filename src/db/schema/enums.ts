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

/**
 * Tipos de documento de cliente, tirados das pastas reais do Drive.
 *
 * A BB guarda um PDF por assunto, com o nome no padrão `TIPO - CLIENTE.pdf`.
 * Estes valores saíram de olhar as pastas, não de imaginar o que deveria
 * existir — e foi olhando que apareceu o problema: a pasta do YURI tem os oito
 * documentos, a da Marina tem quatro (com um .zip e uma foto de telhado no
 * meio) e a da Ana Paula tem **um**. Ninguém sabia disso porque não havia como
 * olhar 300 pastas de uma vez.
 *
 * `outro` existe para não perder arquivo que foge do padrão: some do checklist,
 * mas continua contando como documento da pasta.
 */
export const tipoDocumento = pgEnum("tipo_documento", [
  "art",
  "boleto_art",
  "contrato",
  "memorial",
  "procuracao",
  "recibo",
  "documento_pessoal",
  "uc_geradora",
  "projeto_eletrico",
  "simulacao",
  // A segunda leva saiu da listagem completa do Drive: 1.162 arquivos em 178
  // pastas. Sem estes, um terço de tudo caía em `outro` — e "UCS" sozinho são
  // 45 arquivos, que são as unidades beneficiárias do sistema de compensação,
  // coisa diferente da UC geradora.
  "uc_beneficiaria",
  "compensativo",
  "nota_fiscal",
  "ficha_cadastral",
  "datasheet",
  "comprovante",
  "declaracao",
  "orcamento",
  // Fotos do padrão de entrada, tampa aberta e fechada — exigência da NDU 013.
  // No Drive vêm como MEDIDOR, QUADRO, PADRAO, DISJUNTOR e QD.
  "foto_padrao",
  /**
   * Papel que vai para a Energisa ou vem dela.
   *
   * Apareceu quando a listagem passou a descer nas subpastas: dezenas de
   * arquivos `SE20260498249.3d6Wc.pdf`, que é o número de protocolo da
   * Energisa Sergipe, mais `energisa_2via...` e os formulários de adesão à
   * compensação. É o rastro da homologação — sem ele não dá para saber se o
   * pedido de acesso chegou a ser aberto.
   */
  "protocolo",
  "outro",
]);

/**
 * Em que pé está o documento.
 *
 * Isto vivia no nome do arquivo — "Memorial Descritivo Assinado V2.pdf", "sem
 * assinar", "Coletar assinatura" — e por isso o checklist não sabia dizer se o
 * papel que existe é o que vale. São 232 arquivos que dizem alguma coisa sobre
 * assinatura e 2.500 que não dizem nada.
 *
 * `trabalho` é o arquivo do meio do caminho: o `.dwg` que só abre no AutoCAD, a
 * planilha `.xlsm` do memorial. São 98 dos 416 "projetos elétricos" e 29 dos
 * 238 "memoriais" — e 9 clientes cujo único memorial é a planilha. Não é
 * entregável, e contar como se fosse é dar por cumprido quem não cumpriu.
 *
 * `indefinido` é resposta honesta, não buraco: para a maior parte do que veio
 * do Drive não dá para saber, e fingir que sim seria pior do que admitir.
 */
export const statusDocumento = pgEnum("status_documento", [
  "indefinido",
  "trabalho",
  "aguardando_assinatura",
  "assinado",
]);

/** O que se pode fazer com um documento — o vocabulário da trilha de auditoria. */
export const acaoDocumento = pgEnum("acao_documento", [
  "visualizou",
  "baixou",
  "enviou",
  "removeu",
]);

/** Entidades que aceitam comentário. Discussão presa ao objeto, não a um grupo. */
export const entidadeComentario = pgEnum("entidade_comentario", [
  "projeto",
  "ordem_servico",
  "cliente",
  "usina",
]);
