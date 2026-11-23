"use client";

import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Check,
  FileCheck2,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";

import {
  calcularAssistente,
  chaveDaTarifa,
  novaUc,
  PASSOS,
  type EstadoDaProposta,
  type LinhaDoKit,
  type UcDoAssistente,
} from "@/proposta/assistente";
import type { ContextoMontado, OpcaoDeEquipamento } from "@/proposta/assistente-servidor";
import { DISPONIBILIDADE_KWH, kwpTexto, MESES, moeda, rotuloDoPayback, ROTULO_LIGACAO, type Ligacao } from "@/proposta/calculo";
import { modulosParaPotencia, sugerirInversores, type InversorCandidato } from "@/proposta/dimensionamento";
import { ROTULO_SUBGRUPO, type Subgrupo } from "@/proposta/tarifas";

import {
  buscarCidades,
  buscarEquipamentos,
  dadosDaCidade,
  gerarPropostaDoAssistente,
  recalcularContexto,
  salvarRascunhoDaProposta,
} from "./actions";

// ------------------------------------------------------------------- números

const br = (n: number | null | undefined, casas = 0) =>
  n === null || n === undefined || !Number.isFinite(n)
    ? "—"
    : n.toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas });
const pct = (f: number | null | undefined, casas = 0) => (f === null || f === undefined || !Number.isFinite(f) ? "—" : `${br(f * 100, casas)}%`);
const kwh = (n: number | null | undefined) => (n === null || n === undefined ? "—" : `${br(n)} kWh`);

/** "1.234,5", "0,8", "12" → número; vazio ou inválido → nulo. Aceita zero. */
function lerNumero(texto: string): number | null {
  let t = texto.replace(/R\$|\s|%/g, "");
  if (!t) return null;
  if (t.includes(",")) t = t.replace(/\./g, "").replace(",", ".");
  else if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, "");
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function CampoNumero({
  valor,
  aoMudar,
  casas = 2,
  placeholder,
  rotulo,
  id,
  inteiro = false,
}: {
  valor: number | null;
  aoMudar: (n: number | null) => void;
  casas?: number;
  placeholder?: string;
  rotulo?: string;
  id?: string;
  inteiro?: boolean;
}) {
  const formatar = useCallback((v: number | null) => (v === null ? "" : v.toLocaleString("pt-BR", { maximumFractionDigits: inteiro ? 0 : casas })), [casas, inteiro]);
  const [texto, setTexto] = useState(formatar(valor));
  const [focado, setFocado] = useState(false);
  useEffect(() => {
    if (!focado) setTexto(formatar(valor));
  }, [valor, focado, formatar]);
  return (
    <input
      id={id}
      aria-label={rotulo}
      inputMode={inteiro ? "numeric" : "decimal"}
      value={texto}
      placeholder={placeholder}
      onFocus={() => setFocado(true)}
      onBlur={() => {
        setFocado(false);
        setTexto(formatar(valor));
      }}
      onChange={(e) => {
        setTexto(e.target.value);
        const n = lerNumero(e.target.value);
        aoMudar(n === null ? null : inteiro ? Math.round(n) : n);
      }}
    />
  );
}

/** Percentual na tela (30), fração no estado (0,3). */
function CampoPercentual({ valor, aoMudar, rotulo }: { valor: number | null; aoMudar: (f: number | null) => void; rotulo?: string }) {
  return <CampoNumero valor={valor === null ? null : Math.round(valor * 10000) / 100} casas={2} rotulo={rotulo} aoMudar={(n) => aoMudar(n === null ? null : n / 100)} />;
}

// --------------------------------------------------------- escolher equipamento

/** Lista vazia estável: um `[]` novo a cada desenho refaria a busca sem parar. */
const SEM_SUGESTAO: OpcaoDeEquipamento[] = [];

function descricaoDoUso(o: OpcaoDeEquipamento): string | null {
  if (!o.uso) return null;
  const partes = [`${br(o.uso.brasil)} usinas no Brasil desde 2023`];
  if (o.uso.sergipe) partes.push(`${br(o.uso.sergipe)} em Sergipe`);
  return partes.join(" · ");
}

function rotuloDaPotencia(l: LinhaDoKit): string {
  return l.tipo === "modulo" ? `${br(l.potenciaW)} W` : `${br(l.potenciaW / 1000, 2)} kW`;
}

