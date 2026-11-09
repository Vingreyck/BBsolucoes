"use client";

import { Search, X } from "lucide-react";
import {
  Children,
  createContext,
  isValidElement,
  useContext,
  useMemo,
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

export function QuadroEsteira({
  children,
  meuId,
  total,
  parados,
  meus,
}: {
  children: ReactNode;
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
      <div className="esteira">{children}</div>
    </Contexto.Provider>
  );
}

export function ColunaEsteira({ cabecalho, children }: { cabecalho: ReactNode; children?: ReactNode }) {
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
    <section className={classe}>
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
