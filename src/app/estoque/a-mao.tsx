"use client";

import { Check, Plus, X } from "lucide-react";
import { useMemo, useState } from "react";
import { useFormStatus } from "react-dom";

import { chaveDoNome, quantidadeLegivel } from "@/estoque/regras";

import { lancarAMaoAction } from "./actions";

export interface ItemParaEscolher {
  nome: string;
  unidade: string;
  saldo: number;
}

const UNIDADES = ["un", "m", "kg", "cx", "rolo", "par", "kit", "cj", "l"];

interface Linha {
  id: number;
  nome: string;
  quantidade: string;
  unidade: string;
}

let proximo = 1;
const nova = (): Linha => ({ id: proximo++, nome: "", quantidade: "", unidade: "un" });

function Enviar({ total }: { total: number }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="botao" disabled={pending || total === 0}>
      {pending ? <span className="pc-girando" aria-hidden /> : <Check size={15} aria-hidden />}
      {pending ? "Lançando…" : total > 1 ? `Dar entrada em ${total} itens` : "Dar entrada"}
    </button>
  );
}

/**
 * Adicionar à mão: o item que chegou sem nota em mãos (sobra de obra,
 * devolução, compra no balcão). Digitar o nome de um item que já existe soma
 * nele — a lista sugere enquanto digita; nome novo cria o item.
 */
export function AdicionarAMao({ itens }: { itens: ItemParaEscolher[] }) {
  const [linhas, setLinhas] = useState<Linha[]>(() => [nova()]);
  const porChave = useMemo(() => new Map(itens.map((i) => [chaveDoNome(i.nome), i])), [itens]);
  const prontas = linhas.filter((l) => l.nome.trim() && Number(l.quantidade.replace(",", ".")) > 0).length;

  function mudar(id: number, campo: keyof Linha, valor: string) {
    setLinhas((ls) =>
      ls.map((l) => {
        if (l.id !== id) return l;
        const nova = { ...l, [campo]: valor };
        // Escolheu um item que já existe: a unidade é a dele.
        if (campo === "nome") {
          const existe = porChave.get(chaveDoNome(valor));
          if (existe) nova.unidade = existe.unidade;
        }
        return nova;
      }),
    );
  }

  return (
    <form action={lancarAMaoAction} className="es-linhas">
      <input type="hidden" name="linhas" value={linhas.length} />
      <datalist id="es-itens-existentes">
        {itens.map((i) => (
          <option key={i.nome} value={i.nome} />
        ))}
      </datalist>

      <div className="es-linhas-topo" aria-hidden>
        <span>Item</span>
        <span className="num">Quantidade</span>
        <span>Unidade</span>
        <span />
      </div>

      {linhas.map((l, n) => {
        const existe = l.nome.trim() ? porChave.get(chaveDoNome(l.nome)) : undefined;
        return (
          <div className="es-linha" key={l.id}>
            <input
              className="es-campo"
              name={`nome_${n}`}
              list="es-itens-existentes"
              value={l.nome}
              onChange={(e) => mudar(l.id, "nome", e.target.value)}
              placeholder="Ex.: Conector MC4 (par)"
              maxLength={200}
              aria-label={`Item da linha ${n + 1}`}
              autoComplete="off"
            />
            <input
              className="es-campo num"
              name={`quantidade_${n}`}
              inputMode="decimal"
              value={l.quantidade}
              onChange={(e) => mudar(l.id, "quantidade", e.target.value)}
              placeholder="0"
              aria-label={`Quantidade da linha ${n + 1}`}
            />
            <select
              className="es-campo"
              name={`unidade_${n}`}
              value={l.unidade}
              onChange={(e) => mudar(l.id, "unidade", e.target.value)}
              aria-label={`Unidade da linha ${n + 1}`}
            >
              {[...new Set([l.unidade, ...UNIDADES])].map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="es-remover"
              onClick={() => setLinhas((ls) => (ls.length > 1 ? ls.filter((x) => x.id !== l.id) : [nova()]))}
              aria-label={`Tirar a linha ${n + 1}`}
              title="Tirar a linha"
            >
              <X size={15} aria-hidden />
            </button>
            {l.nome.trim() && (
              <span className={`es-linha-novo${existe ? " existe" : ""}`}>
                {existe
                  ? `Soma no item que já existe · hoje ${quantidadeLegivel(existe.saldo)} ${existe.unidade}`
                  : "Item novo: entra no estoque com este nome"}
              </span>
            )}
          </div>
        );
      })}

      <button type="button" className="es-adicionar" onClick={() => setLinhas((ls) => [...ls, nova()])}>
        <Plus size={15} aria-hidden /> Adicionar outro item
      </button>

      <details className="es-dobra">
        <summary>De onde veio (opcional)</summary>
        <div className="es-cabecalho-form">
          <label>
            Fornecedor ou origem
            <input className="es-campo" name="fornecedor" maxLength={200} placeholder="Balcão, sobra da obra…" />
          </label>
          <label>
            Número do documento
            <input className="es-campo" name="numero" maxLength={60} />
          </label>
          <label>
            Data
            <input className="es-campo" type="date" name="emitidaEm" />
          </label>
        </div>
      </details>

      <div className="es-rodape">
        <p className="nota">Entra direto no saldo e fica no histórico como entrada “à mão”.</p>
        <Enviar total={prontas} />
      </div>
    </form>
  );
}
