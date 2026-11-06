"use client";

import { Bookmark, Copy } from "lucide-react";
import { useEffect, useRef, useState } from "react";

/**
 * O botão para arrastar até a barra de favoritos. O React recusa `javascript:`
 * no `href` (com razão, num link comum); aqui o código é nosso e fixo, então
 * entra direto no elemento depois de montado.
 */
export function Favorito({ codigo }: { codigo: string }) {
  const ref = useRef<HTMLAnchorElement>(null);
  const [copiado, setCopiado] = useState(false);

  useEffect(() => {
    ref.current?.setAttribute("href", codigo);
  }, [codigo]);

  return (
    <div className="botoes-linha">
      <a
        ref={ref}
        className="botao"
        draggable
        title="Arraste para a barra de favoritos"
        onClick={(e) => {
          e.preventDefault();
          alert('Arraste este botão até a barra de favoritos do navegador. Depois, clique nele com o portal da Energisa aberto.');
        }}
      >
        <Bookmark size={15} aria-hidden /> Enviar ao Selebi
      </a>
      <button
        type="button"
        className="botao secundario"
        onClick={async () => {
          await navigator.clipboard.writeText(codigo);
          setCopiado(true);
        }}
      >
        <Copy size={15} aria-hidden /> {copiado ? "Código copiado" : "Copiar o código do favorito"}
      </button>
    </div>
  );
}
