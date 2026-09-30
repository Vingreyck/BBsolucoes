import type * as Leaflet from "leaflet";

import type { PosicaoAoVivo, TrilhaDaOs } from "@/rastreamento/acompanhamento";
import { frescorDa, type Frescor } from "@/rastreamento/trilha";

/*
 * O que os mapas do site têm em comum: o Leaflet com o OpenStreetMap (grátis,
 * sem chave — a mesma escolha do SeeNet depois de o Google Maps pedir cartão),
 * os ícones e o desenho do trajeto. Só roda no navegador.
 */

export type L = typeof Leaflet;

/** Carregado só no navegador: o Leaflet mexe em `window` ao ser importado. */
export async function carregarLeaflet(): Promise<L> {
  const modulo = await import("leaflet");
  return ((modulo as unknown as { default?: L }).default ?? modulo) as L;
}

/** Centro de Sergipe, para o mapa vazio não abrir no meio do oceano. */
const SERGIPE: [number, number] = [-10.75, -37.3];

export function criarMapa(L: L, elemento: HTMLElement): Leaflet.Map {
  const mapa = L.map(elemento, { zoomControl: true, attributionControl: true }).setView(SERGIPE, 9);
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',
  }).addTo(mapa);
  return mapa;
}

export type Tom = "caminho" | "local" | "sem_sinal";

export function tomDa(status: string, posicao: PosicaoAoVivo | null, agora: number): Tom {
  if (!posicao || frescorDa(new Date(posicao.capturadoEm), posicao.modo, new Date(agora)) === "sem_sinal") return "sem_sinal";
  return status === "em_deslocamento" ? "caminho" : "local";
}

const PARTICULAS = new Set(["da", "das", "de", "di", "do", "dos", "e"]);

/** "Diego Andrade" → "DA"; "Vinícius Lima dos Santos" → "VS". */
export function iniciais(nome: string): string {
  const partes = nome.trim().split(/\s+/).filter((p) => p && !PARTICULAS.has(p.toLowerCase()));
  return ((partes[0]?.[0] ?? "") + (partes.length > 1 ? partes[partes.length - 1][0] : "")).toUpperCase();
}

const escapar = (t: string) => t.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** O técnico no mapa: as iniciais num círculo da cor da situação; pulsa quando está ao vivo. */
export function iconeTecnico(L: L, nome: string, tom: Tom, aoVivo: boolean, selecionado = false): Leaflet.DivIcon {
  return L.divIcon({
    className: "",
    html: `<div class="pino-tecnico tom-${tom}${aoVivo ? " vivo" : ""}${selecionado ? " escolhido" : ""}"><span>${escapar(iniciais(nome))}</span></div>`,
    iconSize: [38, 38],
    iconAnchor: [19, 19],
  });
}

export function iconeDestino(L: L): Leaflet.DivIcon {
  return L.divIcon({
    className: "",
    html: `<div class="pino-destino" title="Usina do cliente">⌂</div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });
}

const COR_TRILHA = "#2f6fb0";

/**
 * O trajeto numa camada: um risco por trecho (nunca uma reta ligando dois
 * dias), a bolinha de partida, a casa do cliente e onde cada ação foi feita.
 * Devolve os pontos desenhados, para enquadrar o mapa.
 */
export function desenharTrilha(L: L, camada: Leaflet.LayerGroup, trilha: TrilhaDaOs): Leaflet.LatLngExpression[] {
  camada.clearLayers();
  const todos: Leaflet.LatLngExpression[] = [];
  for (const trecho of trilha.trechos) {
    const linha = trecho.map((p) => [p.latitude, p.longitude] as [number, number]);
    L.polyline(linha, { color: COR_TRILHA, weight: 4, opacity: 0.85 }).addTo(camada);
    todos.push(...linha);
  }
  const partida = trilha.trechos[0]?.[0];
  if (partida) {
    L.circleMarker([partida.latitude, partida.longitude], {
      radius: 6,
      color: "#ffffff",
      weight: 2,
      fillColor: COR_TRILHA,
      fillOpacity: 1,
    })
      .bindTooltip("Início do trajeto")
      .addTo(camada);
  }
  for (const m of trilha.marcos) {
    const hora = new Date(m.ocorridoEm).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Maceio" });
    L.circleMarker([m.latitude, m.longitude], {
      radius: 5,
      color: "#12171c",
      weight: 1.5,
      fillColor: m.tipo === "concluida" ? "#2c6e49" : m.tipo === "iniciada" ? "#a8521f" : "#ffffff",
      fillOpacity: 1,
    })
      .bindTooltip(`${m.titulo} · ${hora}${m.precisao ? ` (±${m.precisao} m)` : ""}`)
      .addTo(camada);
    todos.push([m.latitude, m.longitude]);
  }
  if (trilha.destino) {
    L.marker([trilha.destino.latitude, trilha.destino.longitude], { icon: iconeDestino(L), keyboard: false })
      .bindTooltip("Usina do cliente")
      .addTo(camada);
    todos.push([trilha.destino.latitude, trilha.destino.longitude]);
  }
  return todos;
}

/** "ao vivo", "há 45 s", "há 6 min · sem sinal". */
export function textoFrescor(posicao: PosicaoAoVivo | null, agora: number): { frescor: Frescor; texto: string } {
  if (!posicao) return { frescor: "sem_sinal", texto: "esperando o GPS" };
  const quando = new Date(posicao.capturadoEm);
  const frescor = frescorDa(quando, posicao.modo, new Date(agora));
  if (frescor === "ao_vivo") return { frescor, texto: "ao vivo" };
  const s = Math.max(0, (agora - quando.getTime()) / 1000);
  const ha = s < 60 ? `${Math.round(s)} s` : s < 3600 ? `${Math.round(s / 60)} min` : `${Math.floor(s / 3600)} h`;
  return { frescor, texto: `há ${ha}${frescor === "sem_sinal" ? " · sem sinal" : ""}` };
}

export function metros(m: number): string {
  return m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} km`;
}

export function linkMaps(latitude: number, longitude: number): string {
  return `https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}`;
}
