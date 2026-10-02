"use client";

import { ChevronDown, ClipboardList, KanbanSquare, Plus, Search, Sun } from "lucide-react";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

/**
 * A barra de cima do conteúdo: busca em tudo e o botão "Novo".
 *
 * A busca é a porta de entrada dos grandes sistemas (Stripe, Linear, GitHub):
 * em vez de lembrar em que tela mora cada coisa, digita-se o nome do cliente,
 * o número da OS ou a cidade. Ctrl+K (ou /) leva o cursor para ela de qualquer
 * tela. Sem JavaScript, continua sendo um formulário comum que abre /busca.
 */
export function BarraSuperior({
  podeCriarOs,
  podeCriarProjeto,
}: {
  podeCriarOs: boolean;
  podeCriarProjeto: boolean;
}) {
  const campo = useRef<HTMLInputElement>(null);
  const menu = useRef<HTMLDetailsElement>(null);
  const caminho = usePathname();

  useEffect(() => {
    function atalho(e: KeyboardEvent) {
      const alvo = e.target as HTMLElement | null;
      const digitando = alvo && (alvo.tagName === "INPUT" || alvo.tagName === "TEXTAREA" || alvo.tagName === "SELECT" || alvo.isContentEditable);
      if ((e.key === "k" && (e.ctrlKey || e.metaKey)) || (e.key === "/" && !digitando)) {
        e.preventDefault();
        campo.current?.focus();
        campo.current?.select();
      }
      if (e.key === "Escape") menu.current?.removeAttribute("open");
    }
    window.addEventListener("keydown", atalho);
    return () => window.removeEventListener("keydown", atalho);
  }, []);

  // Fecha o menu "Novo" ao trocar de página ou clicar fora dele. Na tela de
  // resultados, o campo mostra o que foi buscado, para refinar sem redigitar.
  useEffect(() => {
    menu.current?.removeAttribute("open");
    if (campo.current) {
      campo.current.value = caminho === "/busca" ? (new URLSearchParams(window.location.search).get("q") ?? "") : "";
    }
  }, [caminho]);
  useEffect(() => {
    function fora(e: MouseEvent) {
      if (menu.current && !menu.current.contains(e.target as Node)) menu.current.removeAttribute("open");
    }
    document.addEventListener("click", fora);
    return () => document.removeEventListener("click", fora);
  }, []);

  return (
    <div className="barra-superior">
      <form action="/busca" className="busca-global" role="search">
        <Search size={16} aria-hidden />
        <input
          ref={campo}
          type="search"
          name="q"
          placeholder="Buscar cliente, OS, usina, cidade ou CPF…"
          aria-label="Buscar no sistema"
          autoComplete="off"
        />
        <kbd aria-hidden>Ctrl K</kbd>
      </form>

      {(podeCriarOs || podeCriarProjeto) && (
        <details className="menu-novo" ref={menu}>
          <summary className="botao">
            <Plus size={16} aria-hidden /> Novo <ChevronDown size={14} aria-hidden />
          </summary>
          <div className="menu-novo-lista" role="menu">
            {podeCriarOs && (
              <a href="/os/nova" role="menuitem">
                <ClipboardList size={16} aria-hidden />
                <span>
                  <strong>Ordem de serviço</strong>
                  <small>Vistoria, instalação, manutenção</small>
                </span>
              </a>
            )}
            {podeCriarProjeto && (
              <a href="/projeto/novo" role="menuitem">
                <KanbanSquare size={16} aria-hidden />
                <span>
                  <strong>Projeto</strong>
                  <small>Uma venda nova na esteira</small>
                </span>
              </a>
            )}
            <a href="/cadastro" role="menuitem">
              <Sun size={16} aria-hidden />
              <span>
                <strong>Usina</strong>
                <small>Cadastro em cinco passos</small>
              </span>
            </a>
          </div>
        </details>
      )}
    </div>
  );
}
