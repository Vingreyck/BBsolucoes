"use client";

import { Check, ChevronDown, Globe, Search, Smartphone, UserRound, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

export interface PessoaParaEscolher {
  id: string;
  nome: string;
  papel: string;
  /** Já entrou no app (sessão do app aberta ou celular cadastrado para aviso). */
  usaApp: boolean;
  /** Está com o site aberto no navegador. */
  usaSite?: boolean;
}

type Filtro = "todos" | "app" | "site" | "nenhum";

const PAPEL: Record<string, string> = { tecnico: "Técnico", vendedor: "Vendedor", engenheiro: "Engenheiro", adm: "Administrador" };

function iniciais(nome: string): string {
  const p = nome.trim().split(/\s+/);
  return ((p[0]?.[0] ?? "") + (p.length > 1 ? p[p.length - 1][0] : "")).toUpperCase();
}

/** Minúsculo e sem acento: "jose" acha "José". */
const sem = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/**
 * Escolher quem vai (ou quem atende, quem instala): uma lista com busca,
 * filtro de onde a pessoa usa o Selebi (app, site, nenhum dos dois ainda) e,
 * em cada linha, as iniciais, o papel e os selos "app" e "site".
 *
 * No lugar do `<select>`, que mostrava "Fulano (técnico) · ainda não entrou no
 * app" numa linha só e crescia até sair da tela. O valor vai num campo `name`
 * igual ao de antes: as ações do servidor não mudam.
 *
 * A lista abre dentro do formulário (e não por cima), para funcionar igual
 * dentro das janelinhas, que cortam o que passa da borda.
 */
export function EscolherPessoa({
  name,
  pessoas,
  inicial = "",
  vazio = "Ninguém",
  obrigatorio = false,
  rotulo = "Escolher quem vai",
}: {
  name: string;
  pessoas: PessoaParaEscolher[];
  inicial?: string;
  /** O texto de "ninguém escolhido" ("Definir depois", "Ninguém ainda"). */
  vazio?: string;
  /** Obrigatório: some a opção de ninguém e o formulário não envia sem escolha. */
  obrigatorio?: boolean;
  rotulo?: string;
}) {
  const [valor, setValor] = useState(inicial);
  const [aberto, setAberto] = useState(false);
  const [busca, setBusca] = useState("");
  const [filtro, setFiltro] = useState<Filtro>("todos");
  const [ativo, setAtivo] = useState(0);
  const caixa = useRef<HTMLDivElement>(null);

  const escolhida = pessoas.find((p) => p.id === valor) ?? null;

  const contagem = useMemo(
    () => ({
      todos: pessoas.length,
      app: pessoas.filter((p) => p.usaApp).length,
      site: pessoas.filter((p) => p.usaSite).length,
      nenhum: pessoas.filter((p) => !p.usaApp && !p.usaSite).length,
    }),
    [pessoas],
  );

  const lista = useMemo(() => {
    const alvo = sem(busca.trim());
    return pessoas.filter((p) => {
      if (filtro === "app" && !p.usaApp) return false;
      if (filtro === "site" && !p.usaSite) return false;
      if (filtro === "nenhum" && (p.usaApp || p.usaSite)) return false;
      return !alvo || sem(`${p.nome} ${PAPEL[p.papel] ?? p.papel}`).includes(alvo);
    });
  }, [pessoas, busca, filtro]);

  // Fecha ao clicar fora ou apertar Esc.
  useEffect(() => {
    if (!aberto) return;
    const fora = (e: MouseEvent) => {
      if (caixa.current && !caixa.current.contains(e.target as Node)) setAberto(false);
    };
    // Esc fecha só a lista: dentro de uma janelinha, sem isto fechava a janela junto.
    const tecla = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      setAberto(false);
    };
    document.addEventListener("mousedown", fora);
    document.addEventListener("keydown", tecla);
    return () => {
      document.removeEventListener("mousedown", fora);
      document.removeEventListener("keydown", tecla);
    };
  }, [aberto]);

  function escolher(id: string) {
    setValor(id);
    setAberto(false);
    setBusca("");
  }

  const filtros: [Filtro, string, number][] = [
    ["todos", "Todos", contagem.todos],
    ["app", "No app", contagem.app],
    ["site", "No site", contagem.site],
    ["nenhum", "Ainda não entraram", contagem.nenhum],
  ];

  return (
    <div className="pessoa-escolha" ref={caixa}>
      {/* O valor que o formulário envia. Visível ao navegador (para o "obrigatório"), não à pessoa. */}
      <input
        className="pessoa-escolha-valor"
        name={name}
        value={valor}
        onChange={() => undefined}
        required={obrigatorio}
        tabIndex={-1}
        aria-hidden
        onInvalid={() => setAberto(true)}
      />

      <button
        type="button"
        className={`pessoa-escolha-gatilho${aberto ? " aberto" : ""}`}
        aria-expanded={aberto}
        aria-label={rotulo}
        onClick={() => setAberto((a) => !a)}
      >
        {escolhida ? (
          <>
            <span className="pessoa-avatar" aria-hidden>
              {iniciais(escolhida.nome)}
            </span>
            <span className="pessoa-nome">
              <strong>{escolhida.nome}</strong>
              <small>
                {PAPEL[escolhida.papel] ?? escolhida.papel}
                {escolhida.usaApp ? " · usa o app" : " · ainda não entrou no app"}
              </small>
            </span>
          </>
        ) : (
          <>
            <span className="pessoa-avatar sem-pessoa" aria-hidden>
              <UserRound size={15} />
            </span>
            <span className="pessoa-nome">
              <span className="fraco">{obrigatorio ? "Escolha quem vai…" : vazio}</span>
            </span>
          </>
        )}
        <ChevronDown size={16} aria-hidden className="pessoa-seta" />
      </button>

      {aberto && (
        <div className="pessoa-escolha-painel">
          <label className="pessoa-busca">
            <Search size={15} aria-hidden />
            <input
              type="search"
              autoFocus
              value={busca}
              placeholder="Buscar pelo nome ou papel"
              aria-label="Buscar pessoa"
              onChange={(e) => {
                setBusca(e.target.value);
                setAtivo(0);
              }}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setAtivo((a) => Math.min(a + 1, lista.length - 1));
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setAtivo((a) => Math.max(a - 1, 0));
                } else if (e.key === "Enter") {
                  e.preventDefault();
                  if (lista[ativo]) escolher(lista[ativo].id);
                }
              }}
            />
          </label>

          <div className="pessoa-filtros" role="group" aria-label="Onde a pessoa usa o Selebi">
            {filtros.map(([f, texto, n]) => (
              <button
                key={f}
                type="button"
                className={`filtro${filtro === f ? " ativo" : ""}`}
                aria-pressed={filtro === f}
                onClick={() => {
                  setFiltro(f);
                  setAtivo(0);
                }}
              >
                {texto} <span className="filtro-n">{n}</span>
              </button>
            ))}
          </div>

          <ul className="pessoa-lista" role="listbox" aria-label={rotulo}>
            {!obrigatorio && (
              <li role="option" aria-selected={valor === ""} className="pessoa-linha pessoa-ninguem" onClick={() => escolher("")}>
                <span className="pessoa-avatar sem-pessoa" aria-hidden>
                  <X size={14} />
                </span>
                <span className="pessoa-nome">
                  <strong>{vazio}</strong>
                </span>
                {valor === "" && <Check size={16} aria-hidden className="pessoa-marca" />}
              </li>
            )}
            {lista.map((p, i) => (
              <li
                key={p.id}
                role="option"
                aria-selected={p.id === valor}
                className={`pessoa-linha${i === ativo ? " ativa" : ""}`}
                onMouseEnter={() => setAtivo(i)}
                onClick={() => escolher(p.id)}
              >
                <span className="pessoa-avatar" aria-hidden>
                  {iniciais(p.nome)}
                </span>
                <span className="pessoa-nome pessoa-nome-lista">
                  <strong>{p.nome}</strong>
                  <span className="pessoa-info">
                    <small>{PAPEL[p.papel] ?? p.papel}</small>
                    {p.usaApp && (
                      <span className="pessoa-selo app" title="Já entrou no app">
                        <Smartphone size={12} aria-hidden /> app
                      </span>
                    )}
                    {p.usaSite && (
                      <span className="pessoa-selo site" title="Está com o site aberto">
                        <Globe size={12} aria-hidden /> site
                      </span>
                    )}
                    {!p.usaApp && <span className="pessoa-selo falta">ainda não entrou no app</span>}
                  </span>
                </span>
                {p.id === valor && <Check size={16} aria-hidden className="pessoa-marca" />}
              </li>
            ))}
            {lista.length === 0 && <li className="pessoa-vazia">Ninguém com esse filtro.</li>}
          </ul>
          <p className="pessoa-nota">Quem ainda não entrou no app recebe a OS assim que entrar.</p>
        </div>
      )}
    </div>
  );
}
