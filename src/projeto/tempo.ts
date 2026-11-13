/**
 * O tempo desde a assinatura do contrato, em palavras curtas para o cartão da
 * esteira. Sem banco — conferido pelo `testar-regras.ts`.
 *
 * Conta dias corridos, como o relógio de "dias na etapa" do próprio cartão.
 */

export function diasCorridos(desde: Date, agora = new Date()): number {
  return Math.max(0, Math.floor((agora.getTime() - desde.getTime()) / 86_400_000));
}

/** "hoje", "1 d", "12 d": o valor da linha do cartão. */
export function rotuloDoTempo(dias: number): string {
  return dias === 0 ? "hoje" : `${dias} d`;
}

/** "hoje", "há 1 dia", "há 12 dias": para a dica e para leitor de tela. */
export function fraseDoTempo(dias: number): string {
  return dias === 0 ? "hoje" : `há ${dias} ${dias === 1 ? "dia" : "dias"}`;
}
