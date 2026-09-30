"use client";

import "leaflet/dist/leaflet.css";

import type * as Leaflet from "leaflet";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { TecnicoEmCampo, TrilhaDaOs } from "@/rastreamento/acompanhamento";
import type { EventoCampo } from "@/rastreamento/hub";
import { distanciaMetros } from "@/rastreamento/trilha";

import {
  carregarLeaflet,
  criarMapa,
  desenharTrilha,
  iconeTecnico,
  linkMaps,
  metros,
  textoFrescor,
  tomDa,
  type L,
} from "../mapa-base";

/**
 * Quem está em campo, ao vivo: a lista à esquerda, o mapa à direita.
 *
 * A posição chega empurrada pelo servidor (`/stream`) no instante em que o
 * celular manda. A lista — quem entrou e quem saiu de campo — vem da consulta
 * a cada 30 s e de um aviso quando alguma OS muda de situação. Se o fluxo ao
 * vivo cair (rede que bloqueia, servidor reiniciando), a consulta segue
 * sozinha e o selo passa de "ao vivo" para "a cada 30 s": nunca fica calado
 * fingindo que está tudo em dia.
 */

const STATUS: Record<string, string> = { em_deslocamento: "A caminho", em_andamento: "Em atendimento" };
const TIPO: Record<string, string> = {
  vistoria: "Vistoria",
  instalacao: "Instalação",
  preventiva: "Preventiva",
  corretiva: "Corretiva",
  limpeza: "Limpeza",
  garantia: "Garantia",
};

function numero(n: number): string {
  return `#${String(n).padStart(4, "0")}`;
}

function hora(iso: string | null): string {
  return iso ? new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Maceio" }) : "—";
}

