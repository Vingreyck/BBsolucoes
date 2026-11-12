"use client";

import { useEffect, useId, useState } from "react";

import { CHAVE_TEMA } from "../tema";

type Tema = "claro" | "escuro";

function guardado(): Tema | null {
  try {
    const v = localStorage.getItem(CHAVE_TEMA);
    return v === "claro" || v === "escuro" ? v : null;
  } catch {
    return null;
  }
}

/** O relógio que tira a classe de transição; um clique logo depois do outro o reinicia. */
let relogio: number | undefined;

const doSistema = (): Tema => (matchMedia("(prefers-color-scheme: dark)").matches ? "escuro" : "claro");

function aplicar(tema: Tema) {
  document.documentElement.dataset.tema = tema;
}

/**
 * O botão de tema: um interruptor claro/escuro cuja bolinha é o sol da marca.
 *
 * No tema claro ele é o símbolo do Selebi (sol dourado, três arcos cobre
 * girando); ao clicar, a bolinha rola para o outro lado, os arcos somem e o sol
 * vira lua. Quem desenha tudo é o CSS (`globals.css`, "Botão de tema"), a
 * partir do `data-tema` que o script do `<head>` já escreveu antes de pintar —
 * por isso a tela nunca abre com o botão no lado errado. O estado do React só
 * existe para o leitor de tela (`aria-checked`) e para gravar a escolha.
 */
export function BotaoTema() {
  const [tema, setTema] = useState<Tema>("claro");
  const id = useId().replace(/:/g, "");

  useEffect(() => {
    const sincronizar = () => {
      const t = guardado() ?? doSistema();
      aplicar(t);
      setTema(t);
    };
    sincronizar();
    // Sem escolha guardada, acompanha o sistema; e a escolha feita em outra aba vale aqui também.
    const sistema = matchMedia("(prefers-color-scheme: dark)");
    const outraAba = (e: StorageEvent) => {
      if (e.key === CHAVE_TEMA) sincronizar();
    };
    sistema.addEventListener("change", sincronizar);
    window.addEventListener("storage", outraAba);
    return () => {
      sistema.removeEventListener("change", sincronizar);
      window.removeEventListener("storage", outraAba);
    };
  }, []);

  function alternar() {
    const novo: Tema = tema === "escuro" ? "claro" : "escuro";
    // Por 0,8 s as cores mudam suavemente e a bolinha rola; fora desse intervalo nada ganha
    // transição, para a tela nunca animar o tema que já abriu escrito.
    const raiz = document.documentElement;
    raiz.classList.add("trocando-tema");
    window.clearTimeout(relogio);
    relogio = window.setTimeout(() => raiz.classList.remove("trocando-tema"), 800);
    aplicar(novo);
    setTema(novo);
    try {
      localStorage.setItem(CHAVE_TEMA, novo);
    } catch {
      // navegador sem armazenamento: o tema vale até fechar a página.
    }
  }

  const escuro = tema === "escuro";
  // O mesmo arco da marca (app/_ui/marca.tsx), com o raio e o traço ajustados a uma bolinha de 28 px.
  const arco = "M50 17 A33 33 0 0 0 18.99 38.71";

  return (
    <button
      type="button"
      className="tema-botao"
      role="switch"
      aria-checked={escuro}
      aria-label="Tema escuro"
      title={escuro ? "Tema escuro. Clique para o claro" : "Tema claro. Clique para o escuro"}
      onClick={alternar}
    >
      <span className="tema-trilho" aria-hidden>
        <svg className="tema-estrelas" viewBox="0 0 56 28" focusable="false">
          <circle cx="9" cy="9" r="1.2" />
          <circle cx="15" cy="19" r="0.9" />
          <circle cx="21" cy="8" r="0.8" />
          <circle cx="27" cy="16" r="1.1" />
        </svg>
        <span className="tema-bolinha">
          <svg viewBox="0 0 100 100" focusable="false">
            <defs>
              <mask id={`tema-lua-${id}`}>
                <rect width="100" height="100" fill="#fff" />
                <circle className="tema-recorte" cx="50" cy="50" r="19" fill="#000" />
              </mask>
            </defs>
            <g className="tema-arcos">
              <g className="tema-gira" fill="none" stroke="#C9561A" strokeWidth="8" strokeLinecap="round">
                <path d={arco} />
                <path d={arco} transform="rotate(120 50 50)" />
                <path d={arco} transform="rotate(240 50 50)" />
              </g>
            </g>
            <circle className="tema-disco" cx="50" cy="50" r="21" mask={`url(#tema-lua-${id})`} />
          </svg>
        </span>
      </span>
    </button>
  );
}
