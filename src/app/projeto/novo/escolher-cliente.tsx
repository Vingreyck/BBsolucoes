"use client";

import { Search, X } from "lucide-react";
import { useMemo, useState } from "react";

export interface Opcao {
  /** `c:<id>` cliente cadastrado, `u:<id>` usina do portal que ainda não tem dono. */
  chave: string;
  nome: string;
  cidade: string | null;
  /** Rótulos de onde a pessoa aparece: portais dos fabricantes e/ou Drive. */
  origens: string[];
  docs: number;
  arquivada: boolean;
}

const semAcento = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

/**
 * Escolher o cliente do projeto: digita para achar em tudo e/ou filtra pela
 * origem (portal do fabricante ou Drive). Manda `clienteId` ou `usinaId` no
 * formulário, conforme o que foi escolhido.
 */
export function EscolherCliente({ opcoes }: { opcoes: Opcao[] }) {
  const [busca, setBusca] = useState("");
  const [origem, setOrigem] = useState<string>("");
  const [escolhida, setEscolhida] = useState<Opcao | null>(null);
  const [mostrarTudo, setMostrarTudo] = useState(false);

  const origens = useMemo(() => {
    const conta = new Map<string, number>();
    for (const o of opcoes) for (const r of o.origens) conta.set(r, (conta.get(r) ?? 0) + 1);
    return [...conta.entries()].sort((a, b) => b[1] - a[1]);
  }, [opcoes]);

  const filtradas = useMemo(() => {
    const q = semAcento(busca.trim());
    return opcoes.filter(
      (o) =>
        (!origem || o.origens.includes(origem)) &&
        (!q || semAcento(`${o.nome} ${o.cidade ?? ""} ${o.origens.join(" ")}`).includes(q)),
    );
  }, [opcoes, busca, origem]);

  const LIMITE = 40;
  const visiveis = mostrarTudo ? filtradas : filtradas.slice(0, LIMITE);

  return (
    <div className="escolher-cliente">
      <input type="hidden" name="clienteId" value={escolhida?.chave.startsWith("c:") ? escolhida.chave.slice(2) : ""} />
      <input type="hidden" name="usinaId" value={escolhida?.chave.startsWith("u:") ? escolhida.chave.slice(2) : ""} />

      {escolhida ? (
        <div className="escolhido">
          <div>
            <strong>{escolhida.nome}</strong>
            <span className="fraco">
              {[escolhida.cidade, escolhida.origens.join(" · ")].filter(Boolean).join(" · ")}
            </span>
          </div>
          <button type="button" className="botao secundario" onClick={() => setEscolhida(null)}>
            <X size={14} aria-hidden /> Trocar
          </button>
        </div>
      ) : (
        <>
          <label className="busca-cliente">
            <Search size={15} aria-hidden />
            <input
              type="search"
              value={busca}
              onChange={(e) => {
                setBusca(e.target.value);
                setMostrarTudo(false);
              }}
              placeholder="Digite o nome, a cidade ou o portal…"
              autoComplete="off"
            />
          </label>

          <div className="chips-origem" role="group" aria-label="Filtrar por origem">
            <button type="button" className={!origem ? "ativo" : ""} onClick={() => setOrigem("")}>
              Todos <span>{opcoes.length}</span>
            </button>
            {origens.map(([nome, n]) => (
              <button
                key={nome}
                type="button"
                className={origem === nome ? "ativo" : ""}
                onClick={() => {
                  setOrigem(origem === nome ? "" : nome);
                  setMostrarTudo(false);
                }}
              >
                {nome} <span>{n}</span>
              </button>
            ))}
          </div>

          <ul className="lista-clientes" role="listbox" aria-label="Clientes">
            {visiveis.map((o) => (
              <li key={o.chave}>
                <button type="button" role="option" aria-selected={false} onClick={() => setEscolhida(o)}>
                  <span className="nome">
                    {o.nome}
                    {o.cidade ? <span className="fraco"> · {o.cidade}</span> : null}
                  </span>
                  <span className="etiquetas">
                    {o.arquivada && <span className="etq etq-cinza">usina arquivada</span>}
                    {o.chave.startsWith("u:") && <span className="etq etq-aviso">sem dono</span>}
                    {o.origens.map((r) => (
                      <span key={r} className="etq">
                        {r}
                      </span>
                    ))}
                    {o.docs > 0 && <span className="etq etq-cinza">{o.docs} docs</span>}
                  </span>
                </button>
              </li>
            ))}
            {filtradas.length === 0 && <li className="vazio-lista">Ninguém encontrado. Escreva o nome abaixo para cadastrar.</li>}
          </ul>

          {filtradas.length > visiveis.length && (
            <button type="button" className="botao secundario" onClick={() => setMostrarTudo(true)}>
              Mostrar os outros {filtradas.length - visiveis.length}
            </button>
          )}
        </>
      )}
    </div>
  );
}
