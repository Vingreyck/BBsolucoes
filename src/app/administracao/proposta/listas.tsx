"use client";

import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";

import type { Financiamento, ItemDeCusto, Perfil, TipoDeCusto } from "@/proposta/premissas";

/**
 * As listas das premissas da proposta (perfis, custos, financiamentos), que
 * crescem e diminuem na tela. Cada uma escreve o que tem num campo escondido,
 * em JSON, com porcentagem digitada como porcentagem (30, não 0,3); o
 * `premissasDoFormulario` converte e confere.
 */

const num = (v: number) => String(+v.toFixed(4)).replace(".", ",");
const lerNum = (t: string) => {
  const s = t.trim().replace(/\./g, (m, i, str: string) => (str.includes(",") ? "" : m)).replace(",", ".");
  const n = Number(s);
  return s === "" || !Number.isFinite(n) ? NaN : n;
};

export function EditorDePerfis({
  nome,
  nomeDoPadrao,
  inicial,
  rotuloValor,
}: {
  nome: string;
  /** O campo do valor padrão (o primeiro perfil), que as premissas também guardam. */
  nomeDoPadrao: string;
  inicial: Perfil[];
  rotuloValor: string;
}) {
  const [lista, setLista] = useState(inicial.map((p) => ({ nome: p.nome, valor: num(p.valor * 100) })));
  return (
    <div className="ap-avisos">
      <input type="hidden" name={nome} value={JSON.stringify(lista.map((p) => ({ nome: p.nome, valor: lerNum(p.valor) })))} />
      <input type="hidden" name={nomeDoPadrao} value={lista[0]?.valor ?? ""} />
      <small className="ap-explica">O primeiro da lista é o que o assistente já traz marcado.</small>
      {lista.map((p, i) => (
        <div key={i} className="ap-kit-linha" style={{ gridTemplateColumns: "minmax(0,1fr) 120px auto" }}>
          <label className="ap-campo">
            Nome
            <input value={p.nome} onChange={(e) => setLista(lista.map((x, j) => (j === i ? { ...x, nome: e.target.value } : x)))} />
          </label>
          <label className="ap-campo">
            {rotuloValor}
            <input inputMode="decimal" value={p.valor} onChange={(e) => setLista(lista.map((x, j) => (j === i ? { ...x, valor: e.target.value } : x)))} />
          </label>
          <button type="button" className="ap-icone-botao" aria-label={`Tirar ${p.nome}`} disabled={lista.length === 1} onClick={() => setLista(lista.filter((_, j) => j !== i))}>
            <Trash2 size={15} aria-hidden />
          </button>
        </div>
      ))}
      <button type="button" className="link-acao" onClick={() => setLista([...lista, { nome: "", valor: "" }])}>
        <Plus size={13} aria-hidden /> Perfil
      </button>
    </div>
  );
}

const TIPOS: [TipoDeCusto, string][] = [
  ["fixo", "Valor fixo (R$)"],
  ["por_kwp", "Por kWp (R$/kWp)"],
  ["por_modulo", "Por módulo (R$)"],
  ["por_inversor", "Por inversor (R$)"],
  ["percentual", "Percentual (%)"],
  ["faixa_kwp", "Faixa por potência"],
];

type LinhaDeCusto = {
  id: string;
  nome: string;
  tipo: TipoDeCusto;
  valor: string;
  base: "kit" | "custo";
  grupo: "material" | "servico" | "outro";
  estruturas: string[];
  faixas: { ateKwp: string; valor: string }[];
};

