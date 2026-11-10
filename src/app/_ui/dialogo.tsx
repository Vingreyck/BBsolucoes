"use client";

import { X } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

/**
 * A janelinha (diálogo) do sistema: um formulário por cima da tela, que fecha
 * com Esc, com o X ou clicando fora.
 *
 * O formulário dentro dela é do servidor e chega pronto como `children`.
 * Depois de enviar, a página volta com a mensagem; quem usa a janelinha troca
 * a `key` dela com a resposta, e ela nasce fechada.
 */
export function Dialogo({
  titulo,
  descricao,
  icone,
  fechar,
  children,
}: {
  titulo: string;
  descricao?: ReactNode;
  icone?: ReactNode;
  fechar: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => e.key === "Escape" && fechar();
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, [fechar]);

  return (
    <div className="dialogo-fundo" onClick={fechar}>
      <div className="dialogo dialogo-largo" role="dialog" aria-modal="true" aria-label={titulo} onClick={(e) => e.stopPropagation()}>
        <header className="dialogo-topo">
          {icone && (
            <span className="dialogo-icone" aria-hidden>
              {icone}
            </span>
          )}
          <div>
            <h2>{titulo}</h2>
            {descricao && <p className="dialogo-sub">{descricao}</p>}
          </div>
          <button type="button" className="botao-icone" onClick={fechar} aria-label="Fechar">
            <X size={16} aria-hidden />
          </button>
        </header>
        <div className="dialogo-corpo">{children}</div>
      </div>
    </div>
  );
}

/** Um botão que abre um formulário na janelinha. */
export function BotaoDialogo({
  rotulo,
  icone,
  classe = "botao secundario",
  titulo,
  descricao,
  children,
}: {
  rotulo: ReactNode;
  icone?: ReactNode;
  classe?: string;
  titulo: string;
  descricao?: ReactNode;
  children: ReactNode;
}) {
  const [aberto, setAberto] = useState(false);
  return (
    <>
      <button type="button" className={classe} onClick={() => setAberto(true)}>
        {icone}
        {rotulo}
      </button>
      {aberto && (
        <Dialogo titulo={titulo} descricao={descricao} icone={icone} fechar={() => setAberto(false)}>
          {children}
        </Dialogo>
      )}
    </>
  );
}
