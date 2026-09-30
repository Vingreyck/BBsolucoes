"use client";

import "leaflet/dist/leaflet.css";

import type * as Leaflet from "leaflet";
import { useEffect, useRef, useState } from "react";

import type { TrilhaDaOs } from "@/rastreamento/acompanhamento";
import type { EventoCampo } from "@/rastreamento/hub";

import { carregarLeaflet, criarMapa, desenharTrilha, iconeTecnico, linkMaps, textoFrescor, tomDa } from "../mapa-base";

/**
 * O trajeto desta OS: por onde o técnico passou, onde saiu, chegou e
 * concluiu — e, com a OS em campo, onde ele está agora.
 *
 * Ao vivo só para a gestão (o fluxo é dela); o técnico que abre a própria OS
 * no site vê o trajeto renovado a cada 30 s.
 */
export default function Trajeto({
  osId,
  status,
  tecnico,
  aoVivo,
}: {
  osId: string;
  status: string;
  tecnico: string | null;
  aoVivo: boolean;
}) {
  const elemento = useRef<HTMLDivElement>(null);
  const [trilha, setTrilha] = useState<TrilhaDaOs | null>(null);
  const [posicao, setPosicao] = useState<TrilhaDaOs["posicao"]>(null);
  const [agora, setAgora] = useState(() => Date.now());
  const refs = useRef<{ L?: Awaited<ReturnType<typeof carregarLeaflet>>; mapa?: Leaflet.Map; camada?: Leaflet.LayerGroup; pino?: Leaflet.Marker }>({});
  const emCampo = status === "em_deslocamento" || status === "em_andamento";

  useEffect(() => {
    let vivo = true;
    let primeira = true;
    const buscar = async () => {
      try {
        const r = await fetch(`/os/${osId}/trilha`, { cache: "no-store" });
        if (!r.ok || !vivo) return;
        const t = (await r.json()) as TrilhaDaOs;
        setTrilha(t);
        setPosicao((atual) => (atual && t.posicao && atual.capturadoEm > t.posicao.capturadoEm ? atual : t.posicao));
        const { L, mapa, camada } = refs.current;
        if (L && mapa && camada) {
          const pontos = desenharTrilha(L, camada, t);
          if (t.posicao) pontos.push([t.posicao.latitude, t.posicao.longitude]);
          if (primeira && pontos.length) mapa.fitBounds(L.latLngBounds(pontos), { padding: [28, 28], maxZoom: 17 });
          primeira = false;
        }
      } catch {
        // fica o último desenho
      }
    };
    carregarLeaflet().then((L) => {
      if (!vivo || !elemento.current || refs.current.mapa) return;
      const mapa = criarMapa(L, elemento.current);
      refs.current = { L, mapa, camada: L.layerGroup().addTo(mapa) };
      buscar();
    });
    const t = emCampo ? setInterval(buscar, 30_000) : undefined;
    const relogio = emCampo ? setInterval(() => setAgora(Date.now()), 5_000) : undefined;
    return () => {
      vivo = false;
      clearInterval(t);
      clearInterval(relogio);
      refs.current.mapa?.remove();
      refs.current = {};
    };
  }, [osId, emCampo]);

  // Ao vivo: a posição do técnico desta OS, empurrada pelo servidor.
  useEffect(() => {
    if (!aoVivo || !emCampo) return;
    const fonte = new EventSource("/os/acompanhamento/stream");
    fonte.addEventListener("posicao", (e) => {
      const ev = JSON.parse((e as MessageEvent<string>).data) as Extract<EventoCampo, { tipo: "posicao" }>;
      if (ev.ordemId !== osId) return;
      setPosicao({
        latitude: ev.latitude,
        longitude: ev.longitude,
        precisao: ev.precisao,
        velocidade: ev.velocidade,
        bateria: ev.bateria,
        modo: ev.modo,
        capturadoEm: ev.capturadoEm,
      });
      setAgora(Date.now());
    });
    return () => fonte.close();
  }, [aoVivo, emCampo, osId]);

  // O pino do técnico, só enquanto a OS está em campo.
  useEffect(() => {
    const { L, mapa } = refs.current;
    if (!L || !mapa) return;
    if (!emCampo || !posicao) {
      refs.current.pino?.remove();
      refs.current.pino = undefined;
      return;
    }
    const { frescor } = textoFrescor(posicao, agora);
    const icone = iconeTecnico(L, tecnico ?? "?", tomDa(status, posicao, agora), frescor === "ao_vivo");
    if (refs.current.pino) refs.current.pino.setLatLng([posicao.latitude, posicao.longitude]).setIcon(icone);
    else refs.current.pino = L.marker([posicao.latitude, posicao.longitude], { icon: icone }).addTo(mapa);
  }, [posicao, agora, emCampo, status, tecnico, trilha]);

  const vazio = trilha && !trilha.trechos.length && !trilha.marcos.length && !posicao;
  const frescor = emCampo && posicao ? textoFrescor(posicao, agora) : null;

  return (
    <div className="trajeto">
      <div ref={elemento} className="mapa mapa-pequeno" />
      <p className="trajeto-rodape">
        {vazio && "Sem trajeto: o celular não mandou posição nesta OS."}
        {!vazio && trilha && (
          <>
            {trilha.trechos.length ? `Trajeto ${trilha.coladaNasRuas ? "pelas ruas" : "aproximado"}` : "Sem trajeto gravado"}
            {frescor && <span className={`frescor f-${frescor.frescor}`}> · {frescor.texto}</span>}
            {posicao && emCampo && (
              <>
                {" · "}
                <a href={linkMaps(posicao.latitude, posicao.longitude)} target="_blank" rel="noopener">
                  abrir no Google Maps
                </a>
              </>
            )}
          </>
        )}
      </p>
    </div>
  );
}
