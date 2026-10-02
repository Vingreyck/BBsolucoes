"use client";

import {
  BellRing,
  CalendarDays,
  ClipboardList,
  FolderOpen,
  House,
  KanbanSquare,
  ListChecks,
  LogOut,
  MapPinned,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  RefreshCw,
  Sun,
  SunMedium,
  Unlink,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { sair } from "./login/actions";
import { CHAVE_MENU } from "./menu";

/**
 * O menu do sistema, à esquerda, como nos hubs (Linear, Jobber, HubSpot).
 *
 * Quem decide o que aparece é o layout, no servidor, com as mesmas regras de
 * antes: esconder o link é cortesia, quem barra é a própria página. Aqui só se
 * desenha e se marca onde a pessoa está.
 */

export type IconeMenu =
  | "inicio"
  | "esteira"
  | "documentos"
  | "os"
  | "agenda"
  | "campo"
  | "usinas"
  | "alertas"
  | "semDono"
  | "coleta"
  | "novaUsina"
  | "usuarios"
  | "modelos";

const ICONES: Record<IconeMenu, LucideIcon> = {
  inicio: House,
  esteira: KanbanSquare,
  documentos: FolderOpen,
  os: ClipboardList,
  agenda: CalendarDays,
  campo: MapPinned,
  usinas: Sun,
  alertas: BellRing,
  semDono: Unlink,
  coleta: RefreshCw,
  novaUsina: Plus,
  usuarios: Users,
  modelos: ListChecks,
};

export interface ItemMenu {
  href: string;
  rotulo: string;
  icone: IconeMenu;
  /** Número no canto do item, como os alertas abertos. Zero não aparece. */
  contador?: number;
}

export interface GrupoMenu {
  titulo?: string;
  itens: ItemMenu[];
}

/**
 * O item ativo é o de prefixo mais longo: em `/os/agenda`, quem acende é
 * Agenda, não Ordens de serviço.
 */
function hrefAtivo(caminho: string, grupos: GrupoMenu[]): string | null {
  let melhor: string | null = null;
  for (const g of grupos) {
    for (const i of g.itens) {
      const casa = i.href === "/" ? caminho === "/" : caminho === i.href || caminho.startsWith(`${i.href}/`);
      if (casa && (!melhor || i.href.length > melhor.length)) melhor = i.href;
    }
  }
  return melhor;
}

function iniciais(nome: string): string {
  const partes = nome.trim().split(/\s+/);
  return ((partes[0]?.[0] ?? "") + (partes.length > 1 ? partes[partes.length - 1][0] : "")).toUpperCase();
}

export function BarraLateral({
  grupos,
  usuario,
  acaoPrincipal,
}: {
  grupos: GrupoMenu[];
  usuario: { nome: string; papel: string };
  acaoPrincipal?: { href: string; rotulo: string };
}) {
  const caminho = usePathname();
  const ativo = hrefAtivo(caminho, grupos);
  const [aberto, setAberto] = useState(false);
  const [recolhido, setRecolhido] = useState(false);

  // O script no <head> já aplicou a preferência antes de pintar; aqui o React
  // só fica sabendo dela, para o botão mostrar o ícone certo.
  useEffect(() => setRecolhido(document.documentElement.dataset.menu === "recolhido"), []);

  function alternarRecolhido() {
    const novo = !recolhido;
    setRecolhido(novo);
    if (novo) document.documentElement.dataset.menu = "recolhido";
    else delete document.documentElement.dataset.menu;
    try {
      localStorage.setItem(CHAVE_MENU, novo ? "recolhido" : "aberto");
    } catch {
      // navegador sem armazenamento (aba anônima restrita): só não lembra.
    }
  }

  // No celular o menu é uma gaveta: fecha sozinho ao trocar de página.
  useEffect(() => setAberto(false), [caminho]);

  return (
    <>
      <header className="barra-movel">
        <button
          type="button"
          className="barra-movel-botao"
          aria-label="Abrir menu"
          aria-expanded={aberto}
          onClick={() => setAberto(true)}
        >
          <Menu size={20} />
        </button>
        <span className="marca-sistema">
          <SunMedium size={18} aria-hidden /> Selebi
        </span>
      </header>

      {aberto && <div className="lateral-fundo" onClick={() => setAberto(false)} aria-hidden />}

      <aside className={`lateral${aberto ? " aberta" : ""}`} aria-label="Menu principal">
        <div className="lateral-topo">
          <a href="/" className="marca-sistema">
            <span className="marca-selo" aria-hidden>
              <SunMedium size={16} />
            </span>
            Selebi
          </a>
          <button
            type="button"
            className="lateral-fechar"
            aria-label="Fechar menu"
            onClick={() => setAberto(false)}
          >
            <X size={18} />
          </button>
        </div>

        {acaoPrincipal && (
          <a href={acaoPrincipal.href} className="lateral-acao">
            <Plus size={16} aria-hidden /> {acaoPrincipal.rotulo}
          </a>
        )}

        <nav className="lateral-nav">
          {grupos.map((g, n) => (
            <div className="lateral-grupo" key={g.titulo ?? n}>
              {g.titulo && <div className="lateral-titulo">{g.titulo}</div>}
              {g.itens.map((i) => {
                const Icone = ICONES[i.icone];
                const atual = i.href === ativo;
                return (
                  <a
                    key={i.href}
                    href={i.href}
                    className={`lateral-item${atual ? " ativo" : ""}`}
                    aria-current={atual ? "page" : undefined}
                    title={i.rotulo}
                  >
                    <Icone size={17} aria-hidden />
                    <span>{i.rotulo}</span>
                    {!!i.contador && <span className="lateral-contador">{i.contador}</span>}
                  </a>
                );
              })}
            </div>
          ))}
        </nav>

        <button
          type="button"
          className="lateral-recolher"
          onClick={alternarRecolhido}
          aria-label={recolhido ? "Abrir o menu" : "Recolher o menu"}
          title={recolhido ? "Abrir o menu" : "Recolher o menu"}
        >
          {recolhido ? <PanelLeftOpen size={17} aria-hidden /> : <PanelLeftClose size={17} aria-hidden />}
          <span>Recolher menu</span>
        </button>

        <div className="lateral-rodape">
          <span className="avatar" aria-hidden>
            {iniciais(usuario.nome)}
          </span>
          <span className="lateral-quem">
            <strong>{usuario.nome}</strong>
            <small>{usuario.papel}</small>
          </span>
          <form action={sair}>
            <button type="submit" className="lateral-sair" title="Sair" aria-label="Sair">
              <LogOut size={17} />
            </button>
          </form>
        </div>
      </aside>
    </>
  );
}
