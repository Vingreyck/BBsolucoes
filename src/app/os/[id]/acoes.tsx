"use client";

import { MoreHorizontal, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * As ações da OS que abrem numa janelinha.
 *
 * A tela da OS tinha nove "sanfonas" abertas e fechadas uma embaixo da outra
 * (concluir, pausar, cancelar, agendar…). Agora o próximo passo fica à vista,
 * no cartão "Agora", e o resto mora aqui: o que é secundário ou perigoso fica
 * num menu "Mais", e cada um abre o próprio formulário por cima da tela. É a
 * divulgação progressiva: tudo a um clique, nada no caminho.
 *
 * Os formulários continuam sendo do servidor: chegam prontos como `conteudo`.
 * Depois de enviar, a página volta com a mensagem e este componente nasce de
 * novo (a página troca a `key`), então a janelinha fecha sozinha.
 */

export interface AcaoDoMenu {
  id: string;
  rotulo: string;
  icone?: ReactNode;
  perigo?: boolean;
  titulo: string;
  descricao?: ReactNode;
  conteudo: ReactNode;
}

function Dialogo({
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

/** "Mais": a lista curta do que não é o próximo passo. */
export function MenuAcoes({ acoes }: { acoes: AcaoDoMenu[] }) {
  const [aberto, setAberto] = useState(false);
  const [escolhida, setEscolhida] = useState<AcaoDoMenu | null>(null);
  const caixa = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!aberto) return;
    const fora = (e: MouseEvent) => {
      if (caixa.current && !caixa.current.contains(e.target as Node)) setAberto(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setAberto(false);
    document.addEventListener("click", fora);
    window.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("click", fora);
      window.removeEventListener("keydown", esc);
    };
  }, [aberto]);

  if (acoes.length === 0) return null;

  return (
    <div className="menu-acoes" ref={caixa}>
      <button
        type="button"
        className="botao secundario"
        aria-haspopup="menu"
        aria-expanded={aberto}
        onClick={() => setAberto((v) => !v)}
      >
        <MoreHorizontal size={16} aria-hidden /> Mais
      </button>
      {aberto && (
        <div className="menu-acoes-lista" role="menu">
          {acoes.map((a) => (
            <button
              key={a.id}
              type="button"
              role="menuitem"
              className={a.perigo ? "perigo" : undefined}
              onClick={() => {
                setEscolhida(a);
                setAberto(false);
              }}
            >
              {a.icone}
              <span>{a.rotulo}</span>
            </button>
          ))}
        </div>
      )}
      {escolhida && (
        <Dialogo titulo={escolhida.titulo} descricao={escolhida.descricao} icone={escolhida.icone} fechar={() => setEscolhida(null)}>
          {escolhida.conteudo}
        </Dialogo>
      )}
    </div>
  );
}
