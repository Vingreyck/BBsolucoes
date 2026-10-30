/**
 * A cobrança de documento ao cliente: o que pedir, com que palavras, e para
 * qual número de WhatsApp.
 *
 * Sem banco e sem tela — são as contas que a página de cobrança e o dossiê
 * usam, e que o `testar-regras.ts` confere.
 *
 * Só se cobra do cliente o que é do cliente. ART, memorial, projeto elétrico e
 * protocolo são trabalho da equipe: aparecem no dossiê, mas mandar mensagem ao
 * cliente pedindo a ART seria cobrar dele o serviço que ele contratou.
 */

/**
 * O pedido, em palavras de cliente. A ordem aqui é a ordem na mensagem: o que
 * ele tem na mão primeiro (conta de luz, documento), o que exige ir até o
 * padrão ou assinar depois.
 */
export const PEDIDO_AO_CLIENTE: Record<string, string> = {
  uc_geradora: "uma conta de luz recente do imóvel onde vão ficar as placas, com o número da UC legível",
  documento_pessoal: "foto do RG ou da CNH do titular da conta de luz (frente e verso)",
  uc_beneficiaria: "a conta de luz de cada imóvel que vai receber os créditos de energia",
  foto_padrao: "uma foto do padrão de energia (a caixa do medidor), de frente, mostrando o disjuntor e o número do medidor",
  ficha_cadastral: "a ficha cadastral preenchida",
  contrato: "o contrato que enviamos, assinado",
  procuracao: "a procuração que enviamos, assinada",
  declaracao: "a declaração que enviamos, assinada",
  comprovante: "o comprovante de pagamento",
};

/** O nome curto, para as etiquetas da tela. */
export const ROTULO_PEDIDO: Record<string, string> = {
  uc_geradora: "Conta de luz",
  documento_pessoal: "Documento do titular",
  uc_beneficiaria: "UCs beneficiárias",
  foto_padrao: "Foto do padrão",
  ficha_cadastral: "Ficha cadastral",
  contrato: "Contrato assinado",
  procuracao: "Procuração assinada",
  declaracao: "Declaração assinada",
  comprovante: "Comprovante",
};

export function ehDoCliente(tipo: string): boolean {
  return tipo in PEDIDO_AO_CLIENTE;
}

/** Só os tipos que o cliente manda, na ordem da mensagem. */
export function pedidosAoCliente(tipos: Iterable<string>): string[] {
  const set = new Set(tipos);
  return Object.keys(PEDIDO_AO_CLIENTE).filter((t) => set.has(t));
}

export interface Exigencia {
  tipo: string;
  obrigatorio: boolean;
  exigeAssinatura?: boolean;
  etapa: { ordem: number };
}

/**
 * O que falta para o dossiê sair da etapa atual: documento obrigatório, exigido
 * até esta etapa, que não está na pasta (da venda ou da pessoa). Arquivo de
 * trabalho (`.dwg`, `.xlsm`) não conta como entregue.
 */
export function faltaNoDossie<E extends Exigencia>(
  etapaOrdem: number,
  exigencias: E[],
  entregues: Set<string>,
): E[] {
  return exigencias.filter((e) => e.obrigatorio && e.etapa.ordem <= etapaOrdem && !entregues.has(e.tipo));
}

/**
 * "(79) 99999-1234" → "5579999991234". O que não parece telefone brasileiro
 * (menos de 10 dígitos, ou demais) volta nulo: melhor pedir o número certo do
 * que abrir o WhatsApp numa conversa com um estranho.
 */
export function numeroWhatsapp(telefone: string | null | undefined): string | null {
  let d = (telefone ?? "").replace(/\D/g, "");
  if (d.startsWith("55") && (d.length === 12 || d.length === 13)) return d;
  d = d.replace(/^0+/, "");
  // Com operadora: 0 + 2 da operadora + DDD + número ("0 41 79 99999-1234").
  if (d.length === 13 || d.length === 12) d = d.slice(2);
  if (d.length === 10 || d.length === 11) return `55${d}`;
  return null;
}

export function primeiroNome(nome: string): string {
  const n = nome.trim().split(/\s+/)[0] ?? "";
  return n ? n.charAt(0).toUpperCase() + n.slice(1).toLowerCase() : "";
}

/**
 * A mensagem pronta. Quem manda ainda pode mexer antes de enviar — o WhatsApp
 * abre com o texto no campo, não envia sozinho.
 *
 * A segunda cobrança muda a abertura ("passando para lembrar"): mandar a mesma
 * mensagem idêntica de novo soa como robô.
 */
export function mensagemDeCobranca(d: {
  cliente: string;
  empresa: string;
  tipos: string[];
  jaCobrado: boolean;
}): string {
  const nome = primeiroNome(d.cliente);
  const pedidos = pedidosAoCliente(d.tipos).map((t) => `• ${PEDIDO_AO_CLIENTE[t]}`);
  const abertura = d.jaCobrado
    ? `Olá${nome ? `, ${nome}` : ""}! Aqui é da ${d.empresa}, passando para lembrar: para seguir com o seu projeto de energia solar, ainda falta${pedidos.length > 1 ? "m" : ""}:`
    : `Olá${nome ? `, ${nome}` : ""}! Aqui é da ${d.empresa}. Para seguir com o seu projeto de energia solar, precisamos de:`;
  return [abertura, ...pedidos, "", "Pode mandar por aqui mesmo — foto pelo celular serve. Obrigado!"].join("\n");
}

export function linkWhatsapp(numero: string, texto: string): string {
  return `https://wa.me/${numero}?text=${encodeURIComponent(texto)}`;
}

/** Quantas viradas de dia (no relógio do servidor) entre as duas datas. */
export function diasEntre(quando: Date, agora = new Date()): number {
  const dia = (d: Date) => Math.floor((d.getTime() - d.getTimezoneOffset() * 60_000) / 86_400_000);
  return Math.max(0, dia(agora) - dia(quando));
}

/** "hoje", "ontem", "há 5 dias" — para a coluna da última cobrança. */
export function haQuantoTempo(quando: Date, agora = new Date()): string {
  const dias = diasEntre(quando, agora);
  if (dias === 0) return "hoje";
  if (dias === 1) return "ontem";
  return `há ${dias} dias`;
}
