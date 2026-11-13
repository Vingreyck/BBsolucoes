/** O nome de cada tipo de documento na tela. */
export const ROTULO_DOCUMENTO: Record<string, string> = {
  art: "ART",
  boleto_art: "Boleto da ART",
  contrato: "Contrato",
  memorial: "Memorial",
  procuracao: "Procuração",
  recibo: "Recibo",
  documento_pessoal: "Documento do titular",
  uc_geradora: "Conta de luz da geradora",
  projeto_eletrico: "Projeto elétrico",
  simulacao: "Simulação",
  uc_beneficiaria: "UCs beneficiárias",
  compensativo: "Compensativo",
  nota_fiscal: "Nota fiscal",
  ficha_cadastral: "Ficha cadastral",
  datasheet: "Datasheet e Inmetro",
  comprovante: "Comprovante",
  declaracao: "Declaração",
  orcamento: "Orçamento",
  foto_padrao: "Foto do padrão",
  protocolo: "Protocolo Energisa",
  outro: "Outro",
};

/**
 * Documento que chega sozinho, com o passar da esteira — e de onde ele vem.
 *
 * No dossiê, esses cartões dizem a origem em vez de pedir arquivo; o envio à
 * mão fica escondido, só para quando o automático falhar.
 */
export const ORIGEM_AUTOMATICA: Record<string, string> = {
  foto_padrao: "Chega sozinha pela OS de vistoria: é a foto que o técnico tira no app.",
  uc_geradora: "Chega sozinha pela OS de vistoria: o técnico fotografa a conta de luz no app.",
  protocolo: "Preenchido sozinho quando a extensão da Energisa liga este projeto ao pedido no portal.",
  datasheet:
    "Chega sozinho do catálogo de equipamentos: escolha o inversor e o módulo no cartão “Projeto técnico” do projeto.",
};

/**
 * Os documentos que o cliente manda pelo WhatsApp: o cartão deles no dossiê
 * tem o botão de cobrar.
 */
export const COBRAR_NO_CARTAO = new Set(["documento_pessoal", "contrato", "recibo"]);
