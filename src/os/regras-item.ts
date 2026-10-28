/**
 * Quando um item do checklist está cumprido.
 *
 * Fica num arquivo sem banco de propósito: é a regra que o app espelha no
 * celular (`RegrasOs.cumprido`), e o `testar-regras.ts` a confere sozinha, sem
 * Postgres. Quem decide de verdade é sempre o servidor.
 *
 * A observação entra de três jeitos, por item (`exigeObservacao`):
 *
 *  - `nao`      — é opcional, como sempre foi;
 *  - `sem_foto` — a foto pedida pode ser trocada por uma explicação: sem foto,
 *                 a observação passa a ser obrigatória ("não deu para fotografar
 *                 porque…"). Com a foto, a observação é opcional;
 *  - `sempre`   — a observação é obrigatória, com foto ou sem. A foto continua
 *                 valendo o que valia (aterramento, vagas no quadro…): a
 *                 observação é a conversa, não um atalho.
 *
 * E `agendar`: o técnico deixou o item para a visita de volta (sombra, espaço
 * útil, caminho do cabo). Conta como cumprido, e a conclusão da OS abre a visita.
 */

export type ExigeObservacao = "nao" | "sem_foto" | "sempre";

export const EXIGE_OBSERVACAO: readonly ExigeObservacao[] = ["nao", "sem_foto", "sempre"];

export function ehExigeObservacao(v: unknown): v is ExigeObservacao {
  return typeof v === "string" && (EXIGE_OBSERVACAO as readonly string[]).includes(v);
}

export interface ItemParaRegra {
  tipoResposta: string;
  fotosMinimas: number;
  exigeObservacao: string;
  permiteAgendar: boolean;
}

export interface SituacaoDoItem {
  valor: unknown;
  /** Fotos e vídeos já anexados ao item. */
  fotos: number;
  observacao: string | null | undefined;
  agendar: boolean;
}

export function temTexto(observacao: string | null | undefined): boolean {
  return Boolean(observacao && observacao.trim().length > 0);
}

/** Tem resposta? Foto não tem: é anexo. */
function respondido(tipoResposta: string, valor: unknown): boolean {
  switch (tipoResposta) {
    case "check":
      return valor === true;
    case "sim_nao":
      return typeof valor === "boolean";
    case "multipla":
    case "serial":
      return Array.isArray(valor) && valor.length > 0;
    case "foto":
      return true;
    default:
      return valor !== null && valor !== undefined && valor !== "";
  }
}

/** O item está cumprido com esta resposta, estas fotos e esta observação? */
export function cumprido(item: ItemParaRegra, s: SituacaoDoItem): boolean {
  if (item.permiteAgendar && s.agendar) return true;

  const exige = item.tipoResposta === "foto" ? Math.max(1, item.fotosMinimas) : item.fotosMinimas;
  const temObs = temTexto(s.observacao);
  const fotosOk = s.fotos >= exige || (item.exigeObservacao === "sem_foto" && temObs);
  const observacaoOk = item.exigeObservacao !== "sempre" || temObs;

  return respondido(item.tipoResposta, s.valor) && fotosOk && observacaoOk;
}

/**
 * O que ainda falta, em poucas palavras — "Falta a resposta, 1 foto e a
 * observação". Nulo quando está cumprido. O app tem o mesmo texto.
 */
export function faltaNoItem(item: ItemParaRegra, s: SituacaoDoItem): string | null {
  if (cumprido(item, s)) return null;
  const partes: string[] = [];

  if (!respondido(item.tipoResposta, s.valor)) {
    partes.push(item.tipoResposta === "check" ? "marcar como feito" : "a resposta");
  }
  const exige = item.tipoResposta === "foto" ? Math.max(1, item.fotosMinimas) : item.fotosMinimas;
  const faltam = Math.max(0, exige - s.fotos);
  const temObs = temTexto(s.observacao);
  const fotoPodeSerExplicada = item.exigeObservacao === "sem_foto";
  const semFoto = faltam > 0 && !(fotoPodeSerExplicada && temObs);
  if (semFoto) partes.push(faltam === 1 ? "1 foto" : `${faltam} fotos`);
  if (item.exigeObservacao === "sempre" && !temObs) partes.push("a observação");

  if (partes.length === 0) return null;
  const ultima = partes[partes.length - 1];
  let texto = partes.length === 1 ? ultima : `${partes.slice(0, -1).join(", ")} e ${ultima}`;
  // Onde a foto pode ser trocada por uma explicação, o técnico precisa saber.
  if (semFoto && fotoPodeSerExplicada) texto += " (ou a observação do porquê)";
  return `Falta ${texto}`;
}