function EscolherEquipamento({
  tipos,
  sugestoes,
  aoEscolher,
  rotulo,
}: {
  tipos: ("modulo" | "inversor" | "microinversor")[];
  sugestoes: OpcaoDeEquipamento[];
  aoEscolher: (l: LinhaDoKit) => void;
  rotulo: string;
}) {
  const [texto, setTexto] = useState("");
  const [lista, setLista] = useState<OpcaoDeEquipamento[]>(sugestoes);
  const [aberta, setAberta] = useState(false);
  const [manual, setManual] = useState(false);
  const [m, setM] = useState({ fabricante: "", modelo: "", potencia: null as number | null, entradas: null as number | null });
  const [, iniciar] = useTransition();
  const chaveTipos = tipos.join(",");

  useEffect(() => {
    if (!aberta) return;
    const t = setTimeout(() => {
      iniciar(async () => {
        setLista(texto.trim() ? await buscarEquipamentos(texto, chaveTipos.split(",") as typeof tipos) : sugestoes.length ? sugestoes : await buscarEquipamentos("", chaveTipos.split(",") as typeof tipos));
      });
    }, 250);
    return () => clearTimeout(t);
  }, [texto, aberta, chaveTipos, sugestoes]);

  const micro = tipos.length === 1 && tipos[0] === "microinversor";
  return (
    <div className="ap-escolha">
      <label className="ap-campo">
        {rotulo}
        <span style={{ position: "relative" }}>
          <input
            value={texto}
            placeholder="Fabricante, modelo ou potência: jinko 585, min 5000, hms 2000…"
            onFocus={() => setAberta(true)}
            onChange={(e) => {
              setTexto(e.target.value);
              setAberta(true);
            }}
          />
        </span>
        <small>
          A lista vem dos cadastros da ANEEL (os modelos instalados no Brasil) e do catálogo da empresa, que aparece primeiro.{" "}
          <button type="button" className="link-acao" onClick={() => setManual((v) => !v)}>
            {manual ? "Fechar" : "Não achou? Digite à mão"}
          </button>
        </small>
      </label>
      {aberta && !manual && (
        <div className="ap-escolha-lista" role="listbox">
          {lista.length === 0 && <p className="ap-explica" style={{ padding: "0.6rem 0.75rem" }}>Nada com esse nome.</p>}
          {lista.map((o) => (
            <button
              type="button"
              key={`${o.origem}-${o.linha.modeloId ?? o.linha.baseId}`}
              className="ap-escolha-item"
              onClick={() => {
                aoEscolher(o.linha);
                setAberta(false);
                setTexto("");
              }}
            >
              <span>
                <strong>{o.linha.fabricante}</strong> {o.linha.modelo}
              </span>
              <span>
                {o.origem === "catalogo" && <span className="ap-selo ap-selo-catalogo">no catálogo</span>}{" "}
                <span className="ap-selo">{rotuloDaPotencia(o.linha)}</span>
              </span>
              <small>
                {[
                  descricaoDoUso(o),
                  o.linha.tipo === "microinversor" && o.linha.modulosPorUnidade ? `${o.linha.modulosPorUnidade} módulos por micro` : null,
                  o.linha.fases ? (o.linha.fases === 1 ? "monofásico" : "trifásico") : null,
                  o.linha.precoUnitario !== null ? `custo ${moeda(o.linha.precoUnitario)}` : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </small>
            </button>
          ))}
        </div>
      )}
      {manual && (
        <div className="ap-grade">
          <label className="ap-campo">
            Fabricante
            <input value={m.fabricante} onChange={(e) => setM({ ...m, fabricante: e.target.value })} />
          </label>
          <label className="ap-campo">
            Modelo
            <input value={m.modelo} onChange={(e) => setM({ ...m, modelo: e.target.value })} />
          </label>
          <label className="ap-campo">
            Potência (W)
            <CampoNumero valor={m.potencia} inteiro aoMudar={(n) => setM({ ...m, potencia: n })} />
          </label>
          {micro && (
            <label className="ap-campo">
              Módulos por micro
              <CampoNumero valor={m.entradas} inteiro aoMudar={(n) => setM({ ...m, entradas: n })} />
            </label>
          )}
          <div className="ap-campo" style={{ justifyContent: "flex-end" }}>
            <button
              type="button"
              className="botao secundario"
              disabled={!m.modelo.trim() || !m.potencia}
              onClick={() => {
                aoEscolher({
                  modeloId: null,
                  baseId: null,
                  tipo: tipos[0],
                  fabricante: m.fabricante.trim(),
                  modelo: m.modelo.trim(),
                  potenciaW: m.potencia ?? 0,
                  qtd: 0,
                  precoUnitario: null,
                  modulosPorUnidade: micro ? m.entradas : null,
                  fases: null,
                });
                setManual(false);
              }}
            >
              <Plus size={14} aria-hidden /> Usar este
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ o gráfico

function GraficoGeracaoConsumo({ geracao, consumo }: { geracao: number[]; consumo: number[] }) {
  const W = 640;
  const H = 190;
  const topo = Math.max(1, ...geracao, ...consumo) * 1.1;
  const area = { x: 34, y: 10, w: W - 40, h: H - 34 };
  const grupo = area.w / 12;
  const y = (v: number) => area.y + area.h - (v / topo) * area.h;
  return (
    <svg className="ap-grafico" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Geração prevista e consumo, mês a mês">
      {[0, 0.25, 0.5, 0.75, 1].map((f) => (
        <g key={f}>
          <line x1={area.x} x2={area.x + area.w} y1={y(topo * f)} y2={y(topo * f)} stroke="currentColor" strokeOpacity={0.12} />
          <text x={area.x - 6} y={y(topo * f) + 3} textAnchor="end">
            {br(topo * f)}
          </text>
        </g>
      ))}
      {MESES.map((mes, i) => {
        const x = area.x + i * grupo + grupo * 0.14;
        const larg = grupo * 0.34;
        return (
          <g key={mes}>
            <rect className="ap-barra-geracao" x={x} y={y(geracao[i] ?? 0)} width={larg} height={area.y + area.h - y(geracao[i] ?? 0)} rx={3} />
            <rect className="ap-barra-consumo" x={x + larg + 2} y={y(consumo[i] ?? 0)} width={larg} height={area.y + area.h - y(consumo[i] ?? 0)} rx={3} />
            <text x={area.x + i * grupo + grupo / 2} y={H - 8} textAnchor="middle">
              {mes}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

// -------------------------------------------------------------- o assistente

type Candidato = InversorCandidato & { linha: LinhaDoKit };

export function AssistenteDaProposta({
  projetoId,
  origem,
  cliente,
  estadoInicial,
  contextoInicial,
  distribuidoras,
  responsaveis,
  candidatos,
  modulosSugeridos,
  telhados,
  ehAdm,
}: {
  projetoId: string;
  origem: "esteira" | "projeto";
  cliente: string;
  estadoInicial: EstadoDaProposta;
  contextoInicial: ContextoMontado;
  distribuidoras: { cnpj: string; nome: string; sigla: string }[];
  responsaveis: { id: string; nome: string }[];
  candidatos: Candidato[];
  modulosSugeridos: OpcaoDeEquipamento[];
  telhados: string[];
  ehAdm: boolean;
}) {
  const [e, setE] = useState<EstadoDaProposta>(estadoInicial);
  const [contexto, setContexto] = useState<ContextoMontado>(contextoInicial);
  const [salvoEm, setSalvoEm] = useState<string | null>(null);
  const [buscandoTarifa, setBuscandoTarifa] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [gerando, iniciarGeracao] = useTransition();
  const [cidades, setCidades] = useState<{ nome: string; uf: string }[]>([]);
  const estadoRef = useRef(e);
  estadoRef.current = e;

  const p = contexto.ctx.premissas;
  const r = useMemo(() => calcularAssistente(e, contexto.ctx), [e, contexto]);
  const mudar = (parcial: Partial<EstadoDaProposta>) => setE((v) => ({ ...v, ...parcial }));
  const mudarUc = (i: number, parcial: Partial<UcDoAssistente>) => setE((v) => ({ ...v, ucs: v.ucs.map((u, j) => (j === i ? { ...u, ...parcial } : u)) }));

  // Guarda o rascunho um pouco depois de cada mudança.
  const primeira = useRef(true);
  useEffect(() => {
    if (primeira.current) {
      primeira.current = false;
      return;
    }
    const t = setTimeout(async () => {
      const r2 = await salvarRascunhoDaProposta(projetoId, estadoRef.current);
      if (r2.ok) setSalvoEm(new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }));
    }, 2000);
    return () => clearTimeout(t);
  }, [e, projetoId]);

  // Cidade ou distribuidora mudou: sol, tarifa e distância de novo (a ANEEL só se o guardado venceu).
  const chaveDoContexto = `${e.cidade}|${e.uf}|${e.ucs.map((u) => chaveDaTarifa(u.distribuidoraCnpj, u.subgrupo)).join(",")}`;
  useEffect(() => {
    const t = setTimeout(async () => {
      setBuscandoTarifa(true);
      const c = await recalcularContexto(estadoRef.current, "buscar");
      setBuscandoTarifa(false);
      if (c) setContexto(c);
    }, 400);
    return () => clearTimeout(t);
  }, [chaveDoContexto]);

  async function buscarTarifaDeNovo() {
    setBuscandoTarifa(true);
    const c = await recalcularContexto(estadoRef.current, "forcar");
    setBuscandoTarifa(false);
    if (c) setContexto(c);
  }

  const irPara = (passo: number) => {
    mudar({ passo: Math.max(0, Math.min(PASSOS.length - 1, passo)) });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  // A cidade: busca enquanto digita.
  useEffect(() => {
    if (e.passo !== 0) return;
    const t = setTimeout(async () => setCidades(e.cidade.trim().length >= 2 ? await buscarCidades(e.cidade) : []), 250);
    return () => clearTimeout(t);
  }, [e.cidade, e.passo]);

  async function escolherCidade(c: { nome: string; uf: string }) {
    const dados = await dadosDaCidade(c.nome, c.uf);
    setCidades([]);
    setE((v) => {
      const d = dados?.distribuidoras[0];
      return {
        ...v,
        cidade: c.nome,
        uf: c.uf,
        ucs: v.ucs.map((u) => (u.distribuidoraCnpj || !d ? u : { ...u, distribuidoraCnpj: d.cnpj, distribuidoraNome: d.nome })),
      };
    });
  }

  // O kit: quantos módulos zeram as contas, e o inversor que combina.
  const sugestaoModulos = e.modulo && r.kwpNecessario ? modulosParaPotencia(r.kwpNecessario, e.modulo.potenciaW) : null;
  const geradora = e.ucs.find((u) => u.geradora) ?? e.ucs[0];
  function sugerirInversor(tipo = e.tipoInversor, modulo = e.modulo) {
    if (!modulo || !(modulo.qtd > 0)) return;
    const linha = sugerirInversores(
      { qtd: modulo.qtd, potenciaW: modulo.potenciaW },
      candidatos.filter((c) => c.tipo === tipo),
      p.sobredimensionamento,
      geradora.ligacao,
      tipo,
    );
    if (!linha) return;
    const c = candidatos.find((x) => x.id === linha[0].inversor.id);
    if (c) mudar({ inversores: [{ ...c.linha, qtd: linha[0].qtd }], tipoInversor: tipo });
  }
  useEffect(() => {
    if (e.passo === 3 && e.modulo && e.modulo.qtd > 0 && !e.inversores.length) sugerirInversor();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [e.passo]);

  const listaDistribuidoras = useMemo(() => {
    const daCidade = contexto.municipio?.distribuidoras.map((d) => d.cnpj) ?? [];
    const primeiras = distribuidoras.filter((d) => daCidade.includes(d.cnpj));
    const resto = distribuidoras.filter((d) => !daCidade.includes(d.cnpj)).sort((a, b) => a.nome.localeCompare(b.nome));
    return { primeiras, resto };
  }, [contexto.municipio, distribuidoras]);

  const infoTarifa = (u: UcDoAssistente) => contexto.tarifas.find((t) => t.chave === chaveDaTarifa(u.distribuidoraCnpj, u.subgrupo))?.tarifa ?? null;

  function gerar() {
    setErro(null);
    iniciarGeracao(async () => {
      const resposta = await gerarPropostaDoAssistente(projetoId, origem, estadoRef.current);
      if (resposta && "erro" in resposta) setErro(resposta.erro);
    });
  }

  const passoFeito = (i: number) => {
    if (i === 0) return Boolean(e.cidade);
    if (i === 1) return r.consumos.every((c) => c !== null);
    if (i === 2) return r.kwpNecessario !== null;
    if (i === 3) return Boolean(e.modulo?.qtd && e.inversores.some((x) => x.qtd > 0)) && !r.avisosDoKit.some((a) => a.nivel === "erro");
    if (i === 4) return Boolean(r.precoFinal);
    if (i === 5) return Boolean(r.simulacao);
    return false;
  };

  const s = r.simulacao;

  return (
    <div className="ap">
      {/* ---------------------------------------------------- a lateral */}
      <aside className="ap-lateral">
        <nav className="ap-passos" aria-label="Etapas da proposta">
          {PASSOS.map((nome, i) => (
            <button
              type="button"
              key={nome}
              className={`ap-passo${e.passo === i ? " ap-passo-ativo" : ""}${passoFeito(i) && e.passo !== i ? " ap-passo-feito" : ""}`}
              aria-current={e.passo === i ? "step" : undefined}
              onClick={() => irPara(i)}
            >
              <span className="ap-passo-num">{passoFeito(i) && e.passo !== i ? <Check size={13} aria-hidden /> : i + 1}</span>
              {nome}
            </button>
          ))}
        </nav>
        <div className="ap-vivo" aria-live="polite">
          <span className="ap-vivo-titulo">{cliente}</span>
          <div className="ap-vivo-linha">
            Consumo
            <strong>{kwh(s ? s.consumoAno / 12 : r.consumos[0] ? r.consumos[0].reduce((a, b) => a + b, 0) / 12 : null)}/mês</strong>
          </div>
          <div className="ap-vivo-linha">
            Para zerar
            <strong>{r.kwpNecessario ? kwpTexto(r.kwpNecessario) : "—"}</strong>
          </div>
          <div className="ap-vivo-linha">
            Kit
            <strong>{r.kwp ? kwpTexto(r.kwp) : "—"}</strong>
          </div>
          <div className="ap-vivo-linha">
            Preço
            <strong>{r.precoFinal ? moeda(r.precoFinal) : "—"}</strong>
          </div>
          <div className="ap-vivo-linha">
            Economia
            <strong>{s ? `${moeda(s.economiaMes)}/mês` : "—"}</strong>
          </div>
          <div className="ap-vivo-linha">
            Retorno
            <strong>{s ? rotuloDoPayback(s.paybackMeses) : "—"}</strong>
          </div>
          {r.margemFinal !== null && (
            <div className="ap-vivo-linha">
              Margem
              <strong style={{ color: r.margemFinal < 0.05 ? "var(--crit)" : undefined }}>{pct(r.margemFinal, 1)}</strong>
            </div>
          )}
          <span className="ap-salvo">{salvoEm ? `Rascunho guardado às ${salvoEm}` : "O rascunho é guardado sozinho."}</span>
        </div>
      </aside>

      {/* ---------------------------------------------------- as etapas */}
      <div className="ap-conteudo">
        {e.passo === 0 && (
          <section className="ap-secao">
            <h2>Cliente</h2>
            <p className="ap-explica">
              A cidade da instalação dá o sol de cada mês (Atlas Brasileiro de Energia Solar, do INPE, o mesmo do SunData do
              CRESESB) e sugere a distribuidora.
            </p>
            <div className="ap-grade">
              <div className="ap-escolha">
                <label className="ap-campo">
                  <span>
                    Cidade da instalação <span className="ap-req">*</span>
                  </span>
                  <input value={e.cidade} onChange={(ev) => mudar({ cidade: ev.target.value, uf: "" })} placeholder="Itabaiana" />
                  <small>{e.uf ? `${e.cidade}/${e.uf}` : "Escolha na lista para o sistema achar o sol e a distribuidora."}</small>
                </label>
                {cidades.length > 0 && !e.uf && (
                  <div className="ap-escolha-lista">
                    {cidades.map((c) => (
                      <button type="button" key={`${c.nome}-${c.uf}`} className="ap-escolha-item" onClick={() => escolherCidade(c)}>
                        <span>{c.nome}</span>
                        <span className="ap-selo">{c.uf}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <label className="ap-campo">
                Responsável pela proposta
                <select value={e.responsavelId ?? ""} onChange={(ev) => mudar({ responsavelId: ev.target.value || null })}>
                  {responsaveis.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.nome}
                    </option>
                  ))}
                </select>
                <small>Sai na capa e na última página, com o telefone do cadastro.</small>
              </label>
              <label className="ap-campo">
                Validade (dias)
                <CampoNumero valor={e.validadeDias ?? p.validadeDias} inteiro aoMudar={(n) => mudar({ validadeDias: n })} />
                <small>Sem prazo dito, o CDC (art. 40) vale 10 dias.</small>
              </label>
            </div>
            {contexto.municipio && (
              <div className="ap-tarifa">
                <span>
                  Sol em {contexto.municipio.nome}/{contexto.municipio.uf}: <strong>{br(contexto.municipio.irradiacaoAnual, 2)} kWh/m²·dia</strong> na média do ano
                </span>
                <span>
                  Distribuidora:{" "}
                  <strong>
                    {contexto.municipio.distribuidoras.map((d) => `${d.nome}${contexto.municipio!.distribuidoras.length > 1 ? ` (${d.participacao}%)` : ""}`).join(", ") || "—"}
                  </strong>
                </span>
                {contexto.ctx.distanciaKm !== null && <span>A {br(contexto.ctx.distanciaKm)} km da base da equipe</span>}
              </div>
            )}
          </section>
        )}

        {e.passo === 1 && (
          <section className="ap-secao">
            <div className="ap-secao-topo">
              <h2>Unidades consumidoras</h2>
              <button
                type="button"
                className="botao secundario"
                onClick={() =>
                  setE((v) => ({
                    ...v,
                    ucs: [...v.ucs, novaUc(v.ucs.length + 1, { distribuidoraCnpj: geradora.distribuidoraCnpj, distribuidoraNome: geradora.distribuidoraNome, id: `uc-${Date.now()}` })],
                  }))
                }
              >
                <Plus size={14} aria-hidden /> Nova unidade
              </button>
            </div>
            <p className="ap-explica">
              A geradora é onde a usina fica. Outras unidades do mesmo titular, na mesma distribuidora, recebem o excedente
              (autoconsumo remoto). A tarifa e o Fio B vêm da ANEEL, com os impostos da conta.
            </p>
            {e.ucs.map((u, i) => {
              const t = r.tarifas[i];
              const aneel = infoTarifa(u);
              return (
                <div key={u.id} className={`ap-uc${u.geradora ? " ap-uc-geradora" : ""}`}>
                  <div className="ap-uc-topo">
                    <label className="ap-campo" style={{ flex: 1, minWidth: 180 }}>
                      Nome
                      <input value={u.nome} onChange={(ev) => mudarUc(i, { nome: ev.target.value })} />
                    </label>
                    <span className="grupo-botoes">
                      {u.geradora ? (
                        <span className="ap-selo ap-selo-catalogo">Geradora</span>
                      ) : (
                        <button type="button" className="link-acao" onClick={() => setE((v) => ({ ...v, ucs: v.ucs.map((x, j) => ({ ...x, geradora: j === i })) }))}>
                          Tornar a geradora
                        </button>
                      )}
                      {e.ucs.length > 1 && (
                        <button
                          type="button"
                          className="ap-icone-botao"
                          aria-label={`Tirar ${u.nome}`}
                          onClick={() =>
                            setE((v) => {
                              const ucs = v.ucs.filter((_, j) => j !== i);
                              if (!ucs.some((x) => x.geradora)) ucs[0] = { ...ucs[0], geradora: true };
                              return { ...v, ucs };
                            })
                          }
                        >
                          <Trash2 size={15} aria-hidden />
                        </button>
                      )}
                    </span>
                  </div>
                  <div className="ap-grade">
                    <label className="ap-campo">
                      Código da unidade
                      <input value={u.codigo} inputMode="numeric" placeholder="Opcional" onChange={(ev) => mudarUc(i, { codigo: ev.target.value })} />
                    </label>
                    <label className="ap-campo">
                      <span>
                        Distribuidora <span className="ap-req">*</span>
                      </span>
                      <select
                        value={u.distribuidoraCnpj ?? ""}
                        onChange={(ev) => {
                          const d = distribuidoras.find((x) => x.cnpj === ev.target.value);
                          mudarUc(i, { distribuidoraCnpj: d?.cnpj ?? null, distribuidoraNome: d?.nome ?? "" });
                        }}
                      >
                        <option value="">Escolha…</option>
                        {listaDistribuidoras.primeiras.length > 0 && (
                          <optgroup label="Atendem a cidade">
                            {listaDistribuidoras.primeiras.map((d) => (
                              <option key={d.cnpj} value={d.cnpj}>
                                {d.nome} ({d.sigla})
                              </option>
                            ))}
                          </optgroup>
                        )}
                        <optgroup label="Todas">
                          {listaDistribuidoras.resto.map((d) => (
                            <option key={d.cnpj} value={d.cnpj}>
                              {d.nome} ({d.sigla})
                            </option>
                          ))}
                        </optgroup>
                      </select>
                    </label>
                    <label className="ap-campo">
                      Subgrupo
                      <select value={u.subgrupo} onChange={(ev) => mudarUc(i, { subgrupo: ev.target.value as Subgrupo })}>
                        {(Object.keys(ROTULO_SUBGRUPO) as Subgrupo[]).map((k) => (
                          <option key={k} value={k}>
                            {ROTULO_SUBGRUPO[k]}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="ap-campo">
                      Ligação
                      <select value={u.ligacao} onChange={(ev) => mudarUc(i, { ligacao: ev.target.value as Ligacao })}>
                        {(Object.keys(DISPONIBILIDADE_KWH) as Ligacao[]).map((l) => (
                          <option key={l} value={l}>
                            {ROTULO_LIGACAO[l]}
                          </option>
                        ))}
                      </select>
                      <small>O mínimo que a distribuidora cobra mesmo com a usina.</small>
                    </label>
                  </div>

                  <div className="ap-secao-topo">
                    <span className="ap-campo" style={{ margin: 0 }}>
                      <span>
                        Consumo <span className="ap-req">*</span>
                      </span>
                    </span>
                    <span className="ap-alternar" role="group" aria-label="Como informar o consumo">
                      <button type="button" aria-pressed={u.consumoModo === "media"} onClick={() => mudarUc(i, { consumoModo: "media" })}>
                        Média
                      </button>
                      <button type="button" aria-pressed={u.consumoModo === "mensal"} onClick={() => mudarUc(i, { consumoModo: "mensal" })}>
                        Mês a mês
                      </button>
                    </span>
                  </div>
                  {u.consumoModo === "media" ? (
                    <label className="ap-campo" style={{ maxWidth: 240 }}>
                      Consumo médio mensal (kWh)
                      <CampoNumero valor={u.consumoMedia} casas={1} placeholder="500" aoMudar={(n) => mudarUc(i, { consumoMedia: n })} />
                      <small>A média dos meses da conta de luz.</small>
                    </label>
                  ) : (
                    <>
                      <div className="ap-meses">
                        {MESES.map((mes, m) => (
                          <label key={mes}>
                            {mes}
                            <CampoNumero
                              valor={u.consumoMeses[m] ?? null}
                              casas={0}
                              rotulo={`Consumo de ${mes}`}
                              aoMudar={(n) => mudarUc(i, { consumoMeses: u.consumoMeses.map((v, j) => (j === m ? n : v)) })}
                            />
                          </label>
                        ))}
                      </div>
                      <small className="ap-explica">O histórico da conta de luz (13 meses numa página). Mês em branco recebe a média dos outros.</small>
                    </>
                  )}

                  <div className="ap-tarifa">
                    <span>
                      Tarifa: <strong>{moeda(t.tarifa)}/kWh</strong>
                    </span>
                    <span>
                      Fio B: <strong>{moeda(t.fioB)}/kWh</strong>
                    </span>
                    <span>
                      {t.origem === "aneel" && aneel
                        ? `ANEEL ${aneel.resolucao?.replace(/^RESOLUÇÃO HOMOLOGATÓRIA\s*/i, "REH ").replace(/,? DE .*$/i, "") ?? ""}, em vigor desde ${aneel.vigenciaInicio.split("-").reverse().join("/")}, com ${pct(p.tributos.icms)} de ICMS e ${pct(p.tributos.pisCofins)} de PIS/COFINS${aneel.guardada ? " (a guardada: a ANEEL não respondeu agora)" : ""}`
                        : t.origem === "manual"
                          ? "digitada à mão"
                          : u.distribuidoraCnpj
                            ? buscandoTarifa
                              ? "buscando na ANEEL…"
                              : "sem resposta da ANEEL: vale a tarifa manual das premissas"
                            : "escolha a distribuidora para buscar na ANEEL"}
                    </span>
                    {u.distribuidoraCnpj && (
                      <button type="button" className="link-acao" onClick={buscarTarifaDeNovo} disabled={buscandoTarifa}>
                        <RefreshCw size={12} aria-hidden /> Buscar de novo
                      </button>
                    )}
                  </div>
                  <details>
                    <summary className="ap-explica">Usar outra tarifa (cooperativa, tarifa diferente na conta)</summary>
                    <div className="ap-grade" style={{ marginTop: "0.5rem" }}>
                      <label className="ap-campo">
                        Tarifa com impostos (R$/kWh)
                        <CampoNumero valor={u.tarifaManual} casas={4} placeholder={br(t.tarifa, 4)} aoMudar={(n) => mudarUc(i, { tarifaManual: n })} />
                      </label>
                      <label className="ap-campo">
                        Fio B com impostos (R$/kWh)
                        <CampoNumero valor={u.fioBManual} casas={4} placeholder={br(t.fioB, 4)} aoMudar={(n) => mudarUc(i, { fioBManual: n })} />
                      </label>
                    </div>
                  </details>
                </div>
              );
            })}

            {e.ucs.length > 1 && (
              <div className="ap-uc">
                <div className="ap-secao-topo">
                  <h3 style={{ margin: 0 }}>Rateio do excedente</h3>
                  <span className="ap-alternar" role="group" aria-label="Sistema de rateio">
                    <button type="button" aria-pressed={e.rateio === "percentual"} onClick={() => mudar({ rateio: "percentual" })}>
                      Porcentagem
                    </button>
                    <button type="button" aria-pressed={e.rateio === "prioridade"} onClick={() => mudar({ rateio: "prioridade" })}>
                      Fila de prioridade
                    </button>
                  </span>
                </div>
                <p className="ap-explica">
                  {e.rateio === "percentual"
                    ? "Cada beneficiária fica com uma parte fixa do que sobra da geradora; a geradora fica com o resto. É o que vai no formulário de compensação da distribuidora."
                    : "O que sobra vai enchendo a primeira da fila até zerar a conta dela, depois a segunda, e assim por diante."}
                </p>
                {e.ucs.map((u, i) =>
                  u.geradora ? null : (
                    <div key={u.id} className="ap-secao-topo">
                      <span>{u.nome}</span>
                      {e.rateio === "percentual" ? (
                        <label className="ap-campo" style={{ width: 140 }}>
                          % do excedente
                          <CampoPercentual valor={u.percentual} aoMudar={(f) => mudarUc(i, { percentual: f })} />
                        </label>
                      ) : (
                        <span className="grupo-botoes">
                          <button
                            type="button"
                            className="ap-icone-botao"
                            aria-label="Subir na fila"
                            disabled={i <= 1}
                            onClick={() => setE((v) => {
                              const ucs = [...v.ucs];
                              [ucs[i - 1], ucs[i]] = [ucs[i], ucs[i - 1]];
                              return { ...v, ucs };
                            })}
                          >
                            <ArrowUp size={14} aria-hidden />
                          </button>
                          <button
                            type="button"
                            className="ap-icone-botao"
                            aria-label="Descer na fila"
                            disabled={i === e.ucs.length - 1}
                            onClick={() => setE((v) => {
                              const ucs = [...v.ucs];
                              [ucs[i + 1], ucs[i]] = [ucs[i], ucs[i + 1]];
                              return { ...v, ucs };
                            })}
                          >
                            <ArrowDown size={14} aria-hidden />
                          </button>
                        </span>
                      )}
                    </div>
                  ),
                )}
                {e.rateio === "percentual" && (
                  <p className="ap-explica">
                    A geradora fica com{" "}
                    <strong>{pct(Math.max(0, 1 - e.ucs.filter((u) => !u.geradora).reduce((a, u) => a + (u.percentual ?? 0), 0)))}</strong> do excedente.
                  </p>
                )}
              </div>
            )}
          </section>
        )}

        {e.passo === 2 && (
          <section className="ap-secao">
            <h2>Dimensionamento do sistema</h2>
            <div className="ap-grade">
              <label className="ap-campo">
                Perfil de desempenho
                <select
                  value={p.perfisDesempenho.some((x) => x.nome === e.perfilDesempenho) ? e.perfilDesempenho! : "__outro"}
                  onChange={(ev) => {
                    const perfil = p.perfisDesempenho.find((x) => x.nome === ev.target.value);
                    mudar(perfil ? { perfilDesempenho: perfil.nome, desempenho: perfil.valor } : { perfilDesempenho: null });
                  }}
                >
                  {p.perfisDesempenho.map((x) => (
                    <option key={x.nome} value={x.nome}>
                      {x.nome} — {pct(x.valor)}
                    </option>
                  ))}
                  <option value="__outro">Outro valor</option>
                </select>
                <small>Perdas de inversor, cabos, calor, sujeira e orientação. 75% = 25% de perdas.</small>
              </label>
              {!p.perfisDesempenho.some((x) => x.nome === e.perfilDesempenho) && (
                <label className="ap-campo">
                  Desempenho (%)
                  <CampoPercentual valor={e.desempenho} aoMudar={(f) => f !== null && f >= 0.5 && f <= 0.95 && mudar({ desempenho: f })} />
                </label>
              )}
              <label className="ap-campo">
                Perfil de simultaneidade
                <select
                  value={p.perfisSimultaneidade.some((x) => x.nome === e.perfilSimultaneidade) ? e.perfilSimultaneidade! : "__outro"}
                  onChange={(ev) => {
                    const perfil = p.perfisSimultaneidade.find((x) => x.nome === ev.target.value);
                    mudar(perfil ? { perfilSimultaneidade: perfil.nome, simultaneidade: perfil.valor } : { perfilSimultaneidade: null });
                  }}
                >
                  {p.perfisSimultaneidade.map((x) => (
                    <option key={x.nome} value={x.nome}>
                      {x.nome} — {pct(x.valor)}
                    </option>
                  ))}
                  <option value="__outro">Outro valor</option>
                </select>
                <small>O que a casa gasta na hora em que a usina gera: não paga Fio B nem vira crédito.</small>
              </label>
              {!p.perfisSimultaneidade.some((x) => x.nome === e.perfilSimultaneidade) && (
                <label className="ap-campo">
                  Simultaneidade (%)
                  <CampoPercentual valor={e.simultaneidade} aoMudar={(f) => f !== null && f <= 1 && mudar({ simultaneidade: f })} />
                </label>
              )}
              <label className="ap-campo">
                Tipo de telhado
                <select value={e.telhado ?? ""} onChange={(ev) => mudar({ telhado: ev.target.value || null })}>
                  <option value="">A definir na vistoria</option>
                  {telhados.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
                <small>Alguns custos dependem dele (estrutura de laje, por exemplo).</small>
              </label>
            </div>

            <div className="ap-secao-topo">
              <h3 style={{ margin: 0 }}>Sol de cada mês (kWh/m²·dia)</h3>
              <button type="button" className="link-acao" onClick={() => mudar({ irradiacaoManual: e.irradiacaoManual ? null : [...r.irradiacao] })}>
                {e.irradiacaoManual ? "Voltar ao do Atlas" : "Ajustar à mão"}
              </button>
            </div>
            <div className="ap-meses">
              {MESES.map((mes, m) => (
                <label key={mes}>
                  {mes}
                  {e.irradiacaoManual ? (
                    <CampoNumero
                      valor={e.irradiacaoManual[m]}
                      casas={2}
                      rotulo={`Irradiação de ${mes}`}
                      aoMudar={(n) => n !== null && n >= 0.5 && n <= 12 && mudar({ irradiacaoManual: e.irradiacaoManual!.map((v, j) => (j === m ? n : v)) })}
                    />
                  ) : (
                    <strong>{br(r.irradiacao[m], 2)}</strong>
                  )}
                </label>
              ))}
            </div>
            <p className="ap-explica">
              {e.irradiacaoManual
                ? "Valores digitados à mão."
                : contexto.fonteIrradiacao ?? `A cidade não foi achada no Atlas: vale a irradiação das premissas (${br(p.irradiacaoDia, 2)}).`}{" "}
              Média do ano: <strong>{br(r.irradiacaoAnual, 2)}</strong>.
            </p>

            <div className="ap-numeros">
              <div className="ap-numero">
                <span>Consumo que dá para compensar</span>
                <strong>
                  {kwh(
                    e.ucs.reduce((a, u, i) => a + Math.max(0, (r.consumos[i]?.reduce((x, y) => x + y, 0) ?? 0) / 12 - DISPONIBILIDADE_KWH[u.ligacao]), 0),
                  )}
                  /mês
                </strong>
              </div>
              <div className="ap-numero">
                <span>Cada kWp gera</span>
                <strong>{kwh((r.irradiacaoAnual * 365 * e.desempenho) / 12)}/mês</strong>
              </div>
              <div className="ap-numero">
                <span>Potência que zera as contas</span>
                <strong>{r.kwpNecessario ? kwpTexto(r.kwpNecessario) : "—"}</strong>
              </div>
            </div>
          </section>
        )}

        {e.passo === 3 && (
          <>
            <section className="ap-secao">
              <h2>Módulos</h2>
              {e.modulo ? (
                <div className="ap-kit-linha">
                  <div className="ap-kit-nome">
                    <strong>
                      {e.modulo.fabricante} {e.modulo.modelo}
                    </strong>
                    <small>
                      {rotuloDaPotencia(e.modulo)}
                      {sugestaoModulos ? ` · ${sugestaoModulos} módulos zeram as contas (${kwpTexto((sugestaoModulos * e.modulo.potenciaW) / 1000)})` : ""}
                    </small>
                  </div>
                  <label className="ap-campo">
                    Quantidade
                    <CampoNumero valor={e.modulo.qtd || null} inteiro aoMudar={(n) => mudar({ modulo: { ...e.modulo!, qtd: n ?? 0 } })} />
                  </label>
                  <label className="ap-campo">
                    Custo unitário (R$)
                    <CampoNumero valor={e.modulo.precoUnitario} aoMudar={(n) => mudar({ modulo: { ...e.modulo!, precoUnitario: n } })} />
                  </label>
                  <span className="grupo-botoes">
                    {sugestaoModulos && sugestaoModulos !== e.modulo.qtd && (
                      <button type="button" className="botao secundario" onClick={() => mudar({ modulo: { ...e.modulo!, qtd: sugestaoModulos } })}>
                        <Sparkles size={14} aria-hidden /> Usar {sugestaoModulos}
                      </button>
                    )}
                    <button type="button" className="ap-icone-botao" aria-label="Trocar o módulo" onClick={() => mudar({ modulo: null })}>
                      <Trash2 size={15} aria-hidden />
                    </button>
                  </span>
                </div>
              ) : (
                <EscolherEquipamento
                  tipos={["modulo"]}
                  sugestoes={modulosSugeridos}
                  rotulo="Escolha o módulo"
                  aoEscolher={(l) => {
                    const qtd = r.kwpNecessario ? modulosParaPotencia(r.kwpNecessario, l.potenciaW) : 1;
                    mudar({ modulo: { ...l, qtd } });
                  }}
                />
              )}
            </section>

            <section className="ap-secao">
              <div className="ap-secao-topo">
                <h2>Inversor</h2>
                <span className="ap-alternar" role="group" aria-label="Tipo de inversor">
                  <button type="button" aria-pressed={e.tipoInversor === "inversor"} onClick={() => { mudar({ tipoInversor: "inversor", inversores: [] }); }}>
                    Inversor de string
                  </button>
                  <button type="button" aria-pressed={e.tipoInversor === "microinversor"} onClick={() => { mudar({ tipoInversor: "microinversor", inversores: [] }); }}>
                    Microinversor
                  </button>
                </span>
              </div>
              {e.inversores.map((l, i) => (
                <div key={`${l.modeloId ?? l.baseId ?? l.modelo}-${i}`} className="ap-kit-linha">
                  <div className="ap-kit-nome">
                    <strong>
                      {l.fabricante} {l.modelo}
                    </strong>
                    <small>
                      {[rotuloDaPotencia(l), l.fases ? (l.fases === 1 ? "monofásico" : "trifásico") : null, l.tipo === "microinversor" && l.modulosPorUnidade ? `${l.modulosPorUnidade} módulos por micro` : null]
                        .filter(Boolean)
                        .join(" · ")}
                    </small>
                  </div>
                  <label className="ap-campo">
                    Quantidade
                    <CampoNumero valor={l.qtd || null} inteiro aoMudar={(n) => mudar({ inversores: e.inversores.map((x, j) => (j === i ? { ...x, qtd: n ?? 0 } : x)) })} />
                  </label>
                  <label className="ap-campo">
                    Custo unitário (R$)
                    <CampoNumero valor={l.precoUnitario} aoMudar={(n) => mudar({ inversores: e.inversores.map((x, j) => (j === i ? { ...x, precoUnitario: n } : x)) })} />
                  </label>
                  <button type="button" className="ap-icone-botao" aria-label="Tirar" onClick={() => mudar({ inversores: e.inversores.filter((_, j) => j !== i) })}>
                    <Trash2 size={15} aria-hidden />
                  </button>
                </div>
              ))}
              <div className="ap-secao-topo">
                <button type="button" className="botao secundario" disabled={!e.modulo?.qtd} onClick={() => sugerirInversor()}>
                  <Sparkles size={14} aria-hidden /> Sugerir {e.tipoInversor === "microinversor" ? "os micros" : "o inversor"}
                </button>
                <span className="ap-explica">
                  Pela relação CC/CA (alvo {br(p.sobredimensionamento.alvo, 2)}, máximo {br(p.sobredimensionamento.maximo, 2)}), as fases da ligação e o que
                  mais se instala em Sergipe.
                </span>
              </div>
              <EscolherEquipamento
                tipos={[e.tipoInversor]}
                sugestoes={SEM_SUGESTAO}
                rotulo={e.inversores.length ? "Acrescentar outro" : "Ou escolha na lista"}
                aoEscolher={(l) => {
                  const qtd = l.tipo === "microinversor" && l.modulosPorUnidade && e.modulo?.qtd ? Math.ceil(e.modulo.qtd / l.modulosPorUnidade) : 1;
                  mudar({ inversores: [...e.inversores, { ...l, qtd }] });
                }}
              />
              {r.avisosDoKit.length > 0 && (
                <div className="ap-avisos">
                  {r.avisosDoKit.map((a) => (
                    <p key={a.texto} className={`ap-aviso ap-aviso-${a.nivel}`}>
                      {a.texto}
                    </p>
                  ))}
                </div>
              )}
            </section>

            <section className="ap-secao">
              <div className="ap-secao-topo">
                <h2>Outros itens do kit</h2>
                <button type="button" className="botao secundario" onClick={() => mudar({ outrosItens: [...e.outrosItens, { nome: "", qtd: 1, precoUnitario: null }] })}>
                  <Plus size={14} aria-hidden /> Item
                </button>
              </div>
              <p className="ap-explica">Estrutura, string box, cabos CC e conectores, quando o kit do distribuidor não traz.</p>
              {e.outrosItens.map((o, i) => (
                <div key={i} className="ap-kit-linha">
                  <label className="ap-campo">
                    Item
                    <input value={o.nome} placeholder="Estrutura fibrocimento" onChange={(ev) => mudar({ outrosItens: e.outrosItens.map((x, j) => (j === i ? { ...x, nome: ev.target.value } : x)) })} />
                  </label>
                  <label className="ap-campo">
                    Quantidade
                    <CampoNumero valor={o.qtd} inteiro aoMudar={(n) => mudar({ outrosItens: e.outrosItens.map((x, j) => (j === i ? { ...x, qtd: n ?? 0 } : x)) })} />
                  </label>
                  <label className="ap-campo">
                    Custo unitário (R$)
                    <CampoNumero valor={o.precoUnitario} aoMudar={(n) => mudar({ outrosItens: e.outrosItens.map((x, j) => (j === i ? { ...x, precoUnitario: n } : x)) })} />
                  </label>
                  <button type="button" className="ap-icone-botao" aria-label="Tirar o item" onClick={() => mudar({ outrosItens: e.outrosItens.filter((_, j) => j !== i) })}>
                    <Trash2 size={15} aria-hidden />
                  </button>
                </div>
              ))}
              <div className="ap-numeros">
                <div className="ap-numero">
                  <span>Potência do kit</span>
                  <strong>{r.kwp ? kwpTexto(r.kwp) : "—"}</strong>
                </div>
                <div className="ap-numero">
                  <span>Relação CC/CA</span>
                  <strong>{r.relacaoCcCa ? br(r.relacaoCcCa, 2) : "—"}</strong>
                </div>
                <div className="ap-numero">
                  <span>Área de telhado</span>
                  <strong>{r.areaM2 ? `${br(r.areaM2)} m²` : "—"}</strong>
                </div>
                <div className="ap-numero">
                  <span>Cobre do consumo</span>
                  <strong>{r.kwpNecessario && r.kwp ? pct(r.kwp / r.kwpNecessario) : "—"}</strong>
                </div>
              </div>
            </section>
          </>
        )}

        {e.passo === 4 && (
          <section className="ap-secao">
            <h2>Custos e preço</h2>
            <div className="ap-grade">
              <label className="ap-campo">
                Custo do kit (R$)
                <CampoNumero valor={e.custoKitManual} placeholder={r.custoKit !== null && e.custoKitManual === null ? br(r.custoKit, 2) : "Total do distribuidor"} aoMudar={(n) => mudar({ custoKitManual: n })} />
                <small>
                  {e.custoKitManual !== null
                    ? "Total digitado (vale sobre a soma dos itens)."
                    : r.custoKit !== null
                      ? `Soma dos custos unitários do kit: ${moeda(r.custoKit)}. Digite o total do distribuidor, se preferir.`
                      : "Digite o total do kit, ou o custo de cada item na etapa Kit."}
                </small>
              </label>
            </div>

            {r.preco ? (
              <>
                <div className="tabela-wrap">
                  <table className="tabela ap-custos">
                    <thead>
                      <tr>
                        <th>Entra no preço</th>
                        <th>Custo</th>
                        <th>Valor (R$)</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td>
                          <input type="checkbox" checked disabled aria-label="Kit" />
                        </td>
                        <td>Kit (módulos, inversores e itens)</td>
                        <td>{moeda(r.preco.linhas[0].valor)}</td>
                      </tr>
                      {[...p.precificacao.itens.map((i) => ({ id: i.id, nome: i.nome })), ...(r.preco.linhas.some((l) => l.id === "logistica") || e.ajustesDeCusto.logistica ? [{ id: "logistica", nome: "Deslocamento além do raio" }] : [])].map((item) => {
                        const ajuste = e.ajustesDeCusto[item.id] ?? {};
                        const linha = r.preco!.linhas.find((l) => l.id === item.id);
                        const ativo = ajuste.ativo !== false;
                        return (
                          <tr key={item.id}>
                            <td>
                              <input
                                type="checkbox"
                                checked={ativo}
                                aria-label={`Incluir ${item.nome}`}
                                onChange={(ev) => mudar({ ajustesDeCusto: { ...e.ajustesDeCusto, [item.id]: { ...ajuste, ativo: ev.target.checked } } })}
                              />
                            </td>
                            <td>{linha?.nome ?? item.nome}</td>
                            <td>
                              {ativo ? (
                                <CampoNumero
                                  valor={ajuste.valor ?? linha?.valor ?? 0}
                                  rotulo={`Valor de ${item.nome}`}
                                  aoMudar={(n) => {
                                    const novo = { ...ajuste };
                                    if (n === null) delete novo.valor;
                                    else novo.valor = n;
                                    mudar({ ajustesDeCusto: { ...e.ajustesDeCusto, [item.id]: novo } });
                                  }}
                                />
                              ) : (
                                "—"
                              )}
                            </td>
                          </tr>
                        );
                      })}
                      {e.custosExtras.map((x, i) => (
                        <tr key={`extra-${i}`}>
                          <td>
                            <button type="button" className="ap-icone-botao" aria-label="Tirar o custo" onClick={() => mudar({ custosExtras: e.custosExtras.filter((_, j) => j !== i) })}>
                              <Trash2 size={14} aria-hidden />
                            </button>
                          </td>
                          <td>
                            <input value={x.nome} placeholder="Custo avulso" onChange={(ev) => mudar({ custosExtras: e.custosExtras.map((y, j) => (j === i ? { ...y, nome: ev.target.value } : y)) })} />
                          </td>
                          <td>
                            <CampoNumero valor={x.valor} aoMudar={(n) => mudar({ custosExtras: e.custosExtras.map((y, j) => (j === i ? { ...y, valor: n ?? 0 } : y)) })} />
                          </td>
                        </tr>
                      ))}
                      <tr className="ap-total">
                        <td colSpan={2}>Custo total</td>
                        <td>{moeda(r.preco.custoTotal)}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                <button type="button" className="link-acao" onClick={() => mudar({ custosExtras: [...e.custosExtras, { nome: "", valor: 0 }] })}>
                  <Plus size={13} aria-hidden /> Custo avulso nesta proposta (troca de padrão, reforço de telhado…)
                </button>
                <p className="ap-explica">
                  Margem de {pct(p.precificacao.margem)} e imposto de {pct(p.precificacao.imposto)}{" "}
                  {p.precificacao.margemPorDentro ? "por dentro do preço" : "(margem por fora do custo)"}: preço sugerido{" "}
                  <strong>{moeda(r.preco.precoSugerido)}</strong>.{" "}
                  {ehAdm && (
                    <Link href="/administracao/proposta" className="link-acao">
                      Mudar custos e margem
                    </Link>
                  )}
                </p>
              </>
            ) : (
              <p className="ap-aviso ap-aviso-atencao">Sem o custo do kit não dá para sugerir o preço. Digite o custo acima, ou o preço de venda abaixo.</p>
            )}

            <div className="ap-grade">
              <label className="ap-campo">
                Preço de venda (R$)
                <CampoNumero valor={r.precoFinal} aoMudar={(n) => mudar({ precoFinal: n && n > 0 ? n : null })} />
                <small>
                  {e.precoFinal !== null && r.preco ? (
                    <>
                      Escolhido à mão.{" "}
                      <button type="button" className="link-acao" onClick={() => mudar({ precoFinal: null })}>
                        Voltar ao sugerido
                      </button>
                    </>
                  ) : (
                    "O sugerido pela margem. Mude para dar desconto."
                  )}
                </small>
              </label>
            </div>
            {r.precoFinal && (
              <div className="ap-numeros">
                <div className="ap-numero">
                  <span>Preço por Wp</span>
                  <strong>{r.kwp ? moeda(r.precoFinal / (r.kwp * 1000)) : "—"}</strong>
                </div>
                {r.preco && (
                  <>
                    <div className="ap-numero">
                      <span>Margem que sobra</span>
                      <strong style={{ color: r.margemFinal !== null && r.margemFinal < 0.05 ? "var(--crit)" : undefined }}>{pct(r.margemFinal, 1)}</strong>
                    </div>
                    <div className="ap-numero">
                      <span>Lucro</span>
                      <strong>{moeda(r.precoFinal - r.preco.custoTotal - r.precoFinal * p.precificacao.imposto)}</strong>
                    </div>
                  </>
                )}
              </div>
            )}
          </section>
        )}

        {e.passo === 5 && (
          <section className="ap-secao">
            <h2>Resumo</h2>
            {s ? (
              <>
                <div className="ap-numeros">
                  <div className="ap-numero">
                    <span>Potência</span>
                    <strong>{kwpTexto(r.kwp)}</strong>
                  </div>
                  <div className="ap-numero">
                    <span>Geração média</span>
                    <strong>{kwh(s.geracaoMediaMes)}/mês</strong>
                  </div>
                  <div className="ap-numero">
                    <span>Conta hoje → com a usina</span>
                    <strong>
                      {moeda(s.contaSemMes)} → {moeda(s.contaComMes)}
                    </strong>
                  </div>
                  <div className="ap-numero">
                    <span>Economia</span>
                    <strong>{moeda(s.economiaMes)}/mês</strong>
                  </div>
                  <div className="ap-numero">
                    <span>Retorno (simples · descontado)</span>
                    <strong>
                      {rotuloDoPayback(s.paybackMeses)} · {rotuloDoPayback(s.paybackDescontadoMeses)}
                    </strong>
                  </div>
                  <div className="ap-numero">
                    <span>TIR · VPL</span>
                    <strong>
                      {s.tir === null ? "—" : `${pct(s.tir, 1)} a.a.`} · {moeda(s.vpl)}
                    </strong>
                  </div>
                  <div className="ap-numero">
                    <span>Economia em 25 anos</span>
                    <strong>{moeda(s.economia25)}</strong>
                  </div>
                  <div className="ap-numero">
                    <span>Custo do kWh gerado</span>
                    <strong>{s.custoKwh === null ? "—" : moeda(s.custoKwh)}</strong>
                  </div>
                </div>
                {s.cobertura > 1.25 && (
                  <p className="ap-aviso ap-aviso-atencao">
                    A usina gera {pct(s.cobertura)} do que as unidades conseguem compensar: sobram {kwh(s.sobraCreditosAno1)} de crédito no
                    primeiro ano, que vencem em 60 meses. Vale diminuir o kit ou pôr outra unidade no rateio.
                  </p>
                )}
                {s.cobertura > 0 && s.cobertura < 0.8 && (
                  <p className="ap-aviso ap-aviso-atencao">A usina cobre {pct(s.cobertura)} do consumo que dá para compensar: a conta não chega ao mínimo.</p>
                )}
                <GraficoGeracaoConsumo geracao={s.geracaoMes} consumo={s.consumoMes} />
                <p className="ap-explica">
                  <span style={{ color: "var(--energia)" }}>■</span> geração prevista · <span style={{ color: "var(--line)" }}>■</span> consumo
                </p>
                <div className="tabela-wrap">
                  <table className="tabela">
                    <thead>
                      <tr>
                        <th>Unidade</th>
                        <th>Consumo/mês</th>
                        <th>Conta hoje</th>
                        <th>Com a usina</th>
                        <th>Economia/mês</th>
                        <th>Crédito sobrando</th>
                      </tr>
                    </thead>
                    <tbody>
                      {s.ucs.map((u) => (
                        <tr key={u.id}>
                          <td>
                            {u.nome}
                            {u.geradora ? " (geradora)" : ""}
                          </td>
                          <td>{kwh(u.consumoAno / 12)}</td>
                          <td>{moeda(u.contaSemMes)}</td>
                          <td>{moeda(u.contaComMes)}</td>
                          <td>{moeda(u.economiaMes)}</td>
                          <td>{kwh(u.creditosFimAno1)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            ) : (
              <p className="ap-aviso ap-aviso-atencao">Ainda falta: {r.falta.join(", ")}.</p>
            )}
          </section>
        )}

        {e.passo === 6 && (
          <section className="ap-secao">
            <h2>Gerar a proposta</h2>
            {r.formas && (
              <div className="ap-numeros">
                <div className="ap-numero">
                  <span>À vista</span>
                  <strong>{moeda(r.formas.aVista.valor)}</strong>
                </div>
                {r.formas.cartao?.opcoes.map((o) => (
                  <div key={`c${o.parcelas}`} className="ap-numero">
                    <span>Cartão em {o.parcelas}x</span>
                    <strong>{moeda(o.valorParcela)}</strong>
                  </div>
                ))}
                {r.formas.financiamentos.map((f) =>
                  f.opcoes.slice(-2).map((o) => (
                    <div key={`${f.nome}${o.parcelas}`} className="ap-numero">
                      <span>
                        {f.nome} em {o.parcelas}x
                      </span>
                      <strong>{moeda(o.valorParcela)}</strong>
                    </div>
                  )),
                )}
              </div>
            )}
            <label className="ap-campo">
              Observações para o cliente
              <textarea rows={3} maxLength={600} value={e.observacoes} placeholder="Inclui a troca do padrão de entrada." onChange={(ev) => mudar({ observacoes: ev.target.value })} />
              <small>Saem na página do investimento.</small>
            </label>
            {r.falta.length > 0 ? (
              <p className="ap-aviso ap-aviso-erro">Ainda falta: {r.falta.join(", ")}.</p>
            ) : (
              <p className="ap-aviso ap-aviso-ok">
                Tudo pronto. A proposta sai em PDF de 7 páginas, numerada, com o link para o WhatsApp; o valor, a potência, o consumo
                e o kit vão para o projeto (o contrato e o dossiê leem de lá).
              </p>
            )}
            {erro && (
              <p className="aviso erro" role="alert">
                {erro}
              </p>
            )}
            <div className="barra-enviar">
              <button type="button" className="botao" disabled={gerando || r.falta.length > 0} onClick={gerar}>
                <FileCheck2 size={15} aria-hidden /> {gerando ? "Gerando…" : "Gerar a proposta"}
              </button>
            </div>
          </section>
        )}

        <div className="ap-rodape">
          <button type="button" className="botao secundario" disabled={e.passo === 0} onClick={() => irPara(e.passo - 1)}>
            <ArrowLeft size={15} aria-hidden /> Voltar
          </button>
          <span className="grupo-botoes">
            <Link href={origem === "esteira" ? "/esteira" : `/projeto/${projetoId}`} className="botao secundario">
              Salvar e sair
            </Link>
            {e.passo < PASSOS.length - 1 && (
              <button type="button" className="botao" onClick={() => irPara(e.passo + 1)}>
                Próximo passo <ArrowRight size={15} aria-hidden />
              </button>
            )}
          </span>
        </div>
        <p className="ap-explica" style={{ textAlign: "right" }}>
          <Search size={12} aria-hidden /> Equipamentos: cadastros públicos da ANEEL (ODbL) e lista da CEC. Sol: Atlas do INPE.
          Tarifas: dados abertos da ANEEL.
        </p>
      </div>
    </div>
  );
}
