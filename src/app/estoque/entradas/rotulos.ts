/** As palavras das entradas do estoque, num lugar só (lista e conferência). */

export const SITUACAO_ENTRADA: Record<string, { rotulo: string; classe: string }> = {
  rascunho: { rotulo: "conferir", classe: "sev-atencao" },
  lancada: { rotulo: "lançada", classe: "st-concluida" },
  desfeita: { rotulo: "desfeita", classe: "st-cancelada" },
};

export const LEITURA_ROTULO: Record<string, string> = { xml: "XML", ia: "lida pela Groq", manual: "à mão" };

export const ORIGEM_ROTULO: Record<string, string> = { lista: "lista da nota", observacao: "observação", pedido: "pedido" };
