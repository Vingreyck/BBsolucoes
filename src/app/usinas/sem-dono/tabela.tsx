"use client";

import { Check, Search, SearchX, Sun } from "lucide-react";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";

import { ligarAoCliente, ligarAoProjeto } from "./actions";

export interface ClienteParaLigar {
  id: string;
  nome: string;
  cidade: string | null;
  docs: number;
}

/** Uma venda já instalada que combina com a usina, e por quê. */
export interface VendaSugerida {
  projetoId: string;
  clienteNome: string;
  motivos: string[];
}

export interface UsinaSemDono {
  id: string;
  nome: string;
  portal: string;
  cidade: string | null;
  /** AAAA-MM-DD, ou nulo. */
  instaladaEm: string | null;
  vendas: VendaSugerida[];
  /** Clientes de nome parecido que não vieram como venda. */
  parecidos: ClienteParaLigar[];
}

/** Minúsculo e sem acento: "José" acha "jose". */
function sem(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

function dataCurta(iso: string | null): string {
  if (!iso) return "—";
  const [a, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${a}`;
}

/** Quantas linhas aparecem antes do "mostrar mais". */
const LINHAS = 25;

/**
 * A lista das usinas que ainda não têm dono, como tabela: dá para escrever na
 * busca, filtrar por portal e, em cada linha, ligar com um clique numa sugestão
 * ou **digitando** o nome do cliente (a lista de uns trezentos nomes num
 * `select` não se acha nem rolando).
 *
 * Os clientes vêm uma vez só, para a tabela inteira, e não repetidos em cada linha.
 */
export function TabelaSemDono({ usinas, clientes }: { usinas: UsinaSemDono[]; clientes: ClienteParaLigar[] }) {
  const [busca, setBusca] = useState("");
  const [portal, setPortal] = useState("");
  const [mostrar, setMostrar] = useState(LINHAS);
  const [ligadas, setLigadas] = useState<Record<string, string>>({});
  const [erros, setErros] = useState<Record<string, string>>({});
  const [ocupada, setOcupada] = useState<string | null>(null);
  const [, comecar] = useTransition();

  const portais = useMemo(() => [...new Set(usinas.map((u) => u.portal))].sort(), [usinas]);
  const filtradas = useMemo(() => {
    const alvo = sem(busca.trim());
    return usinas.filter((u) => {
      if (portal && u.portal !== portal) return false;
      return !alvo || sem(`${u.nome} ${u.cidade ?? ""} ${u.portal}`).includes(alvo);
    });
  }, [usinas, busca, portal]);
  const visiveis = filtradas.slice(0, mostrar);
  const pendentes = usinas.filter((u) => !ligadas[u.id]).length;

  function executar(usinaId: string, nome: string, acao: () => Promise<{ erro?: string }>) {
    setErros((e) => ({ ...e, [usinaId]: "" }));
    setOcupada(usinaId);
    comecar(async () => {
      const r = await acao();
      if (r.erro) setErros((e) => ({ ...e, [usinaId]: r.erro! }));
      else setLigadas((l) => ({ ...l, [usinaId]: nome }));
      setOcupada(null);
    });
  }

  const ligarCliente = (u: UsinaSemDono, c: { id: string; nome: string }) =>
    executar(u.id, c.nome, () => ligarAoCliente(u.id, c.id));
  const ligarVenda = (u: UsinaSemDono, v: VendaSugerida) =>
    executar(u.id, `${v.clienteNome} (e à venda dele)`, () => ligarAoProjeto(u.id, v.projetoId));

  return (
    <section className="lista" id="lista" aria-label="Usinas sem dono">
      <div className="lista-barra">
        <label className="campo-busca">
          <Search size={15} aria-hidden />
          <input
            type="search"
            value={busca}
            onChange={(e) => {
              setBusca(e.target.value);
              setMostrar(LINHAS);
            }}
            placeholder="Usina, cidade ou portal"
            aria-label="Buscar usina"
          />
        </label>
        {portais.length > 1 && (
          <label className={`seletor-filtro${portal ? " ativo" : ""}`}>
            <span>Portal</span>
            <select
              value={portal}
              onChange={(e) => {
                setPortal(e.target.value);
                setMostrar(LINHAS);
              }}
            >
              <option value="">Todos ({usinas.length})</option>
              {portais.map((p) => (
                <option key={p} value={p}>
                  {p} ({usinas.filter((u) => u.portal === p).length})
                </option>
              ))}
            </select>
          </label>
        )}
        <span className="lista-barra-rotulo" role="status">
          {filtradas.length === usinas.length ? `${usinas.length} usinas` : `${filtradas.length} de ${usinas.length}`} ·{" "}
          {pendentes} esperando
        </span>
      </div>

      {filtradas.length === 0 ? (
        <div className="vazio-novo" role="status">
          <SearchX size={20} aria-hidden /> Nenhuma usina bate com a busca.
        </div>
      ) : (
        <>
          <div className="tabela-rolagem">
            <table className="tabela tabela-sem-dono">
              <thead>
                <tr>
                  <th scope="col">Usina</th>
                  <th scope="col">Portal</th>
                  <th scope="col">Cidade</th>
                  <th scope="col" className="num">
                    Instalada
                  </th>
                  <th scope="col">Sugestões</th>
                  <th scope="col">Ligar a…</th>
                </tr>
              </thead>
              <tbody>
                {visiveis.map((u) => {
                  const pronta = ligadas[u.id];
                  const trava = ocupada === u.id;
                  return (
                    <tr key={u.id} className={pronta ? "linha-ligada" : undefined}>
                      <td>
                        <span className="celula-dupla">
                          <strong>
                            <Sun size={13} aria-hidden style={{ verticalAlign: "-2px", marginRight: 4 }} />
                            {u.nome}
                          </strong>
                        </span>
                      </td>
                      <td>{u.portal}</td>
                      <td>{u.cidade ?? <span className="fraco">—</span>}</td>
                      <td className="num">{dataCurta(u.instaladaEm)}</td>
                      {pronta ? (
                        <td colSpan={2}>
                          <span className="status-ok">
                            <Check size={14} aria-hidden /> Ligada a {pronta}
                          </span>
                        </td>
                      ) : (
                        <>
                          <td>
                            <div className="sugestoes">
                              {u.vendas.map((v) => (
                                <button
                                  key={v.projetoId}
                                  type="button"
                                  className="sugestao-venda"
                                  disabled={trava}
                                  onClick={() => ligarVenda(u, v)}
                                  title={v.motivos.join(" · ")}
                                >
                                  {v.clienteNome}
                                  <span className="conta">{v.motivos.join(" · ")}</span>
                                </button>
                              ))}
                              {u.parecidos.map((c) => (
                                <button key={c.id} type="button" disabled={trava} onClick={() => ligarCliente(u, c)} title={`${c.docs} documentos`}>
                                  {c.nome}
                                  {c.docs > 0 && <span className="conta">{c.docs} docs</span>}
                                </button>
                              ))}
                              {u.vendas.length === 0 && u.parecidos.length === 0 && <span className="fraco">—</span>}
                            </div>
                          </td>
                          <td>
                            <BuscaCliente clientes={clientes} desabilitado={trava} aoEscolher={(c) => ligarCliente(u, c)} />
                            {erros[u.id] && <p className="erro-linha">{erros[u.id]}</p>}
                          </td>
                        </>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {filtradas.length > mostrar && (
            <p className="lista-mais">
              <button type="button" className="botao secundario" onClick={() => setMostrar((m) => m + LINHAS)}>
                Mostrar mais ({filtradas.length - mostrar})
              </button>
            </p>
          )}
        </>
      )}
    </section>
  );
}

/**
 * Escolher o cliente **escrevendo**: a lista filtra enquanto se digita (sem
 * acento, por nome ou cidade), as setas e o Enter escolhem, o Esc fecha.
 *
 * A lista é desenhada no `<body>`, com posição fixa: dentro de uma tabela que
 * rola, ela seria cortada pela borda.
 */
function BuscaCliente({
  clientes,
  desabilitado,
  aoEscolher,
}: {
  clientes: ClienteParaLigar[];
  desabilitado: boolean;
  aoEscolher: (c: ClienteParaLigar) => void;
}) {
  const [texto, setTexto] = useState("");
  const [aberta, setAberta] = useState(false);
  const [ativo, setAtivo] = useState(0);
  const [lugar, setLugar] = useState<{ top: number; left: number; largura: number } | null>(null);
  const campo = useRef<HTMLInputElement>(null);

  const achados = useMemo(() => {
    const alvo = sem(texto.trim());
    const base = alvo ? clientes.filter((c) => sem(`${c.nome} ${c.cidade ?? ""}`).includes(alvo)) : clientes;
    // Quem começa com o que foi digitado primeiro; depois quem tem documento (veio do contrato).
    return [...base]
      .sort((a, b) => {
        const ia = alvo && sem(a.nome).startsWith(alvo) ? 0 : 1;
        const ib = alvo && sem(b.nome).startsWith(alvo) ? 0 : 1;
        return ia - ib || b.docs - a.docs || a.nome.localeCompare(b.nome, "pt-BR");
      })
      .slice(0, 8);
  }, [clientes, texto]);

  // A lista acompanha o campo; se a página rolar ou mudar de tamanho, fecha.
  useEffect(() => {
    if (!aberta) return;
    const fechar = () => setAberta(false);
    window.addEventListener("scroll", fechar, true);
    window.addEventListener("resize", fechar);
    return () => {
      window.removeEventListener("scroll", fechar, true);
      window.removeEventListener("resize", fechar);
    };
  }, [aberta]);

  function abrir() {
    const r = campo.current?.getBoundingClientRect();
    if (r) setLugar({ top: r.bottom + 4, left: r.left, largura: Math.max(r.width, 300) });
    setAberta(true);
  }

  function escolher(c: ClienteParaLigar) {
    setAberta(false);
    setTexto("");
    aoEscolher(c);
  }

  return (
    <div className="busca-cliente">
      <input
        ref={campo}
        type="text"
        role="combobox"
        aria-expanded={aberta}
        aria-autocomplete="list"
        aria-label="Escrever o nome do cliente"
        placeholder="escrever o cliente…"
        autoComplete="off"
        disabled={desabilitado}
        value={texto}
        onFocus={abrir}
        onChange={(e) => {
          setTexto(e.target.value);
          setAtivo(0);
          if (!aberta) abrir();
        }}
        onBlur={() => setAberta(false)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            if (!aberta) abrir();
            setAtivo((a) => Math.min(a + 1, achados.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setAtivo((a) => Math.max(a - 1, 0));
          } else if (e.key === "Enter" && aberta && achados[ativo]) {
            e.preventDefault();
            escolher(achados[ativo]);
          } else if (e.key === "Escape") {
            setAberta(false);
          }
        }}
      />
      {aberta &&
        lugar &&
        createPortal(
          <ul
            className="busca-cliente-lista"
            role="listbox"
            style={{ top: lugar.top, left: lugar.left, width: lugar.largura }}
            // O clique não pode tirar o foco do campo antes de escolher, senão a lista some.
            onMouseDown={(e) => e.preventDefault()}
          >
            {achados.length === 0 ? (
              <li className="busca-cliente-vazio">Nenhum cliente com “{texto}”.</li>
            ) : (
              achados.map((c, i) => (
                <li key={c.id} role="option" aria-selected={i === ativo} onMouseEnter={() => setAtivo(i)} onClick={() => escolher(c)}>
                  <strong>{c.nome}</strong>
                  <small>
                    {[c.cidade, c.docs > 0 ? `${c.docs} docs` : null].filter(Boolean).join(" · ") || "sem documentos"}
                  </small>
                </li>
              ))
            )}
          </ul>,
          document.body,
        )}
    </div>
  );
}