export default function PainelCampo({ inicial }: { inicial: TecnicoEmCampo[] }) {
  const [tecnicos, setTecnicos] = useState(inicial);
  const [selecionado, setSelecionado] = useState<string | null>(null);
  const [trilha, setTrilha] = useState<TrilhaDaOs | null>(null);
  const [aoVivo, setAoVivo] = useState(false);
  const [agora, setAgora] = useState(() => Date.now());

  const elemento = useRef<HTMLDivElement>(null);
  const leaflet = useRef<L | null>(null);
  const mapa = useRef<Leaflet.Map | null>(null);
  const marcadores = useRef(new Map<string, Leaflet.Marker>());
  const camadaTrilha = useRef<Leaflet.LayerGroup | null>(null);
  // O rastro ao vivo: o que o técnico andou desde o último desenho do trajeto
  // (que vem a cada 30 s). Tracejado, até o trajeto novo chegar.
  const cauda = useRef<{ ordemId: string | null; pontos: [number, number][]; linha: Leaflet.Polyline | null }>({
    ordemId: null,
    pontos: [],
    linha: null,
  });
  const selecionadoRef = useRef<string | null>(null);
  selecionadoRef.current = selecionado;
  const enquadrou = useRef(false);
  const [mapaPronto, setMapaPronto] = useState(false);

  // O relógio que faz "ao vivo" virar "há 2 min" com a tela parada.
  useEffect(() => {
    const t = setInterval(() => setAgora(Date.now()), 5_000);
    return () => clearInterval(t);
  }, []);

  const recarregar = useCallback(async () => {
    try {
      const r = await fetch("/os/acompanhamento/dados", { cache: "no-store" });
      if (r.ok) setTecnicos(((await r.json()) as { tecnicos: TecnicoEmCampo[] }).tecnicos);
    } catch {
      // Sem rede no escritório: fica a última lista, e a próxima volta tenta de novo.
    }
  }, []);

  // A consulta de reserva: a cada 30 s, e é ela que traz quem entrou ou saiu de campo.
  useEffect(() => {
    const t = setInterval(recarregar, 30_000);
    return () => clearInterval(t);
  }, [recarregar]);

  // O fluxo ao vivo. O navegador reconecta sozinho se cair.
  useEffect(() => {
    const fonte = new EventSource("/os/acompanhamento/stream");
    let espera: ReturnType<typeof setTimeout> | undefined;
    fonte.addEventListener("pronto", () => setAoVivo(true));
    fonte.addEventListener("posicao", (e) => {
      const ev = JSON.parse((e as MessageEvent<string>).data) as Extract<EventoCampo, { tipo: "posicao" }>;
      setTecnicos((lista) => {
        const i = lista.findIndex((t) => t.ordemId === ev.ordemId);
        if (i < 0) {
          // Alguém novo em campo: a lista inteira vem de novo.
          clearTimeout(espera);
          espera = setTimeout(recarregar, 300);
          return lista;
        }
        const t = lista[i];
        const posicao = {
          latitude: ev.latitude,
          longitude: ev.longitude,
          precisao: ev.precisao,
          velocidade: ev.velocidade,
          bateria: ev.bateria,
          modo: ev.modo,
          capturadoEm: ev.capturadoEm,
        };
        const novo = {
          ...t,
          posicao,
          distanciaDestinoM: t.destino
            ? Math.round(distanciaMetros(ev.latitude, ev.longitude, t.destino.latitude, t.destino.longitude))
            : null,
        };
        return lista.map((x, j) => (j === i ? novo : x));
      });
      if (ev.ordemId === selecionadoRef.current) esticarCauda(ev.latitude, ev.longitude);
      setAgora(Date.now());
    });
    fonte.addEventListener("os", () => {
      clearTimeout(espera);
      espera = setTimeout(recarregar, 300);
    });
    fonte.onerror = () => setAoVivo(false);
    return () => {
      clearTimeout(espera);
      fonte.close();
    };
  }, [recarregar]);

  // O mapa, uma vez.
  useEffect(() => {
    let vivo = true;
    carregarLeaflet().then((L) => {
      if (!vivo || !elemento.current || mapa.current) return;
      leaflet.current = L;
      mapa.current = criarMapa(L, elemento.current);
      camadaTrilha.current = L.layerGroup().addTo(mapa.current);
      setMapaPronto(true);
    });
    return () => {
      vivo = false;
      mapa.current?.remove();
      mapa.current = null;
      marcadores.current.clear();
    };
  }, []);

  // Os pinos: um por OS em campo, movidos no lugar (sem piscar o mapa).
  useEffect(() => {
    const L = leaflet.current;
    const m = mapa.current;
    if (!L || !m) return;
    const vistos = new Set<string>();
    for (const t of tecnicos) {
      if (!t.posicao) continue;
      vistos.add(t.ordemId);
      const { frescor } = textoFrescor(t.posicao, agora);
      const icone = iconeTecnico(L, t.tecnico?.nome ?? "?", tomDa(t.status, t.posicao, agora), frescor === "ao_vivo", t.ordemId === selecionado);
      const ponto: [number, number] = [t.posicao.latitude, t.posicao.longitude];
      const existente = marcadores.current.get(t.ordemId);
      if (existente) {
        existente.setLatLng(ponto);
        existente.setIcon(icone);
      } else {
        const novo = L.marker(ponto, { icon: icone, riseOnHover: true })
          .bindTooltip(`${t.tecnico?.nome ?? "Sem técnico"} · ${numero(t.numero)}`, { direction: "top", offset: [0, -18] })
          .on("click", () => setSelecionado(t.ordemId))
          .addTo(m);
        marcadores.current.set(t.ordemId, novo);
      }
    }
    for (const [id, marcador] of marcadores.current) {
      if (!vistos.has(id)) {
        marcador.remove();
        marcadores.current.delete(id);
      }
    }
    // Na primeira vez com gente em campo, enquadra todo mundo.
    if (!enquadrou.current && vistos.size) {
      enquadrou.current = true;
      verTodos();
    }
  }, [tecnicos, agora, selecionado, mapaPronto]);

  // O trajeto de quem foi escolhido, renovado a cada 30 s.
  useEffect(() => {
    if (!selecionado) {
      camadaTrilha.current?.clearLayers();
      setTrilha(null);
      return;
    }
    let vivo = true;
    const buscar = async (enquadrar: boolean) => {
      try {
        const r = await fetch(`/os/${selecionado}/trilha`, { cache: "no-store" });
        if (!r.ok || !vivo) return;
        const t = (await r.json()) as TrilhaDaOs;
        setTrilha(t);
        const L = leaflet.current;
        if (L && camadaTrilha.current) {
          const pontos = desenharTrilha(L, camadaTrilha.current, t);
          const fim = t.trechos.at(-1)?.at(-1);
          cauda.current = { ordemId: selecionado, pontos: fim ? [[fim.latitude, fim.longitude]] : [], linha: null };
          const atual = marcadores.current.get(selecionado)?.getLatLng();
          if (atual) pontos.push(atual);
          if (enquadrar && pontos.length) mapa.current?.fitBounds(L.latLngBounds(pontos), { padding: [48, 48], maxZoom: 17 });
        }
      } catch {
        // Fica o último trajeto desenhado.
      }
    };
    buscar(true);
    const t = setInterval(() => buscar(false), 30_000);
    return () => {
      vivo = false;
      clearInterval(t);
    };
  }, [selecionado, mapaPronto]);

  function esticarCauda(latitude: number, longitude: number) {
    const L = leaflet.current;
    const camada = camadaTrilha.current;
    if (!L || !camada || cauda.current.ordemId !== selecionadoRef.current) return;
    cauda.current.pontos.push([latitude, longitude]);
    if (cauda.current.pontos.length < 2) return;
    if (cauda.current.linha) cauda.current.linha.setLatLngs(cauda.current.pontos);
    else
      cauda.current.linha = L.polyline(cauda.current.pontos, {
        color: "#2f6fb0",
        weight: 3,
        opacity: 0.8,
        dashArray: "6 6",
      }).addTo(camada);
  }

  function verTodos() {
    const L = leaflet.current;
    const pontos = [...marcadores.current.values()].map((m) => m.getLatLng());
    if (!L || !mapa.current || !pontos.length) return;
    if (pontos.length === 1) mapa.current.setView(pontos[0], 15);
    else mapa.current.fitBounds(L.latLngBounds(pontos), { padding: [48, 48], maxZoom: 16 });
  }

  function escolher(t: TecnicoEmCampo) {
    setSelecionado((atual) => (atual === t.ordemId ? null : t.ordemId));
    if (t.posicao) mapa.current?.flyTo([t.posicao.latitude, t.posicao.longitude], 16, { duration: 0.6 });
  }

  const escolhido = useMemo(() => tecnicos.find((t) => t.ordemId === selecionado) ?? null, [tecnicos, selecionado]);
  const comGps = tecnicos.filter((t) => t.posicao).length;

  return (
    <div className="campo">
      <div className="campo-lista">
        <div className="campo-resumo">
          <span>
            <strong>{tecnicos.length}</strong> em campo · {comGps} com GPS
          </span>
          <span className={`selo-vivo ${aoVivo ? "sim" : "nao"}`} title={aoVivo ? "Posições chegando na hora" : "Sem o fluxo ao vivo: a lista atualiza a cada 30 s"}>
            {aoVivo ? "● ao vivo" : "↻ a cada 30 s"}
          </span>
        </div>
        {tecnicos.length === 0 && (
          <p className="campo-vazio">
            Ninguém em campo agora. Quando um técnico tocar em <strong>Estou a caminho</strong> no app, ele aparece aqui e
            no mapa.
          </p>
        )}
        {tecnicos.map((t) => {
          const { frescor, texto } = textoFrescor(t.posicao, agora);
          // Velocidade velha parece atual: sem sinal, não mostra.
          const km =
            frescor !== "sem_sinal" && t.posicao?.velocidade && t.posicao.modo === "deslocamento" && t.posicao.velocidade > 1
              ? Math.round(t.posicao.velocidade * 3.6)
              : null;
          const bateria = t.posicao?.bateria;
          return (
            <button
              key={t.ordemId}
              type="button"
              className={`campo-card${t.ordemId === selecionado ? " escolhido" : ""}`}
              onClick={() => escolher(t)}
            >
              <span className="linha-1">
                <strong>{t.tecnico?.nome ?? "Sem técnico"}</strong>
                <span className={`frescor f-${frescor}`}>{texto}</span>
              </span>
              <span className="linha-2">
                <span className={`pilula st-${t.status}`}>{STATUS[t.status] ?? t.status}</span>
                <span>
                  {numero(t.numero)} · {TIPO[t.tipo] ?? t.tipo}
                </span>
              </span>
              <span className="linha-3">{t.cliente.nome}</span>
              <span className="linha-4">
                {[t.cliente.cidade, t.cliente.uf].filter(Boolean).join(" - ") || "Sem cidade"}
                {t.distanciaDestinoM !== null && ` · a ${metros(t.distanciaDestinoM)} do cliente`}
                {km !== null && ` · ${km} km/h`}
                {bateria !== null && bateria !== undefined && (
                  <span className={bateria <= 15 ? "bateria-fraca" : ""}> · bateria {bateria}%</span>
                )}
              </span>
              <span className="linha-4 fraco">
                {t.status === "em_deslocamento" ? "Saiu" : "Chegou"} às {hora(t.desde)}
              </span>
            </button>
          );
        })}
      </div>

      <div className="campo-mapa">
        <div ref={elemento} className="mapa" />
        <div className="campo-ferramentas">
          <button type="button" className="botao secundario" onClick={verTodos} disabled={!comGps}>
            Ver todos
          </button>
          {escolhido?.posicao && (
            <a className="botao secundario" href={linkMaps(escolhido.posicao.latitude, escolhido.posicao.longitude)} target="_blank" rel="noopener">
              Abrir no Google Maps
            </a>
          )}
          {escolhido && (
            <a className="botao" href={`/os/${escolhido.ordemId}`}>
              Abrir a OS {numero(escolhido.numero)}
            </a>
          )}
        </div>
        {escolhido && trilha && (
          <div className="campo-legenda">
            {trilha.trechos.length ? (
              <>
                <span className="traco" /> trajeto {trilha.coladaNasRuas ? "pelas ruas" : "aproximado"}
              </>
            ) : (
              "sem trajeto gravado ainda"
            )}
            {trilha.destino && <> · ⌂ usina do cliente</>}
            {trilha.marcos.length > 0 && <> · ● onde saiu, chegou e concluiu</>}
          </div>
        )}
      </div>
    </div>
  );
}
