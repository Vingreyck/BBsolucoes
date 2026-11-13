"use client";

import { Check, Copy, ExternalLink, Send } from "lucide-react";
import { useActionState, useEffect, useRef, useState } from "react";

import { registrarEnvioEnergisa, type ResultadoEnvio } from "../actions";

/** Copia um dado do formulário da Energisa, para colar no portal. */
export function CopiarValor({ valor, rotulo }: { valor: string; rotulo: string }) {
  const [copiado, setCopiado] = useState(false);
  return (
    <button
      type="button"
      className="link-acao envio-energisa-copiar"
      aria-label={`Copiar ${rotulo}`}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(valor);
          setCopiado(true);
          setTimeout(() => setCopiado(false), 1500);
        } catch {
          // Sem permissão de área de transferência: o valor está na tela para selecionar.
        }
      }}
    >
      {copiado ? <Check size={13} aria-hidden /> : <Copy size={13} aria-hidden />}
      {copiado ? "copiado" : "copiar"}
    </button>
  );
}

type Aviso = { tom: "ok" | "erro" | "nota"; texto: string };

/**
 * Pede à extensão "Selebi — Energisa" que mostre, na aba do portal, o painel
 * com os dados e os documentos deste projeto, ao lado do formulário.
 *
 * A conversa é por `postMessage` com o script que a extensão (2.2 em diante)
 * põe nas páginas do Selebi: a página não sabe o id da extensão, e não precisa.
 */
export function AbrirNoPortal({ projetoId }: { projetoId: string }) {
  const [versao, setVersao] = useState<string | null>(null);
  const [aviso, setAviso] = useState<Aviso | null>(null);
  const [esperando, setEsperando] = useState(false);
  const pedido = useRef("");
  const prazo = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const ouvir = (e: MessageEvent) => {
      if (e.source !== window || e.origin !== window.location.origin) return;
      const d = e.data as { tipo?: string; versao?: unknown; pedido?: string; estado?: string; texto?: unknown } | null;
      if (d?.tipo === "selebi:energisa-pronta") setVersao(String(d.versao ?? "?"));
      if (d?.tipo === "selebi:energisa-resposta" && d.pedido === pedido.current) {
        if (prazo.current) clearTimeout(prazo.current);
        setEsperando(false);
        const texto = typeof d.texto === "string" ? d.texto : "A extensão respondeu sem detalhe.";
        setAviso({ tom: d.estado === "ok" ? "ok" : d.estado === "aguardando" ? "nota" : "erro", texto });
      }
    };
    window.addEventListener("message", ouvir);
    // O script da extensão pode ter carregado antes deste componente: pergunta.
    window.postMessage({ tipo: "selebi:energisa-ping" }, window.location.origin);
    return () => {
      window.removeEventListener("message", ouvir);
      if (prazo.current) clearTimeout(prazo.current);
    };
  }, []);

  const abrir = () => {
    if (!versao) {
      setAviso({
        tom: "erro",
        texto:
          "A extensão Selebi — Energisa (versão 2.2 ou mais nova) não está neste Chrome. Baixe a nova em Energisa → Extensão e recarregue esta página.",
      });
      return;
    }
    pedido.current = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setEsperando(true);
    setAviso(null);
    window.postMessage({ tipo: "selebi:preencher-energisa", projetoId, pedido: pedido.current }, window.location.origin);
    prazo.current = setTimeout(() => {
      setEsperando(false);
      setAviso({ tom: "erro", texto: "A extensão não respondeu. Recarregue esta página e tente de novo." });
    }, 20_000);
  };

  return (
    <div className="envio-energisa-portal">
      <button type="button" className="botao" onClick={abrir} disabled={esperando}>
        <ExternalLink size={15} aria-hidden /> {esperando ? "Abrindo o portal…" : "Abrir o painel no portal"}
      </button>
      {!versao && !aviso && (
        <small className="fraco">
          Precisa da extensão 2.2. <a href="/energisa/extensao">Baixar a extensão</a>
        </small>
      )}
      {aviso && (
        <p className={aviso.tom === "erro" ? "erro" : aviso.tom === "ok" ? "ok" : "nota"} role="status">
          {aviso.texto}
          {aviso.tom === "erro" && !versao && (
            <>
              {" "}
              <a href="/energisa/extensao">Baixar a extensão</a>
            </>
          )}
        </p>
      )}
    </div>
  );
}

/** "Já enviei": o número que o portal deu ao pedido leva o projeto para a Aprovação. */
export function JaEnviei({ projetoId, numero }: { projetoId: string; numero: string | null }) {
  const [estado, acao, enviando] = useActionState<ResultadoEnvio, FormData>(
    registrarEnvioEnergisa.bind(null, projetoId),
    {},
  );
  return (
    <form action={acao} className="envio-energisa-protocolo">
      <label className="entrada">
        <span className="entrada-rotulo">Número do projeto na Energisa</span>
        <input
          name="numero"
          required
          inputMode="numeric"
          autoComplete="off"
          placeholder="ex.: 1236226"
          defaultValue={numero ?? ""}
          maxLength={30}
        />
        <small className="entrada-ajuda">O “ID Geração” que o portal mostra depois de enviar.</small>
      </label>
      <button type="submit" className="botao" disabled={enviando}>
        <Send size={15} aria-hidden /> {enviando ? "Registrando…" : "Já enviei"}
      </button>
      {estado.erro && <p className="erro">{estado.erro}</p>}
      {estado.ok && <p className="ok">{estado.ok}</p>}
    </form>
  );
}
