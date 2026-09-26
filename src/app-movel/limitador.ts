/**
 * Freio de tentativas, em memória.
 *
 * Protege as três portas que não pedem login: descobrir código de empresa por
 * tentativa, criar cadastro em massa e adivinhar senha. A janela é deslizante
 * — conta as tentativas dos últimos N minutos, não "até virar a hora".
 *
 * Em memória serve porque o Selebi roda um processo só do Next (o serviço
 * `site` do compose). Se um dia forem dois, cada um terá a sua conta e o
 * limite efetivo dobra; aí o lugar dele é o banco ou um Redis.
 */

const baldes = new Map<string, number[]>();
let ultimaFaxina = 0;

function faxina(agora: number, janelaMaxima: number): void {
  if (agora - ultimaFaxina < 60_000) return;
  ultimaFaxina = agora;
  for (const [chave, marcas] of baldes) {
    if (!marcas.length || agora - marcas[marcas.length - 1] > janelaMaxima) {
      baldes.delete(chave);
    }
  }
}

export type Consumo = { ok: true } | { ok: false; tenteEmSegundos: number };

/** Conta uma tentativa. `ok: false` quando a chave já gastou `maximo` na janela. */
export function consumir(chave: string, maximo: number, janelaMs: number): Consumo {
  const agora = Date.now();
  faxina(agora, 60 * 60_000);

  const marcas = (baldes.get(chave) ?? []).filter((t) => agora - t < janelaMs);
  if (marcas.length >= maximo) {
    baldes.set(chave, marcas);
    return { ok: false, tenteEmSegundos: Math.ceil((marcas[0] + janelaMs - agora) / 1000) };
  }
  marcas.push(agora);
  baldes.set(chave, marcas);
  return { ok: true };
}

/** Esquece as tentativas de uma chave — depois de um login certo, por exemplo. */
export function zerar(chave: string): void {
  baldes.delete(chave);
}

export const MINUTO = 60_000;