export function EditorDeCustos({ inicial, telhados }: { inicial: ItemDeCusto[]; telhados: string[] }) {
  const [lista, setLista] = useState<LinhaDeCusto[]>(
    inicial.map((i) => ({
      id: i.id,
      nome: i.nome,
      tipo: i.tipo,
      valor: num(i.tipo === "percentual" ? i.valor * 100 : i.valor),
      base: i.base ?? "kit",
      grupo: i.grupo,
      estruturas: i.estruturas ?? [],
      faixas: (i.faixas ?? []).map((f) => ({ ateKwp: num(f.ateKwp), valor: num(f.valor) })),
    })),
  );
  const mudar = (i: number, p: Partial<LinhaDeCusto>) => setLista(lista.map((x, j) => (j === i ? { ...x, ...p } : x)));
  const saida = lista.map((l) => ({
    id: l.id || l.nome.toLowerCase().normalize("NFD").replace(/[^\w]+/g, "-").slice(0, 30),
    nome: l.nome,
    tipo: l.tipo,
    valor: l.tipo === "faixa_kwp" ? 0 : lerNum(l.valor),
    base: l.base,
    grupo: l.grupo,
    estruturas: l.estruturas,
    faixas: l.faixas.map((f) => ({ ateKwp: lerNum(f.ateKwp), valor: lerNum(f.valor) })),
  }));
  return (
    <div className="ap-avisos">
      <input type="hidden" name="custos" value={JSON.stringify(saida)} />
      {lista.map((l, i) => (
        <div key={i} className="ap-uc">
          <div className="ap-grade">
            <label className="ap-campo">
              Custo
              <input value={l.nome} placeholder="Mão de obra de instalação" onChange={(e) => mudar(i, { nome: e.target.value })} />
            </label>
            <label className="ap-campo">
              Como calcula
              <select value={l.tipo} onChange={(e) => mudar(i, { tipo: e.target.value as TipoDeCusto, faixas: e.target.value === "faixa_kwp" && !l.faixas.length ? [{ ateKwp: "5", valor: "" }] : l.faixas })}>
                {TIPOS.map(([v, r]) => (
                  <option key={v} value={v}>
                    {r}
                  </option>
                ))}
              </select>
            </label>
            {l.tipo !== "faixa_kwp" && (
              <label className="ap-campo">
                {l.tipo === "percentual" ? "Percentual (%)" : "Valor (R$)"}
                <input inputMode="decimal" value={l.valor} onChange={(e) => mudar(i, { valor: e.target.value })} />
              </label>
            )}
            {l.tipo === "percentual" && (
              <label className="ap-campo">
                Sobre
                <select value={l.base} onChange={(e) => mudar(i, { base: e.target.value as "kit" | "custo" })}>
                  <option value="kit">o kit</option>
                  <option value="custo">o custo até aqui (kit + itens acima)</option>
                </select>
              </label>
            )}
            <label className="ap-campo">
              Grupo
              <select value={l.grupo} onChange={(e) => mudar(i, { grupo: e.target.value as LinhaDeCusto["grupo"] })}>
                <option value="servico">Serviço</option>
                <option value="material">Material</option>
                <option value="outro">Outro</option>
              </select>
            </label>
            <label className="ap-campo">
              Só para os telhados
              <select
                multiple
                value={l.estruturas}
                onChange={(e) => mudar(i, { estruturas: [...e.target.selectedOptions].map((o) => o.value) })}
                style={{ minHeight: 76 }}
              >
                {telhados.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
              <small>Nenhum marcado: vale para todos.</small>
            </label>
          </div>
          {l.tipo === "faixa_kwp" && (
            <div className="ap-avisos">
              {l.faixas.map((f, k) => (
                <div key={k} className="ap-kit-linha" style={{ gridTemplateColumns: "1fr 1fr auto" }}>
                  <label className="ap-campo">
                    Até (kWp)
                    <input inputMode="decimal" value={f.ateKwp} onChange={(e) => mudar(i, { faixas: l.faixas.map((x, j) => (j === k ? { ...x, ateKwp: e.target.value } : x)) })} />
                  </label>
                  <label className="ap-campo">
                    Valor total (R$)
                    <input inputMode="decimal" value={f.valor} onChange={(e) => mudar(i, { faixas: l.faixas.map((x, j) => (j === k ? { ...x, valor: e.target.value } : x)) })} />
                  </label>
                  <button type="button" className="ap-icone-botao" aria-label="Tirar a faixa" onClick={() => mudar(i, { faixas: l.faixas.filter((_, j) => j !== k) })}>
                    <Trash2 size={15} aria-hidden />
                  </button>
                </div>
              ))}
              <button type="button" className="link-acao" onClick={() => mudar(i, { faixas: [...l.faixas, { ateKwp: "", valor: "" }] })}>
                <Plus size={13} aria-hidden /> Faixa
              </button>
            </div>
          )}
          <button type="button" className="link-acao" onClick={() => setLista(lista.filter((_, j) => j !== i))}>
            <Trash2 size={13} aria-hidden /> Tirar este custo
          </button>
        </div>
      ))}
      <button
        type="button"
        className="botao secundario"
        onClick={() => setLista([...lista, { id: "", nome: "", tipo: "fixo", valor: "", base: "kit", grupo: "servico", estruturas: [], faixas: [] }])}
      >
        <Plus size={14} aria-hidden /> Custo
      </button>
    </div>
  );
}

export function EditorDeFinanciamentos({ inicial }: { inicial: Financiamento[] }) {
  const [lista, setLista] = useState(
    inicial.map((f) => ({ nome: f.nome, taxa: num(f.taxaMes * 100), prazos: f.prazos.join(", "), carencia: String(f.carenciaDias) })),
  );
  const saida = lista.map((f) => ({
    nome: f.nome,
    taxaMes: lerNum(f.taxa),
    prazos: f.prazos
      .split(/[,;\s]+/)
      .map((p) => Number(p))
      .filter((p) => Number.isInteger(p) && p > 0),
    carenciaDias: Number(f.carencia) || 0,
  }));
  return (
    <div className="ap-avisos">
      <input type="hidden" name="financiamentos" value={JSON.stringify(saida)} />
      {lista.map((f, i) => (
        <div key={i} className="ap-kit-linha" style={{ gridTemplateColumns: "minmax(0,1.3fr) 110px minmax(0,1.2fr) 110px auto" }}>
          <label className="ap-campo">
            Banco ou linha
            <input value={f.nome} placeholder="Solfácil, BV, Santander…" onChange={(e) => setLista(lista.map((x, j) => (j === i ? { ...x, nome: e.target.value } : x)))} />
          </label>
          <label className="ap-campo">
            Taxa (% a.m.)
            <input inputMode="decimal" value={f.taxa} onChange={(e) => setLista(lista.map((x, j) => (j === i ? { ...x, taxa: e.target.value } : x)))} />
          </label>
          <label className="ap-campo">
            Prazos (meses)
            <input value={f.prazos} placeholder="36, 48, 60, 72" onChange={(e) => setLista(lista.map((x, j) => (j === i ? { ...x, prazos: e.target.value } : x)))} />
          </label>
          <label className="ap-campo">
            Carência (dias)
            <input inputMode="numeric" value={f.carencia} onChange={(e) => setLista(lista.map((x, j) => (j === i ? { ...x, carencia: e.target.value } : x)))} />
          </label>
          <button type="button" className="ap-icone-botao" aria-label={`Tirar ${f.nome}`} onClick={() => setLista(lista.filter((_, j) => j !== i))}>
            <Trash2 size={15} aria-hidden />
          </button>
        </div>
      ))}
      <button type="button" className="link-acao" onClick={() => setLista([...lista, { nome: "", taxa: "", prazos: "36, 48, 60", carencia: "90" }])}>
        <Plus size={13} aria-hidden /> Financiamento
      </button>
    </div>
  );
}
