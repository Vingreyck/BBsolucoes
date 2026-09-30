/**
 * As regras da trilha — o caminho que o técnico percorreu, desenhado no mapa
 * do escritório. Sem banco e sem rede: só conta, para ser testado sozinho.
 *
 * Vieram do SeeNet, onde cada uma custou uma queixa com foto:
 *
 * - **Reta cortando casas.** Ponto gravado de 15 em 15 s a 60 km/h fica a
 *   250 m do anterior — a linha atravessa o quarteirão. Andando, grava de 5 em
 *   5 s; parado, de minuto em minuto.
 * - **Reta atravessando o mapa.** Duas visitas à mesma OS em dias diferentes
 *   ligadas por uma linha só. Buraco de mais de 5 min abre um trecho novo.
 * - **Estrela em cima da casa do cliente.** No local, o celular usa precisão
 *   média de propósito (poupa bateria), e cada leitura cai num canto num raio
 *   de 100 m. Ponto com precisão pior que 50 m não entra, e "andou" só conta
 *   se andou mais do que a incerteza somada das duas leituras.
 * - **Salto impossível.** Leitura que exigiria mais de 200 km/h é GPS errado.
 */

/** Acima disso é leitura de antena ou Wi-Fi: serve para "onde está", não para desenhar rota. */
export const PRECISAO_MAXIMA_M = 50;
/** Salto que exigiria esta velocidade é leitura errada, não deslocamento. */
export const VELOCIDADE_ABSURDA_KMH = 200;
/** Piso do que conta como "andou". O limite real é a incerteza das leituras, se maior. */
export const MOVIMENTO_MINIMO_M = 15;
/** Buraco maior que isto é outra visita, ou a volta de uma pausa: trecho novo. */
export const BURACO_NOVO_TRECHO_MS = 5 * 60_000;
/** Acima disto (≈ 5 km/h) está em movimento. Em m/s, como o GPS informa. */
export const VELOCIDADE_MOVIMENTO_MS = 1.5;
/** Abaixo disto (≈ 3 km/h), com a velocidade informada, está parado. */
export const VELOCIDADE_PARADO_MS = 0.8;
/** Intervalo de gravação andando (~80 m a 60 km/h: acompanha a rua) e parado. */
export const INTERVALO_ANDANDO_MS = 5_000;
export const INTERVALO_PARADO_MS = 60_000;

export interface Ponto {
  latitude: number;
  longitude: number;
  /** Margem de erro em metros, quando o celular informa. */
  precisao?: number | null;
  /** Em m/s, quando o celular informa. */
  velocidade?: number | null;
  capturadoEm: Date;
}

