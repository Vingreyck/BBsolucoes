"use client";

import { ChevronLeft, ChevronRight, Search, X } from "lucide-react";
import {
  Children,
  createContext,
  isValidElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";

import { semAcento } from "../formatar";

/**
 * O quadro da esteira, com o filtro que a tela pedia: 122 projetos em 13
 * colunas não se leem de olho.
 *
 * Os cartões continuam sendo desenhados no servidor. Cada um traz no próprio
 * `data-*` o que o filtro precisa (texto de busca, nível de atraso, dono), e
 * a coluna só escolhe quais mostrar. A coluna também abre em 8 cartões e
 * mostra mais a pedido: é a paginação do quadro. Página com número seria
 * estranha numa coluna, e "mostrar mais" deixa a coluna curta sem esconder o
 * total, que está no cabeçalho.
 *
 * Andar de lado, que em 13 colunas é o tempo todo, tem quatro caminhos:
 * - o mapa das etapas no topo, que leva direto à coluna e acende as que estão
 *   à vista;
 * - as setas nas bordas, que só aparecem quando há para onde ir;
 * - arrastar o fundo do quadro com o mouse, como no Trello;
 * - a barra de rolagem, que fica sempre no pé da tela porque o quadro tem a
 *   altura da janela.
 */

const INICIAIS = 8;
const A_MAIS = 10;

interface Filtro {
  termo: string;
  soParados: boolean;
  soMeus: boolean;
  meuId: string;
}

const Contexto = createContext<Filtro>({ termo: "", soParados: false, soMeus: false, meuId: "" });

type Cartao = ReactElement<Record<string, unknown>>;

function passa(c: Cartao, f: Filtro): boolean {
  if (f.termo && !String(c.props["data-busca"] ?? "").includes(f.termo)) return false;
  if (f.soParados && c.props["data-nivel"] === "normal") return false;
  if (f.soMeus && c.props["data-dono"] !== f.meuId) return false;
  return true;
}

export interface EtapaDoMapa {
  id: string;
  ordem: string;
  nome: string;
  n: number;
}

export function QuadroEsteira({
  children,
  etapas,
  meuId,
  total,
  parados,
  meus,
}: {
  children: ReactNode;
  etapas: EtapaDoMapa[];
  meuId: string;
  total: number;
  parados: number;
  meus: number;
}) {
  const [termo, setTermo] = useState("");
  const [soParados, setSoParados] = useState(false);
  const [soMeus, setSoMeus] = useState(false);
  const filtro = useMemo(
    () => ({ termo: semAcento(termo.trim()), soParados, soMeus, meuId }),
    [termo, soParados, soMeus, meuId],
  );

  const quadro = useRef<HTMLDivElement>(null);
  const [lados, setLados] = useState({ esq: false, dir: false });
  const [visiveis, setVisiveis] = useState<Set<string>>(new Set());

  const medir = useCallback(() => {
    const q = quadro.current;
    if (!q) return;
    setLados({ esq: q.scrollLeft > 4, dir: q.scrollLeft + q.clientWidth < q.scrollWidth - 4 });
  }, []);

  // Quais colunas estão à vista: o mapa acende essas.
  useEffect(() => {
    const q = quadro.current;
    if (!q) return;
    medir();
    const vistas = new Set<string>();
    const observador = new IntersectionObserver(
      (entradas) => {
        for (const e of entradas) {
          const id = (e.target as HTMLElement).dataset.etapa;
          if (!id) continue;
          if (e.isIntersecting) vistas.add(id);
          else vistas.delete(id);
        }
        setVisiveis(new Set(vistas));
      },
      { root: q, threshold: 0.6 },
    );
    q.querySelectorAll<HTMLElement>("[data-etapa]").forEach((c) => observador.observe(c));
    const aoRedimensionar = () => medir();
    window.addEventListener("resize", aoRedimensionar);
    return () => {
      observador.disconnect();
      window.removeEventListener("resize", aoRedimensionar);
    };
  }, [medir]);

  // Filtrar muda a largura das colunas (as vazias encolhem): mede de novo.
  useEffect(() => {
    const t = setTimeout(medir, 250);
    return () => clearTimeout(t);
  }, [filtro, medir]);

  function rolar(sentido: 1 | -1) {
    const q = quadro.current;
    if (q) q.scrollBy({ left: sentido * q.clientWidth * 0.8, behavior: "smooth" });
  }

  function irPara(id: string) {
    const coluna = quadro.current?.querySelector<HTMLElement>(`[data-etapa="${id}"]`);
    const q = quadro.current;
    if (!coluna || !q) return;
    q.scrollTo({ left: coluna.offsetLeft - parseFloat(getComputedStyle(q).paddingLeft || "0"), behavior: "smooth" });
  }

  // Arrastar o fundo do quadro para os lados, só com mouse (no toque o dedo já rola).
  const arrasto = useRef<{ x: number; inicio: number; moveu: boolean } | null>(null);
  function comecarArrasto(e: React.PointerEvent<HTMLDivElement>) {
    if (e.pointerType !== "mouse" || e.button !== 0) return;
    if ((e.target as HTMLElement).closest(".cartao-projeto, button, a, input, select, label, summary")) return;
    arrasto.current = { x: e.clientX, inicio: e.currentTarget.scrollLeft, moveu: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function arrastar(e: React.PointerEvent<HTMLDivElement>) {
    const a = arrasto.current;
    if (!a) return;
    const dx = e.clientX - a.x;
    if (Math.abs(dx) > 3) a.moveu = true;
    e.currentTarget.scrollLeft = a.inicio - dx;
    e.currentTarget.classList.toggle("puxando", a.moveu);
  }
  function soltarArrasto(e: React.PointerEvent<HTMLDivElement>) {
    if (!arrasto.current) return;
    arrasto.current = null;
    e.currentTarget.classList.remove("puxando");
  }

  return (
    <Contexto.Provider value={filtro}>
      <div className="esteira-barra">
        <label className="campo-busca">
          <Search size={15} aria-hidden />
          <input
            type="search"
            value={termo}
            onChange={(e) => setTermo(e.target.value)}
            placeholder="Filtrar por cliente, cidade ou responsável"
            aria-label="Filtrar projetos da esteira"
          />
          {termo && (
            <button type="button" className="campo-limpar" onClick={() => setTermo("")} aria-label="Limpar filtro">
              <X size={14} aria-hidden />
            </button>
          )}
        </label>
        <div className="segmentado" role="group" aria-label="Quais projetos mostrar">
          <button
            type="button"
            aria-pressed={!soParados && !soMeus}
            onClick={() => {
              setSoParados(false);
              setSoMeus(false);
            }}
          >
            Todos <span className="segmentado-n">{total}</span>
          </button>
          <button type="button" aria-pressed={soParados} onClick={() => setSoParados((v) => !v)}>
            Parados <span className="segmentado-n">{parados}</span>
          </button>
          {meus > 0 && (
            <button type="button" aria-pressed={soMeus} onClick={() => setSoMeus((v) => !v)}>
              Meus <span className="segmentado-n">{meus}</span>
            </button>
          )}
        </div>
      </div>

      <nav className="esteira-mapa" aria-label="Ir para a etapa">
        {etapas.map((e) => (
          <button
            key={e.id}
            type="button"
            className={`esteira-mapa-etapa${visiveis.has(e.id) ? " a-vista" : ""}${e.n ? "" : " sem-projeto"}`}
            onClick={() => irPara(e.id)}
            title={e.nome}
          >
            <span className="esteira-mapa-ordem">{e.ordem}</span>
            <span className="esteira-mapa-nome">{e.nome}</span>
            <span className="esteira-mapa-n">{e.n}</span>
          </button>
        ))}
      </nav>

      <div className={`esteira-moldura${lados.esq ? " tem-esq" : ""}${lados.dir ? " tem-dir" : ""}`}>
        {lados.esq && (
          <button type="button" className="esteira-seta esq" onClick={() => rolar(-1)} aria-label="Ver as etapas anteriores">
            <ChevronLeft size={20} aria-hidden />
          </button>
        )}
        <div
          ref={quadro}
          className="esteira"
          onScroll={medir}
          onPointerDown={comecarArrasto}
          onPointerMove={arrastar}
          onPointerUp={soltarArrasto}
          onPointerCancel={soltarArrasto}
        >
          {children}
        </div>
        {lados.dir && (
          <button type="button" className="esteira-seta dir" onClick={() => rolar(1)} aria-label="Ver as próximas etapas">
            <ChevronRight size={20} aria-hidden />
          </button>
        )}
      </div>
    </Contexto.Provider>
  );
}

export function ColunaEsteira({ etapaId, cabecalho, children }: { etapaId: string; cabecalho: ReactNode; children?: ReactNode }) {
  const filtro = useContext(Contexto);
  const [limite, setLimite] = useState(INICIAIS);
  const todos = Children.toArray(children).filter(isValidElement) as Cartao[];
  const filtrando = !!filtro.termo || filtro.soParados || filtro.soMeus;
  const achados = filtrando ? todos.filter((c) => passa(c, filtro)) : todos;
  // Filtrando, mostra tudo o que bateu: o filtro já fez o trabalho da paginação.
  const mostrados = filtrando ? achados : achados.slice(0, limite);
  const restam = achados.length - mostrados.length;

  const classe = ["coluna", todos.length ? "" : "vazia", filtrando && !achados.length ? "apagada" : ""]
    .filter(Boolean)
    .join(" ");

  return (
    <section className={classe} data-etapa={etapaId} id={`etapa-${etapaId}`}>
      {cabecalho}
      {filtrando && todos.length > 0 && (
        <p className="coluna-achados">
          {achados.length ? `${achados.length} de ${todos.length}` : "nenhum com esse filtro"}
        </p>
      )}
      {mostrados.length > 0 && <div className="cartoes">{mostrados}</div>}
      {restam > 0 && (
        <button type="button" className="coluna-mais" onClick={() => setLimite((n) => n + A_MAIS)}>
          Mostrar mais {Math.min(A_MAIS, restam)}
          {restam > A_MAIS && <span>· faltam {restam}</span>}
        </button>
      )}
      {!todos.length && <p className="coluna-vazia">Nenhum projeto nesta etapa</p>}
    </section>
  );
}
