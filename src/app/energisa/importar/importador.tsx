"use client";

import { CheckCircle2, CircleAlert, LoaderCircle } from "lucide-react";
import { useEffect, useState } from "react";

import { ORIGEM_ENERGISA } from "@/energisa/favorito";

import { importarDoPortal, type ResultadoImportacao } from "../actions";

type Estado =
  | { tipo: "esperando" }
  | { tipo: "enviando"; total: number }
  | { tipo: "feito"; resultado: ResultadoImportacao }
  | { tipo: "sem-portal" };

/**
 * Conversa com a aba do portal que abriu esta janela: avisa que está pronta,
 * recebe a lista (só da origem da Energisa) e manda para o servidor.
 */
export function Importador() {
  const [estado, setEstado] = useState<Estado>({ tipo: "esperando" });

  useEffect(() => {
    let recebeu = false;
    const ouvir = async (e: MessageEvent) => {
      if (e.origin !== ORIGEM_ENERGISA || recebeu) return;
      const d = e.data as { tipo?: string; lista?: unknown } | null;
      if (!d || d.tipo !== "energisa" || !Array.isArray(d.lista)) return;
      recebeu = true;
      setEstado({ tipo: "enviando", total: d.lista.length });
      try {
        setEstado({ tipo: "feito", resultado: await importarDoPortal(d.lista) });
      } catch {
        setEstado({ tipo: "feito", resultado: { ok: false, erro: "O Selebi não conseguiu gravar. Tente de novo." } });
      }
    };
    window.addEventListener("message", ouvir);
    if (window.opener) window.opener.postMessage("selebi-pronto", ORIGEM_ENERGISA);
    const espera = setTimeout(() => {
      if (!recebeu) setEstado({ tipo: "sem-portal" });
    }, 10_000);
    return () => {
      window.removeEventListener("message", ouvir);
      clearTimeout(espera);
    };
  }, []);

  if (estado.tipo === "esperando") {
    return (
      <p className="aviso">
        <LoaderCircle size={15} aria-hidden /> Recebendo a lista do portal da Energisa…
      </p>
    );
  }
  if (estado.tipo === "enviando") {
    return (
      <p className="aviso">
        <LoaderCircle size={15} aria-hidden /> Atualizando a esteira com {estado.total} projetos…
      </p>
    );
  }
  if (estado.tipo === "sem-portal") {
    return (
      <p className="aviso">
        <CircleAlert size={15} aria-hidden /> Nada chegou. Esta janela abre sozinha quando alguém clica no favorito
        &quot;Enviar ao Selebi&quot; com o portal da Energisa aberto — veja como em <a href="/energisa">Energisa</a>.
      </p>
    );
  }
  const r = estado.resultado;
  return r.ok ? (
    <div className="pilha">
      <p>
        <CheckCircle2 size={15} aria-hidden /> <strong>Pronto.</strong> {r.texto}.
      </p>
      <div className="botoes-linha">
        <a href="/esteira" className="botao">
          Ver a esteira
        </a>
        <a href="/energisa" className="botao secundario">
          Ver a lista da Energisa
        </a>
      </div>
    </div>
  ) : (
    <p className="aviso">
      <CircleAlert size={15} aria-hidden /> {r.erro}
    </p>
  );
}
