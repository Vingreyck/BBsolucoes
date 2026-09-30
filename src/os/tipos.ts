/**
 * O vocabulário da ordem de serviço, num lugar só.
 *
 * Site, app e relatório falam as mesmas palavras: se "Não atendida" virar
 * "Visita improdutiva" um dia, muda aqui e muda em todo canto.
 */

import type { schema } from "@/db";

export type StatusOs = (typeof schema.statusOs.enumValues)[number];
export type TipoOs = (typeof schema.tipoOs.enumValues)[number];
export type PrioridadeOs = (typeof schema.prioridadeOs.enumValues)[number];

export const STATUS_ROTULO: Record<string, string> = {
  aberta: "A agendar",
  agendada: "Agendada",
  em_deslocamento: "A caminho",
  em_andamento: "Em atendimento",
  aguardando_peca: "Aguardando peça",
  concluida: "Concluída",
  cancelada: "Cancelada",
};

export const TIPO_ROTULO: Record<string, string> = {
  instalacao: "Instalação",
  preventiva: "Preventiva",
  corretiva: "Corretiva",
  limpeza: "Limpeza",
  garantia: "Garantia",
  vistoria: "Vistoria",
};

export const PRIORIDADE_ROTULO: Record<string, string> = {
  baixa: "Baixa",
  normal: "Normal",
  alta: "Alta",
  urgente: "Urgente",
};

/** Peso para ordenar: urgente primeiro. */
export const PRIORIDADE_PESO: Record<string, number> = {
  urgente: 0,
  alta: 1,
  normal: 2,
  baixa: 3,
};

export const ENCERRADAS: readonly StatusOs[] = ["concluida", "cancelada"];

export function encerrada(status: string): boolean {
  return status === "concluida" || status === "cancelada";
}

/**
 * Como o técnico responde a cada item.
 *
 * `serial` é o número de série do inversor: a resposta vai também para
 * `serial_instalado`, e é isso que faz o coletor reconhecer a usina quando ela
 * aparecer no portal do fabricante e ligar ao cliente certo sozinho.
 */
export const TIPOS_RESPOSTA = [
  "check",
  "sim_nao",
  "numero",
  "texto",
  "escolha",
  "multipla",
  "foto",
  "serial",
] as const;

export type TipoResposta = (typeof TIPOS_RESPOSTA)[number];

export const TIPO_RESPOSTA_ROTULO: Record<TipoResposta, string> = {
  check: "Marcar como feito",
  sim_nao: "Sim ou não",
  numero: "Número",
  texto: "Texto",
  escolha: "Uma opção da lista",
  multipla: "Várias opções da lista",
  foto: "Só foto",
  serial: "Números de série",
};

export function ehTipoResposta(valor: string): valor is TipoResposta {
  return (TIPOS_RESPOSTA as readonly string[]).includes(valor);
}

/** Como terminou o atendimento. */
export const RESULTADO_ROTULO: Record<string, string> = {
  resolvido: "Resolvido",
  nao_resolvido: "Não resolvido — precisa voltar",
};

/*
 * Motivos em lista, e não texto livre: é o que permite contar depois quantas
 * visitas a chuva cancelou no mês. "Outro" abre o campo de texto.
 */

export const MOTIVOS_NAO_ATENDIDA = [
  "Cliente ausente",
  "Sem acesso ao local",
  "Chuva ou tempo ruim",
  "Falta de material",
  "Endereço não encontrado",
  "Outro",
];

export const MOTIVOS_REAGENDAMENTO = [
  "Pedido do cliente",
  "Chuva ou tempo ruim",
  "Falta de material",
  "Técnico indisponível",
  "Outro",
];

export const MOTIVOS_CANCELAMENTO = [
  "Cliente desistiu",
  "Aberta por engano",
  "Duplicada",
  "Resolvida sem visita",
  "Outro",
];

export const MOTIVOS_PAUSA = ["Aguardando peça", "Aguardando o cliente", "Outro"];

/** O que aparece no histórico da OS para cada tipo de evento. */
export const EVENTO_ROTULO: Record<string, string> = {
  criada: "Aberta",
  editada: "Dados alterados",
  atribuida: "Responsável definido",
  agendada: "Agendada",
  reagendada: "Reagendada",
  deslocamento: "Saiu para o local",
  iniciada: "Atendimento iniciado",
  pausada: "Pausada",
  retomada: "Atendimento retomado",
  concluida: "Concluída",
  nao_atendida: "Não atendida",
  cancelada: "Cancelada",
  reaberta: "Reaberta",
  retorno: "Retorno aberto",
  esteira: "Projeto avançou na esteira",
  relatorio: "Link do relatório gerado",
};

export const ORIGEM_EVENTO_ROTULO: Record<string, string> = {
  web: "pelo site",
  app: "pelo app",
  sistema: "automático",
};

/** "#0047" — quatro dígitos, que é como o cliente fala da OS ao telefone. */
export function numeroOs(numero: number): string {
  return `#${String(numero).padStart(4, "0")}`;
}
