import type { PontoLimpo } from "./trilha";

/**
 * Cola a trilha nas ruas de verdade (map matching).
 *
 * Mesmo limpa, a trilha é uma reta entre um ponto de GPS e o próximo (~80 m),
 * que corta esquina. O OSRM recebe a sequência e devolve o caminho pelas ruas
 * que melhor explica o trajeto — é o mesmo projeto do OpenStreetMap dos
 * mapas, sem chave e sem cobrança.
 *
 * O servidor padrão é o público de demonstração: de graça, sem garantia, e
 * com regras que mudam — em 2026 ele recusa mais de 10 pontos por chamada
 * ("TooBig"; o SeeNet anotou 100) e pede no máximo uma chamada por segundo.
 * Por isso a trilha é amostrada antes de ir (o OSRM completa o caminho pela
 * rua entre um ponto e outro), as chamadas saem em fila, e tudo aqui é "se
 * der": falha, demora ou recusa devolve o trecho cru. `OSRM_URL` aponta para
 * um OSRM próprio (sem esses limites); `OSRM_ATIVO=false` desliga.
 */

export interface Coordenada {
  latitude: number;
  longitude: number;
}

const PUBLICO = "https://router.project-osrm.org";
const TEMPO_MAXIMO_MS = 8_000;
const CACHE_MS = 5 * 60_000;
const CACHE_MAXIMO = 200;

interface Config {
  url: string;
  /** Pontos por chamada: o público recusa acima de 10. */
  maxPontos: number;
  /** Chamadas por trecho: uma OS de dia inteiro não vira 30 chamadas. */
  maxChamadas: number;
  /** Espera entre chamadas: o público pede no máximo uma por segundo. */
  intervaloMs: number;
}

function config(): Config {
  const url = (process.env.OSRM_URL || PUBLICO).replace(/\/$/, "");
  const publico = url === PUBLICO;
  return {
    url,
    maxPontos: Number(process.env.OSRM_MAX_PONTOS) || (publico ? 10 : 90),
    maxChamadas: publico ? 4 : 6,
    intervaloMs: publico ? 1_100 : 0,
  };
}

type Guardado = { valor: Coordenada[][] | null; quando: number };

// No globalThis: o Next pode carregar este módulo mais de uma vez, e o mapa
// aberto no escritório pede a trilha de novo a cada meio minuto.
const cache: Map<string, Guardado> = ((globalThis as Record<string, unknown>).__selebiOsrm ??= new Map()) as Map<
  string,
  Guardado
>;

function ativo(): boolean {
  return process.env.OSRM_ATIVO !== "false";
}

/**
 * No máximo `maximo` pontos, espalhados pelo trecho inteiro, com o primeiro
 * e o último sempre dentro — cortar o fim fazia a trilha sumir no meio do
 * caminho (o defeito que o SeeNet tinha ao passar do teto de chamadas).
 */
export function amostrar<T>(pontos: T[], maximo: number): T[] {
  if (pontos.length <= maximo) return pontos;
  if (maximo < 2) return [pontos[0]];
  const saida: T[] = [];
  for (let i = 0; i < maximo; i++) saida.push(pontos[Math.round((i * (pontos.length - 1)) / (maximo - 1))]);
  return saida;
}

/** Lotes com um ponto de sobreposição, para não abrir buraco entre eles. */
export function dividirEmLotes<T>(pontos: T[], tamanho = 90): T[][] {
  if (pontos.length <= tamanho) return [pontos];
  const lotes: T[][] = [];
  let i = 0;
  while (i < pontos.length) {
    lotes.push(pontos.slice(i, i + tamanho));
    i += tamanho - 1;
    if (pontos.length - i < 2) break;
  }
  return lotes;
}

// Uma chamada por vez, com a folga que o servidor pede — mesmo com dois mapas
// abertos ao mesmo tempo no escritório.
const fila = ((globalThis as Record<string, unknown>).__selebiOsrmFila ??= { ate: Promise.resolve(), ultima: 0 }) as {
  ate: Promise<void>;
  ultima: number;
};

