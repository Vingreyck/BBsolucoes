"use client";

import { CheckCircle2, Info, Plus, Trash2, X } from "lucide-react";
import { useState } from "react";
import { useFormStatus } from "react-dom";

import type { LinhaDaEntrada } from "@/db/schema/estoque";
import { quantidadeLegivel } from "@/estoque/regras";

import { ORIGEM_ROTULO } from "../rotulos";

const UNIDADES = ["un", "m", "kg", "cx", "rolo", "par", "kit", "cj", "l"];

interface Linha extends LinhaDaEntrada {
  chave: number;
  /** Linha acrescentada na conferência (dá para tirar). */
  nova: boolean;
  qtdTexto: string;
}

let proxima = 1;

type Clicado = "lancar" | "descartar" | null;

function Lancar({ total, clicado, marcar }: { total: number; clicado: Clicado; marcar: () => void }) {
  const { pending } = useFormStatus();
  const lancando = pending && clicado === "lancar";
  return (
    <button type="submit" className="botao" disabled={pending || total === 0} onClick={marcar}>
      {lancando ? <span className="pc-girando" aria-hidden /> : <CheckCircle2 size={15} aria-hidden />}
      {lancando ? "Lançando…" : total === 1 ? "Lançar 1 item no estoque" : `Lançar ${total} itens no estoque`}
    </button>
  );
}

function Descartar({ acao, clicado, marcar }: { acao: () => Promise<void>; clicado: Clicado; marcar: () => void }) {
  const { pending } = useFormStatus();
  const descartando = pending && clicado === "descartar";
  return (
    <button
      type="submit"
      formAction={acao}
      formNoValidate
      className="botao secundario"
      disabled={pending}
      onClick={(e) => {
        if (!confirm("Descartar esta entrada? Nada entra no estoque e os arquivos vão para a lixeira do Drive.")) e.preventDefault();
        else marcar();
      }}
    >
      {descartando ? <span className="pc-girando" aria-hidden /> : <Trash2 size={15} aria-hidden />}
      {descartando ? "Descartando…" : "Descartar"}
    </button>
  );
}

/**
 * A conferência da entrada: cada linha lida, para marcar o que entra, corrigir
 * a quantidade e dizer qual item do estoque ela é (ou criar um novo com a
 * descrição). Os números do topo e o botão acompanham enquanto se mexe.
 */
