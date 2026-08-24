/**
 * Rótulos das ordens de serviço.
 *
 * Vivem fora de `page.tsx` porque o Next só admite um conjunto fixo de exports
 * num arquivo de página — `default`, `dynamic`, `metadata` e alguns outros. Um
 * export a mais quebra a verificação de tipos das rotas, e o erro só aparece
 * depois que a rota é compilada pela primeira vez.
 */

export const STATUS_ROTULO: Record<string, string> = {
  aberta: "Aberta",
  agendada: "Agendada",
  em_andamento: "Em andamento",
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
