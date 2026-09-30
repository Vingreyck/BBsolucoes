/**
 * Quem está olhando o mapa agora, e o aviso para cada um quando o técnico se
 * mexe. É o "fan-out" do SeeNet: o celular continua escrevendo por HTTP (quem
 * grava e tem fila offline), e daqui só sai a leitura ao vivo — se isto cair,
 * nenhuma posição se perde, o mapa só volta a atualizar pela consulta.
 *
 * Fica na memória do processo, e isso basta enquanto o site roda num processo
 * só (o `site` do docker compose). Com duas instâncias, o ponto chegaria numa
 * e o mapa estaria na outra: aí o caminho é Redis pub/sub entre elas.
 */

export type EventoCampo =
  | {
      tipo: "posicao";
      ordemId: string;
      usuarioId: string;
      latitude: number;
      longitude: number;
      precisao: number | null;
      velocidade: number | null;
      bateria: number | null;
      modo: string;
      capturadoEm: string;
    }
  /** Uma OS mudou de situação: quem está no mapa recarrega a lista. */
  | { tipo: "os"; ordemId: string };

type Ouvinte = (evento: EventoCampo) => void;

// No globalThis porque o Next carrega a rota que recebe a posição e a que
// transmite para o mapa como módulos separados — um Map de módulo comum
// seriam dois Maps, e o aviso nunca chegaria.
const ouvintes: Map<string, Set<Ouvinte>> = ((globalThis as Record<string, unknown>).__selebiCampo ??= new Map()) as Map<
  string,
  Set<Ouvinte>
>;

/** Passa a ouvir a empresa. Devolve a função que para de ouvir. */
export function assinar(empresaId: string, ouvinte: Ouvinte): () => void {
  let conjunto = ouvintes.get(empresaId);
  if (!conjunto) {
    conjunto = new Set();
    ouvintes.set(empresaId, conjunto);
  }
  conjunto.add(ouvinte);
  return () => {
    const atual = ouvintes.get(empresaId);
    if (!atual) return;
    atual.delete(ouvinte);
    // Conjunto vazio sai do Map, senão ele cresce um pouco a cada mapa fechado.
    if (atual.size === 0) ouvintes.delete(empresaId);
  };
}

/** Avisa quem estiver ouvindo. Ninguém ouvindo (o normal) sai na hora. */
export function publicar(empresaId: string, evento: EventoCampo): void {
  const conjunto = ouvintes.get(empresaId);
  if (!conjunto?.size) return;
  for (const ouvinte of conjunto) {
    try {
      ouvinte(evento);
    } catch {
      // Um mapa com problema não derruba o aviso para os outros.
    }
  }
}

export function quantosOuvindo(empresaId: string): number {
  return ouvintes.get(empresaId)?.size ?? 0;
}
