"use client";

import { MoreHorizontal } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { Dialogo } from "../../_ui/dialogo";

export { BotaoDialogo } from "../../_ui/dialogo";

/**
 * As ações da OS que não são o próximo passo.
 *
 * A tela da OS tinha nove "sanfonas" abertas e fechadas uma embaixo da outra
 * (concluir, pausar, cancelar, agendar…). Agora o próximo passo fica à vista,
 * no cartão "Agora", e o resto mora aqui: o que é secundário ou perigoso fica
 * num menu "Mais", e cada um abre o próprio formulário numa janelinha. É a
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