function naVez<T>(intervaloMs: number, tarefa: () => Promise<T>): Promise<T> {
  const minha = fila.ate.then(async () => {
    const espera = fila.ultima + intervaloMs - Date.now();
    if (espera > 0) await new Promise((r) => setTimeout(r, espera));
    try {
      return await tarefa();
    } finally {
      fila.ultima = Date.now();
    }
  });
  fila.ate = minha.then(
    () => undefined,
    () => undefined,
  );
  return minha;
}

async function casarLote(cfg: Config, lote: PontoLimpo[]): Promise<Coordenada[][] | null> {
  // O OSRM usa lon,lat (GeoJSON) — o contrário do resto do sistema. Trocar
  // joga o trajeto no oceano sem dar erro nenhum.
  const coordenadas = lote.map((p) => `${p.longitude.toFixed(6)},${p.latitude.toFixed(6)}`).join(";");
  // Raio de busca por ponto, pela precisão da leitura: o padrão do OSRM é
  // apertado para GPS de celular e desiste ("NoMatch") em rua paralela.
  const raios = lote.map((p) => Math.round(Math.min(Math.max(p.precisao ?? 15, 10), 50))).join(";");
  const url =
    `${cfg.url}/match/v1/driving/${coordenadas}` +
    // Sem `timestamps` de propósito: o OSRM exige que cresçam sempre, e dois
    // pontos no mesmo segundo derrubariam a chamada inteira.
    `?geometries=geojson&overview=full&tidy=true&radiuses=${raios}`;

  const abortar = new AbortController();
  const relogio = setTimeout(() => abortar.abort(), TEMPO_MAXIMO_MS);
  try {
    const resposta = await fetch(url, {
      signal: abortar.signal,
      headers: { "user-agent": "Selebi/1.0 (rastreamento de tecnico em campo)" },
    });
    if (!resposta.ok) return null;
    const dados = (await resposta.json()) as {
      code?: string;
      matchings?: { geometry?: { coordinates?: [number, number][] } }[];
    };
    if (dados.code !== "Ok" || !Array.isArray(dados.matchings)) return null;
    // Vários "matchings" = o OSRM não conseguiu ligar tudo num caminho só.
    // Cada um vira um pedaço: juntá-los desenharia a reta que se quer evitar.
    const pedacos = dados.matchings
      .map((m) => (m.geometry?.coordinates ?? []).map(([lon, lat]) => ({ latitude: lat, longitude: lon })))
      .filter((linha) => linha.length >= 2);
    return pedacos.length ? pedacos : null;
  } catch {
    return null;
  } finally {
    clearTimeout(relogio);
  }
}

/**
 * Um trecho contínuo colado nas ruas, em um ou mais pedaços. `null` quando
 * não dá (desligado, trecho curto demais, OSRM fora) — quem chamou desenha cru.
 */
export async function casarNasRuas(trecho: PontoLimpo[]): Promise<Coordenada[][] | null> {
  if (!ativo() || trecho.length < 3) return null;

  const primeiro = trecho[0];
  const ultimo = trecho[trecho.length - 1];
  const chave = `${trecho.length}|${primeiro.latitude},${primeiro.longitude}|${ultimo.latitude},${ultimo.longitude}|${ultimo.capturadoEm.getTime()}`;
  const guardado = cache.get(chave);
  if (guardado && Date.now() - guardado.quando < CACHE_MS) return guardado.valor;

  const cfg = config();
  // Amostra que cabe no teto de chamadas — do começo ao fim do trecho.
  const capacidade = cfg.maxChamadas * (cfg.maxPontos - 1) + 1;
  const lotes = dividirEmLotes(amostrar(trecho, capacidade), cfg.maxPontos);
  const pedacos: Coordenada[][] = [];
  for (const lote of lotes) {
    const casado = await naVez(cfg.intervaloMs, () => casarLote(cfg, lote));
    // Lote que falha sai cru, sem invalidar os outros.
    pedacos.push(...(casado ?? [lote.map((p) => ({ latitude: p.latitude, longitude: p.longitude }))]));
  }
  const valor = pedacos.length ? pedacos : null;

  if (cache.size >= CACHE_MAXIMO) {
    const maisAntiga = cache.keys().next().value;
    if (maisAntiga !== undefined) cache.delete(maisAntiga);
  }
  cache.set(chave, { valor, quando: Date.now() });
  return valor;
}