/** Distância em metros entre duas coordenadas (Haversine). */
export function distanciaMetros(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6_371_000;
  const rad = (g: number) => (g * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLon = rad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Coordenada que presta: dentro do mundo e fora da "ilha nula" (0,0) do GPS sem sinal. */
export function coordenadaValida(latitude: number, longitude: number): boolean {
  return (
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    Math.abs(latitude) <= 90 &&
    Math.abs(longitude) <= 180 &&
    !(latitude === 0 && longitude === 0)
  );
}

function numeroOuNulo(v: number | null | undefined): number | null {
  return v === null || v === undefined || !Number.isFinite(v) ? null : v;
}

/**
 * Este ponto entra na trilha? Decidido na gravação, contra o último gravado
 * da mesma OS — o que não entra nem ocupa espaço no banco.
 *
 * Velocidade só pesa quando o celular informou: aparelho que não informa
 * continua gravando (senão a trilha dele sumiria), no ritmo de parado.
 */
export function deveGravar(ultimo: { capturadoEm: Date } | null, ponto: Ponto): boolean {
  if (!coordenadaValida(ponto.latitude, ponto.longitude)) return false;
  const precisao = numeroOuNulo(ponto.precisao);
  if (precisao !== null && precisao > PRECISAO_MAXIMA_M) return false;

  const velocidade = numeroOuNulo(ponto.velocidade);
  // Parado de verdade não é caminho: vira rabisco no destino. Onde ele está
  // continua no mapa — vem da posição atual, que é outra tabela.
  if (velocidade !== null && velocidade < VELOCIDADE_PARADO_MS) return false;

  if (!ultimo) return true;
  const intervalo = velocidade !== null && velocidade > VELOCIDADE_MOVIMENTO_MS ? INTERVALO_ANDANDO_MS : INTERVALO_PARADO_MS;
  return ponto.capturadoEm.getTime() - ultimo.capturadoEm.getTime() >= intervalo;
}

export interface PontoLimpo {
  latitude: number;
  longitude: number;
  precisao: number | null;
  capturadoEm: Date;
}

/**
 * Tira o lixo que ainda sobrou e divide a trilha em trechos contínuos — um
 * risco por trecho, nunca uma reta ligando dois dias. Vale também para o que
 * já está gravado: mudar a regra aqui limpa o passado na próxima leitura.
 */
export function limparTrilha(brutos: Ponto[]): { trechos: PontoLimpo[][]; descartados: number } {
  const trechos: PontoLimpo[][] = [];
  let atual: PontoLimpo[] = [];
  let anterior: { latitude: number; longitude: number; quando: number; precisao: number | null } | null = null;
  let descartados = 0;

  const ordenados = [...brutos].sort((a, b) => a.capturadoEm.getTime() - b.capturadoEm.getTime());
  for (const p of ordenados) {
    if (!coordenadaValida(p.latitude, p.longitude)) {
      descartados++;
      continue;
    }
    const precisao = numeroOuNulo(p.precisao);
    if (precisao !== null && precisao > PRECISAO_MAXIMA_M) {
      descartados++;
      continue;
    }
    const quando = p.capturadoEm.getTime();

    if (anterior) {
      const metros = distanciaMetros(anterior.latitude, anterior.longitude, p.latitude, p.longitude);
      const ms = quando - anterior.quando;
      if (ms >= BURACO_NOVO_TRECHO_MS) {
        if (atual.length >= 2) trechos.push(atual);
        atual = [];
      } else {
        if (ms > 0 && metros / 1000 / (ms / 3_600_000) > VELOCIDADE_ABSURDA_KMH) {
          descartados++;
          continue;
        }
        // Andou menos do que as leituras conseguem afirmar: é ruído. Duas
        // leituras do mesmo lugar, cada uma com 45 m de erro, podem cair até
        // 90 m uma da outra — por isso a soma, e não a maior (o SeeNet usava a
        // maior, e sobrava risco em cima da casa). O `anterior` não avança,
        // para a oscilação não ir somando passo a passo.
        const incerteza = (precisao ?? 0) + (anterior.precisao ?? 0);
        if (metros < Math.max(MOVIMENTO_MINIMO_M, incerteza)) {
          descartados++;
          continue;
        }
      }
    }

    const limpo = { latitude: p.latitude, longitude: p.longitude, precisao, capturadoEm: p.capturadoEm };
    atual.push(limpo);
    anterior = { latitude: p.latitude, longitude: p.longitude, quando, precisao };
  }
  if (atual.length >= 2) trechos.push(atual);
  return { trechos, descartados };
}

export type Frescor = "ao_vivo" | "atrasado" | "sem_sinal";

/**
 * A posição ainda vale? No local do cliente o celular manda de minuto em
 * minuto (modo econômico), então os limites são mais folgados — senão o
 * técnico trabalhando apareceria "sem sinal".
 */
export function frescorDa(capturadoEm: Date, modo: string, agora: Date = new Date()): Frescor {
  const segundos = (agora.getTime() - capturadoEm.getTime()) / 1000;
  const eco = modo === "eco";
  if (segundos < (eco ? 90 : 30)) return "ao_vivo";
  if (segundos < (eco ? 300 : 120)) return "atrasado";
  return "sem_sinal";
}