export function Conferencia({
  linhasLidas,
  itens,
  modelos,
  cabecalho,
  lancar,
  descartar,
}: {
  linhasLidas: LinhaDaEntrada[];
  itens: { id: string; nome: string; unidade: string; ativo: boolean }[];
  modelos: { id: string; nome: string }[];
  cabecalho: { numero: string | null; fornecedor: string | null; emitidaEm: string | null };
  lancar: (form: FormData) => Promise<void>;
  descartar: () => Promise<void>;
}) {
  const nomeDoItem = new Map(itens.map((i) => [i.id, i]));
  const [clicado, setClicado] = useState<Clicado>(null);
  const [linhas, setLinhas] = useState<Linha[]>(() => {
    const lidas = linhasLidas.map((l) => ({
      ...l,
      itemId: l.itemId && nomeDoItem.has(l.itemId) ? l.itemId : null,
      chave: proxima++,
      nova: false,
      qtdTexto: l.quantidade ? quantidadeLegivel(l.quantidade) : "",
    }));
    return lidas.length ? lidas : [linhaEmBranco()];
  });

  function linhaEmBranco(): Linha {
    return {
      descricao: "",
      quantidade: 0,
      qtdTexto: "",
      unidade: "un",
      codigo: null,
      valorUnitario: null,
      origem: "lista",
      entra: true,
      motivo: null,
      itemId: null,
      modeloId: null,
      chave: proxima++,
      nova: true,
    };
  }

  const mudar = (chave: number, campos: Partial<Linha>) => setLinhas((ls) => ls.map((l) => (l.chave === chave ? { ...l, ...campos } : l)));

  const validas = linhas.filter((l) => l.descricao.trim() || l.itemId);
  const entram = validas.filter((l) => l.entra);
  const fora = validas.length - entram.length;
  const novos = entram.filter((l) => !l.itemId).length;
  const kit = linhas.find((l) => l.origem === "lista" && !l.entra && l.motivo?.includes("kit"));
  const daObservacao = linhas.filter((l) => l.origem === "observacao").length;

  return (
    <form action={lancar} className="pilha">
      <div className="es-resumo" aria-live="polite">
        <span className="es-chip">
          <strong>{validas.length}</strong> {validas.length === 1 ? "linha" : "linhas"}
        </span>
        <span className="es-chip ok">
          <strong>{entram.length}</strong> {entram.length === 1 ? "entra" : "entram"} no estoque
        </span>
        {fora > 0 && (
          <span className="es-chip atencao">
            <strong>{fora}</strong> {fora === 1 ? "fica fora" : "ficam fora"}
          </span>
        )}
        {novos > 0 && (
          <span className="es-chip">
            <strong>{novos}</strong> {novos === 1 ? "item novo" : "itens novos"} no cadastro
          </span>
        )}
      </div>

      {kit && daObservacao > 0 && (
        <p className="es-explica">
          <Info size={16} aria-hidden />
          <span>
            A nota trouxe <strong>{kit.descricao}</strong> como item e os componentes escritos na observação. Os {daObservacao}{" "}
            componentes entram; o kit ficou desmarcado para não contar duas vezes. Se o kit é guardado fechado, marque o kit e
            desmarque os componentes.
          </span>
        </p>
      )}

      <div className="es-cabecalho-form">
        <label>
          Número da nota ou do pedido
          <input className="es-campo" name="numero" defaultValue={cabecalho.numero ?? ""} maxLength={60} />
        </label>
        <label>
          Fornecedor
          <input className="es-campo" name="fornecedor" defaultValue={cabecalho.fornecedor ?? ""} maxLength={200} />
        </label>
        <label>
          Emissão
          <input className="es-campo" type="date" name="emitidaEm" defaultValue={cabecalho.emitidaEm ?? ""} />
        </label>
      </div>

      <input type="hidden" name="linhas" value={linhas.length} />
      <div className="es-conf-wrap">
        <table className="es-conf">
          <thead>
            <tr>
              <th className="col-entra">Entra</th>
              <th>Descrição</th>
              <th className="num col-qtd">Qtd.</th>
              <th className="col-un">Un.</th>
              <th>Item do estoque</th>
              <th>Catálogo</th>
              <th className="col-x" />
            </tr>
          </thead>
          <tbody>
            {linhas.map((l, n) => {
              const existente = l.itemId ? nomeDoItem.get(l.itemId) : undefined;
              return (
                <tr key={l.chave} className={l.entra ? "" : "fora"}>
                  <td className="col-entra">
                    <input
                      type="checkbox"
                      className="es-check"
                      name={`entra_${n}`}
                      checked={l.entra}
                      onChange={(e) => mudar(l.chave, { entra: e.target.checked })}
                      aria-label={`Entra no estoque: ${l.descricao || `linha ${n + 1}`}`}
                    />
                    <input type="hidden" name={`origem_${n}`} value={l.origem} />
                    <input type="hidden" name={`codigo_${n}`} value={l.codigo ?? ""} />
                    <input type="hidden" name={`valor_${n}`} value={l.valorUnitario ?? ""} />
                  </td>
                  <td>
                    <input
                      className="es-campo"
                      name={`descricao_${n}`}
                      value={l.descricao}
                      onChange={(e) => mudar(l.chave, { descricao: e.target.value })}
                      placeholder={l.nova ? "Item que a leitura não pegou" : ""}
                      maxLength={300}
                      aria-label={`Descrição da linha ${n + 1}`}
                    />
                    {!l.nova && <span className={`es-origem ${l.origem}`}>{ORIGEM_ROTULO[l.origem] ?? l.origem}</span>}
                    {l.codigo && <span className="es-motivo">cód. {l.codigo}</span>}
                    {l.motivo && !l.entra && <span className="es-motivo">{l.motivo}</span>}
                  </td>
                  <td>
                    <input
                      className="es-campo num"
                      name={`quantidade_${n}`}
                      inputMode="decimal"
                      value={l.qtdTexto}
                      onChange={(e) => mudar(l.chave, { qtdTexto: e.target.value })}
                      aria-label={`Quantidade da linha ${n + 1}`}
                    />
                  </td>
                  <td>
                    <select
                      className="es-campo"
                      name={`unidade_${n}`}
                      value={existente ? existente.unidade : l.unidade}
                      onChange={(e) => mudar(l.chave, { unidade: e.target.value })}
                      disabled={Boolean(existente)}
                      aria-label={`Unidade da linha ${n + 1}`}
                    >
                      {[...new Set([existente?.unidade ?? l.unidade, ...UNIDADES])].map((u) => (
                        <option key={u} value={u}>
                          {u}
                        </option>
                      ))}
                    </select>
                    {existente && <input type="hidden" name={`unidade_${n}`} value={existente.unidade} />}
                  </td>
                  <td>
                    <div className="es-ligacao">
                      <select
                        className="es-campo"
                        name={`item_${n}`}
                        value={l.itemId ?? ""}
                        onChange={(e) => mudar(l.chave, { itemId: e.target.value || null })}
                        aria-label={`Item do estoque da linha ${n + 1}`}
                      >
                        <option value="">＋ Criar item novo</option>
                        {itens.map((i) => (
                          <option key={i.id} value={i.id}>
                            {i.nome}
                            {i.ativo ? "" : " (fora da lista)"}
                          </option>
                        ))}
                      </select>
                      <small className={existente ? "" : "novo"}>
                        {existente ? "Soma neste item" : l.descricao.trim() ? `Cria “${l.descricao.trim().slice(0, 40)}”` : "Escreva a descrição"}
                      </small>
                    </div>
                  </td>
                  <td>
                    <select
                      className="es-campo"
                      name={`modelo_${n}`}
                      value={l.modeloId ?? ""}
                      onChange={(e) => mudar(l.chave, { modeloId: e.target.value || null })}
                      disabled={Boolean(existente)}
                      aria-label={`Modelo do catálogo da linha ${n + 1}`}
                      title={existente ? "O item já existe: o catálogo dele se muda no Saldo" : undefined}
                    >
                      <option value="">—</option>
                      {modelos.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.nome}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="col-x">
                    {l.nova && (
                      <button
                        type="button"
                        className="es-remover"
                        onClick={() => setLinhas((ls) => ls.filter((x) => x.chave !== l.chave))}
                        aria-label={`Tirar a linha ${n + 1}`}
                        title="Tirar a linha"
                      >
                        <X size={15} aria-hidden />
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <button type="button" className="es-adicionar" onClick={() => setLinhas((ls) => [...ls, linhaEmBranco()])}>
        <Plus size={15} aria-hidden /> Adicionar item que a leitura não pegou
      </button>

      <div className="es-barra-fixa">
        <p>
          <strong>{entram.length}</strong> de {validas.length} {validas.length === 1 ? "linha entra" : "linhas entram"} no saldo
          {novos > 0 ? ` · ${novos} ${novos === 1 ? "item novo" : "itens novos"}` : ""}.
        </p>
        <div className="es-barra-botoes">
          <Descartar acao={descartar} clicado={clicado} marcar={() => setClicado("descartar")} />
          <Lancar total={entram.length} clicado={clicado} marcar={() => setClicado("lancar")} />
        </div>
      </div>
    </form>
  );
}
