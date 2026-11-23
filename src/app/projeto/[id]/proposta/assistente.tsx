"use client";

import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Camera,
  ChartColumn,
  ChevronDown,
  CircleCheck,
  Clock,
  FileCheck2,
  FolderOpen,
  House,
  MapPin,
  Phone,
  Plus,
  RefreshCw,
  ScanLine,
  Send,
  Sparkles,
  SunMedium,
  Trash2,
  UserRound,
  Users,
  Wallet,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";

import {
  calcularAssistente,
  chaveDaTarifa,
  kitAutomatico,
  novaUc,
  ucComConta,
  type ContaDeLuzLida,
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
  lerContaDoDossie,
  lerContaEnviada,
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
const moedaCurta = (n: number) => (n >= 1e6 ? `R$ ${br(n / 1e6, 1)} mi` : n >= 1e4 ? `R$ ${br(n / 1e3)} mil` : moeda(n));

/** "Maria José da Silva" → "MS". */
function iniciais(nome: string): string {
  const p = nome.trim().split(/\s+/).filter((x) => !/^(da|de|do|das|dos|e)$/i.test(x));
  return ((p[0]?.[0] ?? "") + (p.length > 1 ? (p[p.length - 1][0] ?? "") : "")).toUpperCase();
}

/**
 * A foto do celular (3 a 8 MB) encolhida antes de subir: até 2.000 px no lado
 * maior, em JPEG. Os números da conta continuam legíveis, o envio fica rápido
 * no 4G e cabe no limite de 5 MB por imagem da API. PDF e o que não der para
 * desenhar seguem como vieram.
 */
async function fotoMenor(arquivo: File): Promise<File> {
  if (!/^image\/(jpeg|png|webp)$/.test(arquivo.type) || arquivo.size < 1.5 * 1024 * 1024) return arquivo;
  try {
    const imagem = await createImageBitmap(arquivo, { imageOrientation: "from-image" });
    const escala = Math.min(1, 2000 / Math.max(imagem.width, imagem.height));
    const tela = document.createElement("canvas");
    tela.width = Math.round(imagem.width * escala);
    tela.height = Math.round(imagem.height * escala);
    tela.getContext("2d")?.drawImage(imagem, 0, 0, tela.width, tela.height);
    imagem.close();
    const blob = await new Promise<Blob | null>((ok) => tela.toBlob(ok, "image/jpeg", 0.85));
    return blob && blob.size < arquivo.size ? new File([blob], arquivo.name.replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" }) : arquivo;
  } catch {
    return arquivo;
  }
}

/** Sem acento e em minúsculas, para comparar nomes (cidade, distribuidora). */
function simples(t: string): string {
  return t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

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

/** As 12 barras do cartão escuro: geração (sol) contra consumo (traço claro). */
function MiniBarras({ geracao, consumo }: { geracao: number[]; consumo: number[] }) {
  const W = 264;
  const H = 64;
  const topo = Math.max(1, ...geracao, ...consumo);
  const grupo = W / 12;
  return (
    <svg className="pc-mini" viewBox={`0 0 ${W} ${H + 12}`} role="img" aria-label="Geração e consumo de cada mês">
      {MESES.map((mes, i) => {
        const g = ((geracao[i] ?? 0) / topo) * H;
        const c = ((consumo[i] ?? 0) / topo) * H;
        const x = i * grupo + grupo * 0.2;
        const larg = grupo * 0.6;
        return (
          <g key={mes}>
            <rect className="pc-mini-geracao" x={x} y={H - g} width={larg} height={g} rx={2} />
            <line className="pc-mini-consumo" x1={x - 1} x2={x + larg + 1} y1={H - c} y2={H - c} />
            <text x={x + larg / 2} y={H + 10} textAnchor="middle">
              {mes[0]}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

// -------------------------------------------------------------- o assistente

type Candidato = InversorCandidato & { linha: LinhaDoKit };
type Bloco = "consumo" | "unidades" | "sistema" | "preco" | "envio" | "resumo";

/** Um bloco que abre e fecha; fechado, mostra numa linha o que já está decidido. */
function Bloco({
  id,
  titulo,
  icone,
  resumo,
  aberto,
  alternar,
  alerta,
  children,
}: {
  id: string;
  titulo: string;
  icone: React.ReactNode;
  resumo?: React.ReactNode;
  aberto: boolean;
  alternar: () => void;
  alerta?: string | null;
  children: React.ReactNode;
}) {
  return (
    <section id={`bloco-${id}`} className={`ap-bloco${aberto ? " ap-bloco-aberto" : ""}`}>
      <button type="button" className="ap-bloco-topo" aria-expanded={aberto} onClick={alternar}>
        <span className="ap-bloco-icone" aria-hidden>
          {icone}
        </span>
        <span className="ap-bloco-textos">
          <span className="ap-bloco-titulo">
            {titulo}
            {alerta && <span className="ap-bloco-alerta">{alerta}</span>}
          </span>
          {!aberto && resumo && <span className="ap-bloco-resumo">{resumo}</span>}
        </span>
        <ChevronDown size={18} aria-hidden className="ap-bloco-seta" />
      </button>
      {aberto && <div className="ap-bloco-corpo">{children}</div>}
    </section>
  );
}

interface ClienteDaProposta {
  nome: string;
  tipo: string;
  cidade: string | null;
  uf: string | null;
  telefone: string | null;
  etapa: string | null;
  responsavel: string | null;
  projeto: string;
}

interface VistoriaDaProposta {
  areaUtilM2: number | null;
  sombra: string | null;
  osNumero: number;
  concluida: boolean;
  ligacao: Ligacao | null;
}

export function AssistenteDaProposta({
  projetoId,
  origem,
  cliente,
  ultima,
  continuando,
  vistoria,
  leituraLigada,
  contaNoDossie,
  temContaDeBeneficiaria,
  estadoInicial,
  contextoInicial,
  distribuidoras,
  responsaveis,
  candidatos,
  modulosSugeridos,
  moduloPadrao,
  telhados,
  ehAdm,
}: {
  projetoId: string;
  origem: "esteira" | "projeto";
  cliente: ClienteDaProposta;
  ultima: { numero: number; visualizacoes: number; enviada: boolean } | null;
  continuando: boolean;
  vistoria: VistoriaDaProposta | null;
  leituraLigada: boolean;
  contaNoDossie: { nome: string; em: string } | null;
  temContaDeBeneficiaria: boolean;
  estadoInicial: EstadoDaProposta;
  contextoInicial: ContextoMontado;
  distribuidoras: { cnpj: string; nome: string; sigla: string }[];
  responsaveis: { id: string; nome: string }[];
  candidatos: Candidato[];
  modulosSugeridos: OpcaoDeEquipamento[];
  moduloPadrao: LinhaDoKit | null;
  telhados: string[];
  ehAdm: boolean;
}) {
  const [e, setE] = useState<EstadoDaProposta>(estadoInicial);
  const [contexto, setContexto] = useState<ContextoMontado>(contextoInicial);
  const [abertos, setAbertos] = useState<Set<Bloco>>(() => new Set<Bloco>(estadoInicial.ucs.some((u) => u.consumoMedia || u.consumoMeses.some((m) => m)) ? [] : ["consumo"]));
  const [salvoEm, setSalvoEm] = useState<string | null>(null);
  const [buscandoTarifa, setBuscandoTarifa] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [gerando, iniciarGeracao] = useTransition();
  const [cidades, setCidades] = useState<{ nome: string; uf: string }[]>([]);
  const [trocarModulo, setTrocarModulo] = useState(false);
  const estadoRef = useRef(e);
  estadoRef.current = e;

  const p = contexto.ctx.premissas;
  const ctxComVistoria = useMemo(
    () => ({ ...contexto.ctx, vistoria: vistoria ? { areaUtilM2: vistoria.areaUtilM2, sombra: vistoria.sombra } : null }),
    [contexto, vistoria],
  );
  const r = useMemo(() => calcularAssistente(e, ctxComVistoria), [e, ctxComVistoria]);
  const mudar = (parcial: Partial<EstadoDaProposta>) => setE((v) => ({ ...v, ...parcial }));
  const mudarUc = (i: number, parcial: Partial<UcDoAssistente>) => setE((v) => ({ ...v, ucs: v.ucs.map((u, j) => (j === i ? { ...u, ...parcial } : u)) }));
  const aberto = (b: Bloco) => abertos.has(b);
  const alternar = (b: Bloco) =>
    setAbertos((v) => {
      const n = new Set(v);
      if (n.has(b)) n.delete(b);
      else n.add(b);
      return n;
    });
  const abrir = (b: Bloco) => setAbertos((v) => new Set(v).add(b));

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

  // Cidade ou distribuidora mudou: sol, tarifa e distância de novo.
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

  // A cidade: busca enquanto digita (só enquanto não escolheu da lista).
  useEffect(() => {
    if (e.uf) return;
    const t = setTimeout(async () => setCidades(e.cidade.trim().length >= 2 ? await buscarCidades(e.cidade) : []), 250);
    return () => clearTimeout(t);
  }, [e.cidade, e.uf]);

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

  // ------------------------------------------------------------ kit automático
  const iGer = Math.max(0, e.ucs.findIndex((u) => u.geradora));
  const geradora = e.ucs[iGer];
  const moduloAtual = e.modulo ?? moduloPadrao;
  useEffect(() => {
    if (!e.kitAutomatico) return;
    const kit = kitAutomatico(e, r.kwpNecessario, candidatos, moduloPadrao, p.sobredimensionamento);
    if (!kit) return;
    const igual =
      e.modulo?.qtd === kit.modulo.qtd &&
      e.modulo.modelo === kit.modulo.modelo &&
      JSON.stringify(e.inversores.map((i) => [i.modelo, i.qtd])) === JSON.stringify(kit.inversores.map((i) => [i.modelo, i.qtd]));
    if (!igual) setE((v) => ({ ...v, modulo: kit.modulo, inversores: kit.inversores }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [e.kitAutomatico, r.kwpNecessario, moduloAtual?.modelo, moduloAtual?.potenciaW, e.tipoInversor, geradora.ligacao]);

  function sugerirInversor() {
    if (!e.modulo || !(e.modulo.qtd > 0)) return;
    const linha = sugerirInversores({ qtd: e.modulo.qtd, potenciaW: e.modulo.potenciaW }, candidatos.filter((c) => c.tipo === e.tipoInversor), p.sobredimensionamento, geradora.ligacao, e.tipoInversor);
    const c = linha ? candidatos.find((x) => x.id === linha[0].inversor.id) : null;
    if (c && linha) mudar({ inversores: [{ ...c.linha, qtd: linha[0].qtd }] });
  }

  const listaDistribuidoras = useMemo(() => {
    const daCidade = contexto.municipio?.distribuidoras.map((d) => d.cnpj) ?? [];
    const primeiras = distribuidoras.filter((d) => daCidade.includes(d.cnpj));
    const resto = distribuidoras.filter((d) => !daCidade.includes(d.cnpj)).sort((a, b) => a.nome.localeCompare(b.nome));
    return { primeiras, resto };
  }, [contexto.municipio, distribuidoras]);

  const infoTarifa = (u: UcDoAssistente) => contexto.tarifas.find((t) => t.chave === chaveDaTarifa(u.distribuidoraCnpj, u.subgrupo))?.tarifa ?? null;

  // ------------------------------------------------------------ conta de luz
  const [lendo, setLendo] = useState<string | null>(null);
  const [leitura, setLeitura] = useState<{ arquivo: string; mudou: string[]; conta: ContaDeLuzLida } | null>(null);
  const [erroConta, setErroConta] = useState<string | null>(null);
  const [arrastando, setArrastando] = useState(false);
  const entradaDaConta = useRef<HTMLInputElement>(null);

  function acharDistribuidora(nome: string): { cnpj: string; nome: string } | null {
    const n = simples(nome);
    const daCidade = contexto.municipio?.distribuidoras.map((d) => d.cnpj) ?? [];
    const candidatas = distribuidoras.filter((d) => {
      const nn = simples(d.nome);
      return nn.includes(n) || n.includes(nn) || simples(d.sigla) === n || n.split(/\s+/).every((p) => nn.includes(p));
    });
    return candidatas.find((d) => daCidade.includes(d.cnpj)) ?? candidatas[0] ?? null;
  }

  async function aplicarConta(conta: ContaDeLuzLida, arquivo: string) {
    const atual = estadoRef.current;
    const { uc, mudou } = ucComConta(atual.ucs[iGer], conta, acharDistribuidora);
    setE((v) => ({ ...v, ucs: v.ucs.map((u, j) => (j === iGer ? uc : u)) }));
    // A cidade da conta, quando ainda não há cidade: escolhe sozinha se o nome bate.
    if (!atual.uf && conta.cidade) {
      const achadas = await buscarCidades(conta.cidade);
      const igual = achadas.find((c) => simples(c.nome) === simples(conta.cidade!)) ?? (achadas.length === 1 ? achadas[0] : null);
      if (igual) {
        await escolherCidade(igual);
        mudou.push("cidade");
      }
    }
    setLeitura({ arquivo, mudou, conta });
  }

  async function lerDoDossie() {
    setErroConta(null);
    setLendo(contaNoDossie?.nome ?? "a conta do dossiê");
    const resposta = await lerContaDoDossie(projetoId, true);
    setLendo(null);
    if ("erro" in resposta) setErroConta(resposta.erro);
    else await aplicarConta(resposta.conta, resposta.arquivo);
  }

  async function enviarConta(original: File) {
    setErroConta(null);
    setLendo(original.name);
    const arquivo = await fotoMenor(original);
    if (arquivo.size > 15 * 1024 * 1024) {
      setLendo(null);
      setErroConta("A conta passa de 15 MB. Tire uma foto mais leve ou envie o PDF.");
      return;
    }
    const dados = new FormData();
    dados.set("conta", arquivo);
    const resposta = await lerContaEnviada(dados);
    setLendo(null);
    if ("erro" in resposta) setErroConta(resposta.erro);
    else await aplicarConta(resposta.conta, resposta.arquivo);
  }

  function gerar() {
    setErro(null);
    iniciarGeracao(async () => {
      const resposta = await gerarPropostaDoAssistente(projetoId, origem, estadoRef.current);
      if (resposta && "erro" in resposta) setErro(resposta.erro);
    });
  }

  const s = r.simulacao;
  const erroNoKit = r.avisosDoKit.some((a) => a.nivel === "erro") && Boolean(e.modulo && e.inversores.length);
  const textoDoKit = e.modulo
    ? `${e.modulo.qtd} × ${e.modulo.fabricante} ${rotuloDaPotencia(e.modulo)}${e.inversores.length ? ` + ${e.inversores.map((i) => `${i.qtd} × ${i.fabricante} ${i.modelo}`).join(" + ")}` : ""}`
    : "escolha o módulo";

  // Para onde levar quem clica num item do que falta.
  const blocoDaFalta = (f: string): Bloco =>
    /cidade|consumo|rateio/.test(f) ? (/"/.test(f) || /rateio/.test(f) ? "unidades" : "consumo") : /módulo|inversor|kit/.test(f) ? "sistema" : "preco";

  // ------------------------------------------------------------ uma unidade
  /** Os campos de uma unidade (função comum, não componente: senão o React remonta os campos a cada tecla). */
  function camposDaUc(i: number) {
    const u = e.ucs[i];
    const t = r.tarifas[i];
    const aneel = infoTarifa(u);
    return (
      <>
        <div className="ap-grade">
          {u.consumoModo === "media" ? (
            <label className="ap-campo">
              <span>
                Consumo médio (kWh/mês) <span className="ap-req">*</span>
              </span>
              <CampoNumero valor={u.consumoMedia} casas={1} placeholder="500" aoMudar={(n) => mudarUc(i, { consumoMedia: n })} />
              <small>
                A média dos meses da conta de luz.{" "}
                <button type="button" className="link-acao" onClick={() => mudarUc(i, { consumoModo: "mensal" })}>
                  Digitar mês a mês
                </button>
              </small>
            </label>
          ) : null}
          <label className="ap-campo">
            Ligação
            <select value={u.ligacao} onChange={(ev) => mudarUc(i, { ligacao: ev.target.value as Ligacao })}>
              {(Object.keys(DISPONIBILIDADE_KWH) as Ligacao[]).map((l) => (
                <option key={l} value={l}>
                  {ROTULO_LIGACAO[l]}
                </option>
              ))}
            </select>
          </label>
          <label className="ap-campo">
            Distribuidora
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
                      {d.nome}
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
            Classe
            <select value={u.subgrupo} onChange={(ev) => mudarUc(i, { subgrupo: ev.target.value as Subgrupo })}>
              {(Object.keys(ROTULO_SUBGRUPO) as Subgrupo[]).map((k) => (
                <option key={k} value={k}>
                  {ROTULO_SUBGRUPO[k]}
                </option>
              ))}
            </select>
          </label>
          <label className="ap-campo">
            Código da unidade
            <input value={u.codigo} inputMode="numeric" placeholder="Opcional" onChange={(ev) => mudarUc(i, { codigo: ev.target.value })} />
          </label>
        </div>
        {u.consumoModo === "mensal" && (
          <>
            <div className="ap-secao-topo">
              <span className="ap-campo" style={{ margin: 0 }}>
                Consumo mês a mês (kWh)
              </span>
              <button type="button" className="link-acao" onClick={() => mudarUc(i, { consumoModo: "media" })}>
                Usar só a média
              </button>
            </div>
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
            <small className="ap-explica">O histórico da conta de luz. Mês em branco recebe a média dos outros.</small>
          </>
        )}
        <div className="ap-tarifa">
          <span>
            Tarifa <strong>{moeda(t.tarifa)}/kWh</strong> · Fio B <strong>{moeda(t.fioB)}/kWh</strong>
          </span>
          <span>
            {t.origem === "aneel" && aneel
              ? aneel.daTabela
                ? `ANEEL ${resolucaoCurta(aneel.resolucao)} (tabela do sistema, conferida em ${dataBr(aneel.buscadaEm.slice(0, 10))}), com impostos`
                : `ANEEL ${resolucaoCurta(aneel.resolucao)}, em vigor desde ${dataBr(aneel.vigenciaInicio)}, com ${pct(p.tributos.icms)} de ICMS e ${pct(p.tributos.pisCofins)} de PIS/COFINS`
              : t.origem === "manual"
                ? "digitada à mão"
                : u.distribuidoraCnpj
                  ? buscandoTarifa
                    ? "buscando na ANEEL…"
                    : "a ANEEL não respondeu: vale a tarifa manual das premissas"
                  : "escolha a distribuidora"}
          </span>
          {u.distribuidoraCnpj && (
            <button type="button" className="link-acao" onClick={buscarTarifaDeNovo} disabled={buscandoTarifa}>
              <RefreshCw size={12} aria-hidden /> Buscar de novo
            </button>
          )}
        </div>
        <details>
          <summary className="ap-explica">A conta tem outra tarifa? (cooperativa, tarifa branca…)</summary>
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
      </>
    );
  }

  const beneficiarias = e.ucs.map((u, i) => ({ u, i })).filter(({ u }) => !u.geradora);

  const tarifaGeradora = r.tarifas[iGer];
  const aneelGeradora = infoTarifa(geradora);
  const consumoGeradora = r.consumos[iGer] ? r.consumos[iGer]!.reduce((a, b) => a + b, 0) / 12 : null;
  const sozinhos: { texto: string; titulo?: string }[] = [];
  if (leitura) sozinhos.push({ texto: "Consumo da conta de luz", titulo: leitura.arquivo });
  if (contexto.municipio) sozinhos.push({ texto: `Sol de ${e.cidade}`, titulo: contexto.fonteIrradiacao ?? "Atlas Brasileiro de Energia Solar (INPE)" });
  if (geradora.distribuidoraNome) sozinhos.push({ texto: geradora.distribuidoraNome, titulo: "A distribuidora que atende a cidade" });
  if (tarifaGeradora?.origem === "aneel" && aneelGeradora) sozinhos.push({ texto: `Tarifa ${resolucaoCurta(aneelGeradora.resolucao)}`, titulo: "Tarifa e Fio B da ANEEL, com os impostos" });
  if (vistoria?.areaUtilM2) sozinhos.push({ texto: `Telhado: ${br(vistoria.areaUtilM2)} m² úteis`, titulo: `Vistoria nº ${vistoria.osNumero}` });
  if (vistoria?.sombra) sozinhos.push({ texto: vistoria.sombra, titulo: `Vistoria nº ${vistoria.osNumero}` });
  if (e.kitAutomatico && e.modulo && r.kwpNecessario) sozinhos.push({ texto: "Kit dimensionado", titulo: "Módulos que zeram as contas e o inversor pela relação CC/CA" });
  if (r.custoKit !== null && e.custoKitManual === null && r.precoFinal) sozinhos.push({ texto: "Preço pelo catálogo", titulo: "Custos do catálogo, da empresa, margem e imposto" });
  const voltar = origem === "esteira" ? "/esteira" : `/projeto/${projetoId}`;
  const lugar = [cliente.cidade, cliente.uf].filter(Boolean).join("/");

  return (
    <>
      <header className="pc-heroi">
        <nav className="pc-heroi-nav" aria-label="Voltar">
          <Link href={voltar} className="pc-voltar">
            <ArrowLeft size={15} aria-hidden /> {origem === "esteira" ? "Esteira" : cliente.projeto}
          </Link>
          <Link href="/propostas" className="pc-voltar">
            Todas as propostas
          </Link>
        </nav>
        <div className="pc-heroi-corpo">
          <span className="pc-avatar" aria-hidden>
            {iniciais(cliente.nome)}
          </span>
          <div className="pc-heroi-texto">
            <span className="pc-sobrancelha">Proposta comercial para</span>
            <h1>{cliente.nome}</h1>
            <ul className="pc-chips">
              {lugar && (
                <li>
                  <MapPin size={14} aria-hidden /> {lugar}
                </li>
              )}
              {cliente.telefone && (
                <li>
                  <Phone size={14} aria-hidden /> {cliente.telefone}
                </li>
              )}
              {cliente.etapa && (
                <li>
                  <Clock size={14} aria-hidden /> {cliente.etapa}
                </li>
              )}
              {cliente.responsavel && (
                <li>
                  <UserRound size={14} aria-hidden /> {cliente.responsavel}
                </li>
              )}
            </ul>
          </div>
          <div className="pc-heroi-estado">
            <span className={`pc-pilula${ultima && ultima.visualizacoes > 0 ? " pc-pilula-ok" : ""}`}>
              {ultima
                ? `Nº ${ultima.numero} · ${ultima.visualizacoes > 0 ? `cliente abriu ${ultima.visualizacoes}×` : ultima.enviada ? "enviada" : "ainda não enviada"}`
                : "Primeira proposta"}
            </span>
            <span className="pc-salvo">
              <CircleCheck size={13} aria-hidden />
              {salvoEm ? `Guardado às ${salvoEm}` : continuando ? "Continuando de onde parou" : "Guarda sozinho"}
            </span>
          </div>
        </div>
      </header>

      <div className="ap2">
      <div className="ap-conteudo">
        <section
          className={`pc-conta${consumoGeradora ? " pc-conta-compacta" : ""}${arrastando ? " pc-conta-arrastando" : ""}`}
          onDragOver={(ev) => {
            if (!leituraLigada) return;
            ev.preventDefault();
            setArrastando(true);
          }}
          onDragLeave={() => setArrastando(false)}
          onDrop={(ev) => {
            if (!leituraLigada) return;
            ev.preventDefault();
            setArrastando(false);
            const f = ev.dataTransfer.files[0];
            if (f) enviarConta(f);
          }}
        >
          <span className="pc-conta-icone" aria-hidden>
            <ScanLine size={22} />
          </span>
          <div className="pc-conta-texto">
            <h2>{consumoGeradora ? "Ler de novo da conta de luz" : "Comece pela conta de luz"}</h2>
            <p>
              {leituraLigada
                ? "O sistema lê o histórico de consumo, o número da unidade, a classe, a ligação e a distribuidora. O resto sai sozinho."
                : ehAdm
                  ? "A leitura automática está desligada: ponha GROQ_API_KEY (grátis em console.groq.com) no .env do servidor e faça o deploy. Por ora, digite o consumo."
                  : "A leitura automática está desligada (o administrador liga). Por ora, digite o consumo."}
            </p>
          </div>
          {leituraLigada && (
            <div className="pc-conta-acoes">
              {contaNoDossie && (
                <button type="button" className="botao" disabled={Boolean(lendo)} onClick={lerDoDossie} title={contaNoDossie.nome}>
                  <FolderOpen size={15} aria-hidden /> Ler a do dossiê <small>({contaNoDossie.em})</small>
                </button>
              )}
              <button type="button" className={`botao${contaNoDossie ? " secundario" : ""}`} disabled={Boolean(lendo)} onClick={() => entradaDaConta.current?.click()}>
                <Camera size={15} aria-hidden /> Foto ou PDF da conta
              </button>
              <input
                ref={entradaDaConta}
                type="file"
                accept="image/jpeg,image/png,image/webp,application/pdf"
                hidden
                onChange={(ev) => {
                  const f = ev.target.files?.[0];
                  ev.target.value = "";
                  if (f) enviarConta(f);
                }}
              />
            </div>
          )}
          {lendo && (
            <p className="pc-conta-lendo" role="status">
              <span className="pc-girando" aria-hidden /> Lendo {lendo}… leva alguns segundos.
            </p>
          )}
          {erroConta && (
            <p className="ap-aviso ap-aviso-erro pc-conta-recado" role="alert">
              {erroConta}
            </p>
          )}
          {leitura && !lendo && (
            <div className="pc-conta-lida pc-conta-recado" role="status">
              <CircleCheck size={16} aria-hidden />
              <span>
                <strong>{leitura.mudou.length ? `Preenchido da conta: ${leitura.mudou.join(", ")}.` : "A conta bate com o que já estava preenchido."}</strong>
                {leitura.conta.tarifaComImpostos && tarifaGeradora
                  ? ` A conta cobra ${moeda(leitura.conta.tarifaComImpostos)}/kWh (com bandeira e impostos); a proposta usa a tarifa da ANEEL, ${moeda(tarifaGeradora.tarifa)}/kWh.`
                  : ""}
                {temContaDeBeneficiaria && beneficiarias.length === 0 ? " O dossiê tem conta de outra unidade: dá para pôr no rateio." : ""}
              </span>
            </div>
          )}
        </section>

        {sozinhos.length > 0 && (
          <div className="pc-sozinhos">
            <span className="pc-sozinhos-titulo">
              <Sparkles size={14} aria-hidden /> Preenchido sozinho
            </span>
            <ul>
              {sozinhos.map((x) => (
                <li key={x.texto} title={x.titulo}>
                  <CircleCheck size={13} aria-hidden /> {x.texto}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* ------------------------------------------- 1. consumo e local */}
        <Bloco
          id="consumo"
          titulo="Consumo e local"
          icone={<House size={18} />}
          aberto={aberto("consumo")}
          alternar={() => alternar("consumo")}
          resumo={`${e.cidade ? `${e.cidade}${e.uf ? `/${e.uf}` : ""}` : "sem cidade"} · ${r.consumos[iGer] ? kwh(r.consumos[iGer]!.reduce((a, b) => a + b, 0) / 12) + "/mês" : "sem consumo"} · ${geradora.distribuidoraNome || "sem distribuidora"}`}
        >
          <div className="ap-grade">
            <div className="ap-escolha">
              <label className="ap-campo">
                <span>
                  Cidade da instalação <span className="ap-req">*</span>
                </span>
                <input value={e.cidade} onChange={(ev) => mudar({ cidade: ev.target.value, uf: "" })} placeholder="Itabaiana" />
                <small>
                  {e.uf
                    ? `${e.cidade}/${e.uf}${contexto.municipio ? ` · sol de ${br(contexto.municipio.irradiacaoAnual, 2)} kWh/m²·dia (Atlas INPE)` : ""}${contexto.ctx.distanciaKm !== null ? ` · ${br(contexto.ctx.distanciaKm)} km da base` : ""}`
                    : "Escolha na lista: o sistema acha o sol e a distribuidora."}
                </small>
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
          </div>
          {camposDaUc(iGer)}
          {beneficiarias.length === 0 && (
            <button
              type="button"
              className="link-acao"
              onClick={() => {
                setE((v) => ({
                  ...v,
                  ucs: [...v.ucs, novaUc(v.ucs.length + 1, { distribuidoraCnpj: geradora.distribuidoraCnpj, distribuidoraNome: geradora.distribuidoraNome, ligacao: geradora.ligacao, id: `uc-${Date.now()}`, nome: "Outra unidade", percentual: 1 })],
                }));
                abrir("unidades");
              }}
            >
              <Plus size={13} aria-hidden /> Outra casa ou comércio do cliente recebe os créditos
            </button>
          )}
        </Bloco>

        {/* ------------------------------------------- unidades que recebem */}
        {beneficiarias.length > 0 && (
          <Bloco
            id="unidades"
            titulo="Unidades que recebem os créditos"
            icone={<Users size={18} />}
            aberto={aberto("unidades")}
            alternar={() => alternar("unidades")}
            resumo={`${beneficiarias.length} ${beneficiarias.length === 1 ? "unidade" : "unidades"} · ${e.rateio === "percentual" ? "por porcentagem" : "por fila de prioridade"}`}
          >
            <p className="ap-explica">
              Do mesmo titular e na mesma distribuidora (autoconsumo remoto). O que sobra da geradora vai para elas, como no
              formulário de compensação da distribuidora.
            </p>
            <span className="ap-alternar" role="group" aria-label="Sistema de rateio">
              <button type="button" aria-pressed={e.rateio === "percentual"} onClick={() => mudar({ rateio: "percentual" })}>
                Porcentagem
              </button>
              <button type="button" aria-pressed={e.rateio === "prioridade"} onClick={() => mudar({ rateio: "prioridade" })}>
                Fila de prioridade
              </button>
            </span>
            {beneficiarias.map(({ u, i }, k) => (
              <div key={u.id} className="ap-uc">
                <div className="ap-uc-topo">
                  <label className="ap-campo" style={{ flex: 1, minWidth: 180 }}>
                    Nome
                    <input value={u.nome} onChange={(ev) => mudarUc(i, { nome: ev.target.value })} />
                  </label>
                  {e.rateio === "percentual" ? (
                    <label className="ap-campo" style={{ width: 130 }}>
                      % do que sobra
                      <CampoPercentual valor={u.percentual} aoMudar={(f) => mudarUc(i, { percentual: f })} />
                    </label>
                  ) : (
                    <span className="grupo-botoes" aria-label={`${k + 1}º na fila`}>
                      <span className="ap-selo">{k + 1}º</span>
                      <button
                        type="button"
                        className="ap-icone-botao"
                        aria-label="Subir na fila"
                        disabled={k === 0}
                        onClick={() =>
                          setE((v) => {
                            const ucs = [...v.ucs];
                            const anterior = beneficiarias[k - 1].i;
                            [ucs[anterior], ucs[i]] = [ucs[i], ucs[anterior]];
                            return { ...v, ucs };
                          })
                        }
                      >
                        <ArrowUp size={14} aria-hidden />
                      </button>
                      <button
                        type="button"
                        className="ap-icone-botao"
                        aria-label="Descer na fila"
                        disabled={k === beneficiarias.length - 1}
                        onClick={() =>
                          setE((v) => {
                            const ucs = [...v.ucs];
                            const proxima = beneficiarias[k + 1].i;
                            [ucs[proxima], ucs[i]] = [ucs[i], ucs[proxima]];
                            return { ...v, ucs };
                          })
                        }
                      >
                        <ArrowDown size={14} aria-hidden />
                      </button>
                    </span>
                  )}
                  <button type="button" className="ap-icone-botao" aria-label={`Tirar ${u.nome}`} onClick={() => setE((v) => ({ ...v, ucs: v.ucs.filter((_, j) => j !== i) }))}>
                    <Trash2 size={15} aria-hidden />
                  </button>
                </div>
                {camposDaUc(i)}
              </div>
            ))}
            <div className="ap-secao-topo">
              <button
                type="button"
                className="link-acao"
                onClick={() =>
                  setE((v) => ({
                    ...v,
                    ucs: [...v.ucs, novaUc(v.ucs.length + 1, { distribuidoraCnpj: geradora.distribuidoraCnpj, distribuidoraNome: geradora.distribuidoraNome, id: `uc-${Date.now()}`, nome: `Unidade ${v.ucs.length + 1}` })],
                  }))
                }
              >
                <Plus size={13} aria-hidden /> Mais uma unidade
              </button>
              {e.rateio === "percentual" && (
                <span className="ap-explica">
                  A geradora fica com <strong>{pct(Math.max(0, 1 - beneficiarias.reduce((a, { u }) => a + (u.percentual ?? 0), 0)))}</strong> do que sobra.
                </span>
              )}
            </div>
          </Bloco>
        )}

        {/* ------------------------------------------- 2. sistema */}
        <Bloco
          id="sistema"
          titulo="Sistema"
          icone={<SunMedium size={18} />}
          aberto={aberto("sistema")}
          alternar={() => alternar("sistema")}
          alerta={erroNoKit ? "ajustar" : null}
          resumo={`${r.kwp ? kwpTexto(r.kwp) : "—"} · ${textoDoKit}${e.kitAutomatico ? " · automático" : ""}`}
        >
          <div className="ap-secao-topo">
            <span className="ap-explica">
              {e.kitAutomatico
                ? `Automático: a quantidade de módulos que zera as contas${r.kwpNecessario ? ` (${kwpTexto(r.kwpNecessario)})` : ""} e o inversor pela relação CC/CA, as fases e o que mais se instala em Sergipe. Muda sozinho se o consumo mudar.`
                : "Ajustado à mão: o kit não muda mais com o consumo."}
            </span>
            {!e.kitAutomatico && (
              <button type="button" className="botao secundario" onClick={() => mudar({ kitAutomatico: true })}>
                <Sparkles size={14} aria-hidden /> Voltar ao automático
              </button>
            )}
          </div>

          {e.modulo && !trocarModulo ? (
            <div className="ap-kit-linha">
              <div className="ap-kit-nome">
                <strong>
                  {e.modulo.fabricante} {e.modulo.modelo}
                </strong>
                <small>
                  Módulo de {rotuloDaPotencia(e.modulo)} ·{" "}
                  <button type="button" className="link-acao" onClick={() => setTrocarModulo(true)}>
                    trocar
                  </button>
                </small>
              </div>
              <label className="ap-campo">
                Quantidade
                <CampoNumero valor={e.modulo.qtd || null} inteiro aoMudar={(n) => mudar({ modulo: { ...e.modulo!, qtd: n ?? 0 }, kitAutomatico: false })} />
              </label>
              <label className="ap-campo">
                Custo unitário (R$)
                <CampoNumero valor={e.modulo.precoUnitario} aoMudar={(n) => mudar({ modulo: { ...e.modulo!, precoUnitario: n } })} />
              </label>
              <span />
            </div>
          ) : (
            <EscolherEquipamento
              tipos={["modulo"]}
              sugestoes={modulosSugeridos}
              rotulo="Módulo"
              aoEscolher={(l) => {
                setTrocarModulo(false);
                const qtd = r.kwpNecessario ? modulosParaPotencia(r.kwpNecessario, l.potenciaW) : 1;
                mudar({ modulo: { ...l, qtd } });
              }}
            />
          )}

          <div className="ap-secao-topo">
            <span className="ap-alternar" role="group" aria-label="Tipo de inversor">
              <button type="button" aria-pressed={e.tipoInversor === "inversor"} onClick={() => mudar({ tipoInversor: "inversor", inversores: [], kitAutomatico: true })}>
                Inversor
              </button>
              <button type="button" aria-pressed={e.tipoInversor === "microinversor"} onClick={() => mudar({ tipoInversor: "microinversor", inversores: [], kitAutomatico: true })}>
                Microinversor
              </button>
            </span>
            {!e.kitAutomatico && (
              <button type="button" className="link-acao" disabled={!e.modulo?.qtd} onClick={sugerirInversor}>
                <Sparkles size={13} aria-hidden /> Sugerir para estes módulos
              </button>
            )}
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
                <CampoNumero valor={l.qtd || null} inteiro aoMudar={(n) => mudar({ inversores: e.inversores.map((x, j) => (j === i ? { ...x, qtd: n ?? 0 } : x)), kitAutomatico: false })} />
              </label>
              <label className="ap-campo">
                Custo unitário (R$)
                <CampoNumero valor={l.precoUnitario} aoMudar={(n) => mudar({ inversores: e.inversores.map((x, j) => (j === i ? { ...x, precoUnitario: n } : x)) })} />
              </label>
              <button type="button" className="ap-icone-botao" aria-label="Tirar" onClick={() => mudar({ inversores: e.inversores.filter((_, j) => j !== i), kitAutomatico: false })}>
                <Trash2 size={15} aria-hidden />
              </button>
            </div>
          ))}
          <EscolherEquipamento
            tipos={[e.tipoInversor]}
            sugestoes={SEM_SUGESTAO}
            rotulo={e.inversores.length ? "Trocar ou acrescentar inversor" : "Escolher o inversor"}
            aoEscolher={(l) => {
              const qtd = l.tipo === "microinversor" && l.modulosPorUnidade && e.modulo?.qtd ? Math.ceil(e.modulo.qtd / l.modulosPorUnidade) : 1;
              mudar({ inversores: e.kitAutomatico ? [{ ...l, qtd }] : [...e.inversores, { ...l, qtd }], kitAutomatico: false });
            }}
          />
          {r.avisosDoKit.length > 0 && e.modulo && (
            <div className="ap-avisos">
              {r.avisosDoKit.map((a) => (
                <p key={a.texto} className={`ap-aviso ap-aviso-${a.nivel}`}>
                  {a.texto}
                </p>
              ))}
            </div>
          )}
          <div className="ap-numeros">
            <div className="ap-numero">
              <span>Potência</span>
              <strong>{r.kwp ? kwpTexto(r.kwp) : "—"}</strong>
            </div>
            <div className="ap-numero">
              <span>Cobre do consumo</span>
              <strong>{r.kwpNecessario && r.kwp ? pct(r.kwp / r.kwpNecessario) : "—"}</strong>
            </div>
            <div className="ap-numero">
              <span>Relação CC/CA</span>
              <strong>{r.relacaoCcCa ? br(r.relacaoCcCa, 2) : "—"}</strong>
            </div>
            <div className="ap-numero">
              <span>Área de telhado</span>
              <strong>{r.areaM2 ? `${br(r.areaM2)} m²` : "—"}</strong>
            </div>
          </div>

          <details className="ap-avancado">
            <summary>Telhado, perfis, sol e outros itens do kit</summary>
            <div className="ap-grade">
              <label className="ap-campo">
                Telhado
                <select value={e.telhado ?? ""} onChange={(ev) => mudar({ telhado: ev.target.value || null })}>
                  <option value="">A definir na vistoria</option>
                  {telhados.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </label>
              <label className="ap-campo">
                Desempenho
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
              </label>
              {!p.perfisDesempenho.some((x) => x.nome === e.perfilDesempenho) && (
                <label className="ap-campo">
                  Desempenho (%)
                  <CampoPercentual valor={e.desempenho} aoMudar={(f) => f !== null && f >= 0.5 && f <= 0.95 && mudar({ desempenho: f })} />
                </label>
              )}
              <label className="ap-campo">
                Consumo na hora (simultaneidade)
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
              </label>
              {!p.perfisSimultaneidade.some((x) => x.nome === e.perfilSimultaneidade) && (
                <label className="ap-campo">
                  Simultaneidade (%)
                  <CampoPercentual valor={e.simultaneidade} aoMudar={(f) => f !== null && f <= 1 && mudar({ simultaneidade: f })} />
                </label>
              )}
            </div>
            <div className="ap-secao-topo">
              <span className="ap-explica">
                Sol de cada mês (kWh/m²·dia): {e.irradiacaoManual ? "digitado à mão" : (contexto.fonteIrradiacao ?? "o das premissas")}, média {br(r.irradiacaoAnual, 2)}.
              </span>
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
            <div className="ap-secao-topo">
              <span className="ap-explica">Outros itens do kit (estrutura, string box, cabos), quando o distribuidor não manda junto.</span>
              <button type="button" className="link-acao" onClick={() => mudar({ outrosItens: [...e.outrosItens, { nome: "", qtd: 1, precoUnitario: null }] })}>
                <Plus size={13} aria-hidden /> Item
              </button>
            </div>
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
          </details>
        </Bloco>

        {/* ------------------------------------------- 3. preço */}
        <Bloco
          id="preco"
          titulo="Preço"
          icone={<Wallet size={18} />}
          aberto={aberto("preco")}
          alternar={() => alternar("preco")}
          alerta={!r.precoFinal ? "falta o custo" : r.margemFinal !== null && r.margemFinal < 0.05 ? "margem baixa" : null}
          resumo={r.precoFinal ? `${moeda(r.precoFinal)}${r.margemFinal !== null ? ` · margem ${pct(r.margemFinal, 1)}` : ""}${r.kwp ? ` · ${moeda(r.precoFinal / (r.kwp * 1000))}/Wp` : ""}` : "falta o custo do kit"}
        >
          <div className="ap-grade">
            <label className="ap-campo">
              Custo do kit (R$)
              <CampoNumero valor={e.custoKitManual} placeholder={r.custoKit !== null && e.custoKitManual === null ? br(r.custoKit, 2) : "Total do distribuidor"} aoMudar={(n) => mudar({ custoKitManual: n })} />
              <small>
                {e.custoKitManual !== null
                  ? "Total digitado (vale sobre a soma)."
                  : r.custoKit !== null
                    ? `Pelos custos do catálogo: ${moeda(r.custoKit)}.`
                    : "O total que o distribuidor cobra pelo kit."}
              </small>
            </label>
            <label className="ap-campo">
              Preço de venda (R$)
              <CampoNumero valor={r.precoFinal} aoMudar={(n) => mudar({ precoFinal: n && n > 0 ? n : null })} />
              <small>
                {e.precoFinal !== null && r.preco ? (
                  <button type="button" className="link-acao" onClick={() => mudar({ precoFinal: null })}>
                    Voltar ao sugerido ({moeda(r.preco.precoSugerido)})
                  </button>
                ) : (
                  `Sugerido: custo + custos da empresa, margem de ${pct(p.precificacao.margem)} e imposto de ${pct(p.precificacao.imposto)}. Mude para dar desconto.`
                )}
              </small>
            </label>
          </div>
          {r.preco && (
            <details className="ap-avancado">
              <summary>Ver e mudar os custos ({moeda(r.preco.custoTotal)})</summary>
              <div className="tabela-wrap">
                <table className="tabela ap-custos">
                  <tbody>
                    <tr>
                      <td>
                        <input type="checkbox" checked disabled aria-label="Kit" />
                      </td>
                      <td>Kit</td>
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
              <div className="ap-secao-topo">
                <button type="button" className="link-acao" onClick={() => mudar({ custosExtras: [...e.custosExtras, { nome: "", valor: 0 }] })}>
                  <Plus size={13} aria-hidden /> Custo avulso (troca de padrão, reforço de telhado…)
                </button>
                {ehAdm && (
                  <Link href="/administracao/proposta" className="link-acao">
                    Mudar os custos e a margem de todas
                  </Link>
                )}
              </div>
            </details>
          )}
        </Bloco>

        {/* ------------------------------------------- 4. envio */}
        <Bloco
          id="envio"
          titulo="Pagamento e envio"
          icone={<Send size={18} />}
          aberto={aberto("envio")}
          alternar={() => alternar("envio")}
          resumo={`${responsaveis.find((x) => x.id === e.responsavelId)?.nome ?? "responsável"} · válida por ${e.validadeDias ?? p.validadeDias} dias${e.observacoes ? " · com observação" : ""}`}
        >
          <div className="ap-grade">
            <label className="ap-campo">
              Responsável pela proposta
              <select value={e.responsavelId ?? ""} onChange={(ev) => mudar({ responsavelId: ev.target.value || null })}>
                {responsaveis.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.nome}
                  </option>
                ))}
              </select>
            </label>
            <label className="ap-campo">
              Validade (dias)
              <CampoNumero valor={e.validadeDias ?? p.validadeDias} inteiro aoMudar={(n) => mudar({ validadeDias: n })} />
            </label>
          </div>
          {r.formas && (
            <div className="ap-numeros">
              <div className="ap-numero">
                <span>À vista</span>
                <strong>{moeda(r.formas.aVista.valor)}</strong>
              </div>
              {r.formas.cartao?.opcoes.slice(-2).map((o) => (
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
            <textarea rows={2} maxLength={600} value={e.observacoes} placeholder="Inclui a troca do padrão de entrada." onChange={(ev) => mudar({ observacoes: ev.target.value })} />
          </label>
        </Bloco>

        {/* ------------------------------------------- resumo completo */}
        {s && (
          <Bloco
            id="resumo"
            titulo="Geração, consumo e conta de cada unidade"
            icone={<ChartColumn size={18} />}
            aberto={aberto("resumo")}
            alternar={() => alternar("resumo")} resumo={`${kwh(s.geracaoMediaMes)}/mês gerados · ${pct(s.cobertura)} do consumo`}>
            {s.cobertura > 1.25 && (
              <p className="ap-aviso ap-aviso-atencao">
                A usina gera {pct(s.cobertura)} do que dá para compensar: sobram {kwh(s.sobraCreditosAno1)} de crédito no primeiro ano (vencem em 60
                meses). Vale diminuir o kit ou pôr outra unidade no rateio.
              </p>
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
          </Bloco>
        )}
      </div>

      {/* ------------------------------------------- o resultado, sempre à vista */}
      <aside className="pc-resultado" aria-live="polite" id="resultado">
        <div className="pc-res-topo">
          <span className="pc-res-sobrancelha">
            <SunMedium size={14} aria-hidden /> Economia na conta de luz
          </span>
          {s ? (
            <>
              <strong className="pc-res-economia">
                {moeda(s.economiaMes)}
                <small>/mês</small>
              </strong>
              <span className="pc-res-conta">
                de <s>{moeda(s.contaSemMes)}</s> para <b>{moeda(s.contaComMes)}</b> por mês
              </span>
              <MiniBarras geracao={s.geracaoMes} consumo={s.consumoMes} />
              <span className="pc-res-legenda">
                <i className="pc-leg-geracao" /> geração <i className="pc-leg-consumo" /> consumo · cobre {pct(s.cobertura)}
              </span>
            </>
          ) : (
            <p className="pc-res-vazio">
              {consumoGeradora ? "Falta pouco: veja o que falta abaixo." : "Leia a conta de luz ou digite o consumo: o resto sai sozinho."}
            </p>
          )}
        </div>

        <dl className="pc-res-kpis">
          <div>
            <dt>Retorno</dt>
            <dd>{s ? rotuloDoPayback(s.paybackMeses) : "—"}</dd>
          </div>
          <div>
            <dt>Rendimento</dt>
            <dd>{s && s.tir !== null ? `${pct(s.tir, 1)} a.a.` : "—"}</dd>
          </div>
          <div>
            <dt>Em 25 anos</dt>
            <dd>{s ? moedaCurta(s.economia25) : "—"}</dd>
          </div>
          <div>
            <dt>Sistema</dt>
            <dd>{r.kwp ? kwpTexto(r.kwp) : "—"}</dd>
          </div>
        </dl>

        <div className="pc-res-preco">
          <span>Preço</span>
          <strong>{r.precoFinal ? moeda(r.precoFinal) : "—"}</strong>
          {r.precoFinal ? (
            <small>
              {r.margemFinal !== null && <em className={r.margemFinal < 0.05 ? "pc-res-baixa" : undefined}>margem {pct(r.margemFinal, 1)}</em>}
              {r.kwp ? ` · ${moeda(r.precoFinal / (r.kwp * 1000))}/Wp` : ""}
            </small>
          ) : null}
        </div>

        {!r.precoFinal && r.custoKit === null && e.modulo && (
          <label className="pc-res-campo">
            Custo do kit (R$)
            <CampoNumero valor={e.custoKitManual} placeholder="Total do distribuidor" aoMudar={(n) => mudar({ custoKitManual: n })} />
            <small>É o que falta para o preço sair sozinho.</small>
          </label>
        )}

        {r.falta.length > 0 && (
          <ul className="pc-res-falta">
            {r.falta.map((f) => (
              <li key={f}>
                <button
                  type="button"
                  onClick={() => {
                    const b = blocoDaFalta(f);
                    abrir(b);
                    setTimeout(() => document.getElementById(`bloco-${b}`)?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
                  }}
                >
                  Falta {f} →
                </button>
              </li>
            ))}
          </ul>
        )}
        {erro && (
          <p className="pc-res-erro" role="alert">
            {erro}
          </p>
        )}
        <button type="button" className="pc-gerar" disabled={gerando || r.falta.length > 0} onClick={gerar}>
          <FileCheck2 size={17} aria-hidden /> {gerando ? "Gerando o PDF…" : "Gerar a proposta"}
        </button>
        {e.modulo && <small className="pc-res-kit">{textoDoKit}</small>}
      </aside>
      </div>

      {/* No celular, o resultado e o botão ficam presos embaixo. */}
      <div className="pc-barra">
        <a href="#resultado" className="pc-barra-numero">
          <span>Economia</span>
          <strong>{s ? `${moeda(s.economiaMes)}/mês` : "—"}</strong>
        </a>
        <button type="button" className="pc-gerar" disabled={gerando || r.falta.length > 0} onClick={gerar}>
          <FileCheck2 size={16} aria-hidden /> {gerando ? "Gerando…" : "Gerar"}
        </button>
      </div>
    </>
  );
}

function resolucaoCurta(r: string | null): string {
  return (r ?? "").replace(/^RESOLUÇÃO HOMOLOGATÓRIA\s*/i, "REH ").replace(/,? DE .*$/i, "");
}

function dataBr(iso: string): string {
  return iso.slice(0, 10).split("-").reverse().join("/");
}
