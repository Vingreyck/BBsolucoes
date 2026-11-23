/**
 * As premissas da proposta comercial: o que o cálculo assume, como a empresa
 * forma o preço e as formas de pagamento. Sem banco — conferido pelo
 * `testar-regras.ts`.
 *
 * Ficam gravadas por empresa (`empresa.proposta_config`), conferidas pelo adm
 * em Administração → Proposta comercial. Os valores de `SUGESTAO` só preenchem
 * o formulário da primeira vez: nada vale até alguém salvar, porque número
 * errado numa proposta vira promessa ao cliente.
 *
 * Desde 23/11 (proposta completa) entraram os perfis de desempenho e de
 * simultaneidade, os impostos da conta de luz (para a tarifa que vem da ANEEL
 * sem eles), o sobredimensionamento, os custos e a margem, a logística e os
 * financiamentos. Premissas salvas antes disso continuam valendo: o que falta
 * nelas vem da sugestão até o adm salvar de novo.
 */

/** Um perfil com nome: "Residencial — 30%". `valor` é fração (0,30). */
export interface Perfil {
  nome: string;
  valor: number;
}

export type TipoDeCusto = "fixo" | "por_kwp" | "por_modulo" | "por_inversor" | "percentual" | "faixa_kwp";

/** Um custo que entra no preço além do kit (o "item complementar" do Solarz). */
export interface ItemDeCusto {
  id: string;
  nome: string;
  tipo: TipoDeCusto;
  /** R$ (fixo, por kWp, por módulo, por inversor) ou fração (percentual). */
  valor: number;
  /** Percentual: sobre o kit, ou sobre o custo (kit + os itens acima dele). */
  base?: "kit" | "custo";
  /** Faixa por potência: o valor total até cada potência (a última vale para o resto). */
  faixas?: { ateKwp: number; valor: number }[];
  /** Só para estes telhados (vazio: todos). Ex.: estrutura de laje custa diferente. */
  estruturas?: string[];
  grupo: "material" | "servico" | "outro";
}

export interface Financiamento {
  nome: string;
  /** Taxa de juros ao mês (fração). */
  taxaMes: number;
  /** Prazos oferecidos, em meses. */
  prazos: number[];
  /** Dias até a primeira parcela. */
  carenciaDias: number;
}

export interface Premissas {
  /** Tarifa cheia da distribuidora, com impostos, em R$ por kWh — usada quando a ANEEL não responde. */
  tarifaKwh: number;
  /** TUSD Fio B cheia, com impostos, em R$ por kWh — idem. */
  fioBKwh: number;
  /** Irradiação, em kWh/m² por dia — usada só quando a cidade não está no Atlas. */
  irradiacaoDia: number;
  /** Desempenho global do sistema (PR) padrão, de 0 a 1. */
  desempenho: number;
  /** Fração do consumo atendida na hora pela geração (padrão). */
  simultaneidade: number;
  /** Reajuste anual da tarifa (0 a 1). */
  reajusteAnual: number;
  /** Perda anual de geração dos módulos (0 a 1). */
  degradacaoAnual: number;
  /** Dias de validade da proposta. O CDC (art. 40) pressupõe 10 se nada for dito. */
  validadeDias: number;
  garantias: { inversor: number; placas: number; estrutura: number; eficiencia: number };
  cartao: { parcelas: number; taxaMes: number };
  carenciaFinanciamentoDias: number;
  /** O primeiro número de proposta, para continuar a numeração que a empresa já tem. */
  numeroInicial: number | null;

  /** ICMS e PIS/COFINS da conta de luz (frações), para pôr na tarifa da ANEEL, que vem sem eles. */
  tributos: { icms: number; pisCofins: number };
  perfisDesempenho: Perfil[];
  perfisSimultaneidade: Perfil[];
  /** Potência de módulos ÷ potência do inversor: a que o kit busca e o máximo aceito. */
  sobredimensionamento: { alvo: number; maximo: number };
  /** Taxa de desconto ao ano (fração) para o valor presente e o retorno descontado. */
  tma: number;
  precificacao: {
    itens: ItemDeCusto[];
    /** Margem de lucro (fração). */
    margem: number;
    /** Por dentro: preço = custo ÷ (1 − margem − imposto). Por fora: custo × (1 + margem), e o imposto por dentro. */
    margemPorDentro: boolean;
    /** Imposto sobre a venda (fração), por dentro. */
    imposto: number;
    /** Arredonda o preço final para cima, neste múltiplo de reais (0 = não arredonda). */
    arredondar: number;
  };
  logistica: {
    /** De onde a equipe sai. */
    cidade: string;
    uf: string;
    /** Até esta distância (km, ida) o deslocamento já está nos custos. */
    raioKm: number;
    /** R$ por km rodado além do raio (ida e volta). */
    valorKm: number;
  };
  pagamento: {
    /** Desconto à vista (fração). */
    aVistaDesconto: number;
    financiamentos: Financiamento[];
  };
}

/** O que o formulário mostra na primeira vez. Não vale até o adm salvar. */
export const SUGESTAO: Premissas = {
  tarifaKwh: 1.0,
  fioBKwh: 0.34,
  irradiacaoDia: 5.26,
  desempenho: 0.75,
  simultaneidade: 0.3,
  reajusteAnual: 0.05,
  degradacaoAnual: 0.007,
  validadeDias: 10,
  garantias: { inversor: 10, placas: 12, estrutura: 10, eficiencia: 25 },
  cartao: { parcelas: 21, taxaMes: 0.008 },
  carenciaFinanciamentoDias: 120,
  numeroInicial: null,
  tributos: { icms: 0.2, pisCofins: 0.05 },
  perfisDesempenho: [
    { nome: "Padrão (telhado para o norte)", valor: 0.75 },
    { nome: "Leste/oeste", valor: 0.7 },
    { nome: "Com sombra parcial", valor: 0.65 },
  ],
  perfisSimultaneidade: [
    { nome: "Residencial", valor: 0.3 },
    { nome: "Casa com alguém de dia", valor: 0.4 },
    { nome: "Comércio de dia", valor: 0.6 },
  ],
  sobredimensionamento: { alvo: 1.15, maximo: 1.35 },
  tma: 0.1,
  precificacao: {
    itens: [
      { id: "projeto", nome: "Projeto, ART e homologação", tipo: "fixo", valor: 900, grupo: "servico" },
      { id: "mao-de-obra", nome: "Mão de obra de instalação", tipo: "por_kwp", valor: 400, grupo: "servico" },
      { id: "material-ca", nome: "Material elétrico CA (cabos, disjuntores, DPS)", tipo: "por_kwp", valor: 150, grupo: "material" },
      { id: "frete", nome: "Frete do kit", tipo: "percentual", valor: 0.02, base: "kit", grupo: "outro" },
    ],
    margem: 0.2,
    margemPorDentro: true,
    imposto: 0.06,
    arredondar: 10,
  },
  logistica: { cidade: "Itabaiana", uf: "SE", raioKm: 40, valorKm: 2.5 },
  pagamento: {
    aVistaDesconto: 0,
    financiamentos: [{ nome: "Financiamento solar", taxaMes: 0.0149, prazos: [36, 48, 60, 72, 84, 96, 120], carenciaDias: 120 }],
  },
};

function numero(v: unknown, min: number, max: number): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v.replace(",", ".")) : NaN;
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
}

function inteiro(v: unknown, min: number, max: number): number | null {
  const n = numero(v, min, max);
  return n !== null && Number.isInteger(n) ? n : null;
}

function texto(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const t = v.replace(/\s+/g, " ").trim().slice(0, max);
  return t || null;
}

const TIPOS_DE_CUSTO: TipoDeCusto[] = ["fixo", "por_kwp", "por_modulo", "por_inversor", "percentual", "faixa_kwp"];

/** Os perfis válidos da lista (nome e valor no intervalo); lista vazia ou inválida → nulo. */
export function lerPerfis(v: unknown, min: number, max: number): Perfil[] | null {
  if (!Array.isArray(v)) return null;
  const perfis: Perfil[] = [];
  for (const x of v.slice(0, 12)) {
    const o = (x ?? {}) as Record<string, unknown>;
    const nome = texto(o.nome, 60);
    const valor = numero(o.valor, min, max);
    if (nome && valor !== null) perfis.push({ nome, valor });
  }
  return perfis.length ? perfis : null;
}

/** Os custos válidos (os inválidos são descartados, um a um). */
export function lerItensDeCusto(v: unknown): ItemDeCusto[] | null {
  if (!Array.isArray(v)) return null;
  const itens: ItemDeCusto[] = [];
  const vistos = new Set<string>();
  for (const [i, x] of v.slice(0, 40).entries()) {
    const o = (x ?? {}) as Record<string, unknown>;
    const nome = texto(o.nome, 80);
    const tipo = TIPOS_DE_CUSTO.includes(o.tipo as TipoDeCusto) ? (o.tipo as TipoDeCusto) : null;
    if (!nome || !tipo) continue;
    const valor = tipo === "percentual" ? numero(o.valor, 0, 1) : numero(o.valor ?? 0, 0, 10_000_000);
    if (valor === null) continue;
    let id = texto(o.id, 40)?.replace(/[^\w-]/g, "") || `custo-${i + 1}`;
    while (vistos.has(id)) id = `${id}-${i + 1}`;
    vistos.add(id);
    const item: ItemDeCusto = {
      id,
      nome,
      tipo,
      valor,
      grupo: o.grupo === "material" || o.grupo === "servico" ? o.grupo : "outro",
    };
    if (tipo === "percentual") item.base = o.base === "custo" ? "custo" : "kit";
    if (tipo === "faixa_kwp") {
      const faixas = Array.isArray(o.faixas)
        ? o.faixas
            .map((f) => {
              const r = (f ?? {}) as Record<string, unknown>;
              const ate = numero(r.ateKwp, 0.1, 100_000);
              const val = numero(r.valor, 0, 10_000_000);
              return ate !== null && val !== null ? { ateKwp: ate, valor: val } : null;
            })
            .filter((f): f is { ateKwp: number; valor: number } => f !== null)
            .sort((a, b) => a.ateKwp - b.ateKwp)
        : [];
      if (!faixas.length) continue;
      item.faixas = faixas.slice(0, 20);
      item.valor = 0;
    }
    const estruturas = Array.isArray(o.estruturas)
      ? o.estruturas.map((e) => texto(e, 40)).filter((e): e is string => Boolean(e))
      : [];
    if (estruturas.length) item.estruturas = estruturas;
    itens.push(item);
  }
  return itens;
}

export function lerFinanciamentos(v: unknown): Financiamento[] | null {
  if (!Array.isArray(v)) return null;
  const lista: Financiamento[] = [];
  for (const x of v.slice(0, 8)) {
    const o = (x ?? {}) as Record<string, unknown>;
    const nome = texto(o.nome, 60);
    const taxaMes = numero(o.taxaMes, 0, 0.2);
    const carenciaDias = inteiro(o.carenciaDias ?? 0, 0, 365);
    const prazos = Array.isArray(o.prazos)
      ? [...new Set(o.prazos.map((p) => inteiro(p, 1, 240)).filter((p): p is number => p !== null))].sort((a, b) => a - b)
      : [];
    if (nome && taxaMes !== null && carenciaDias !== null && prazos.length) lista.push({ nome, taxaMes, prazos: prazos.slice(0, 12), carenciaDias });
  }
  return lista;
}

/**
 * Lê o que está gravado. Qualquer campo de base ausente ou fora do razoável
 * anula tudo: premissa pela metade daria uma proposta com número inventado.
 * Os campos que entraram em 23/11, quando ausentes, vêm da sugestão.
 */
export function lerPremissas(bruto: unknown): Premissas | null {
  if (!bruto || typeof bruto !== "object") return null;
  const b = bruto as Record<string, unknown>;
  const g = (b.garantias ?? {}) as Record<string, unknown>;
  const c = (b.cartao ?? {}) as Record<string, unknown>;
  const tarifaKwh = numero(b.tarifaKwh, 0.1, 5);
  const fioBKwh = numero(b.fioBKwh, 0, 2);
  const irradiacaoDia = numero(b.irradiacaoDia, 2, 8);
  const desempenho = numero(b.desempenho, 0.5, 0.95);
  const simultaneidade = numero(b.simultaneidade, 0, 1);
  const reajusteAnual = numero(b.reajusteAnual, 0, 0.3);
  const degradacaoAnual = numero(b.degradacaoAnual, 0, 0.05);
  const validadeDias = inteiro(b.validadeDias, 1, 90);
  const inversor = inteiro(g.inversor, 1, 40);
  const placas = inteiro(g.placas, 1, 40);
  const estrutura = inteiro(g.estrutura, 1, 40);
  const eficiencia = inteiro(g.eficiencia, 1, 40);
  const parcelas = inteiro(c.parcelas, 1, 120);
  const taxaMes = numero(c.taxaMes, 0, 0.2);
  const carencia = inteiro(b.carenciaFinanciamentoDias, 0, 365);
  const inicial = b.numeroInicial === null || b.numeroInicial === undefined || b.numeroInicial === "" ? null : inteiro(b.numeroInicial, 1, 1_000_000);

  const todos = [tarifaKwh, fioBKwh, irradiacaoDia, desempenho, simultaneidade, reajusteAnual, degradacaoAnual, validadeDias, inversor, placas, estrutura, eficiencia, parcelas, taxaMes, carencia];
  if (todos.some((x) => x === null)) return null;
  if (b.numeroInicial !== null && b.numeroInicial !== undefined && b.numeroInicial !== "" && inicial === null) return null;

  // Os campos novos: cada um é lido sozinho; o que não vier (ou vier quebrado) é a sugestão.
  const t = (b.tributos ?? {}) as Record<string, unknown>;
  const icms = numero(t.icms, 0, 0.4);
  const pisCofins = numero(t.pisCofins, 0, 0.2);
  const s = (b.sobredimensionamento ?? {}) as Record<string, unknown>;
  const alvo = numero(s.alvo, 0.7, 2);
  const maximo = numero(s.maximo, 0.8, 2.5);
  const pr = (b.precificacao ?? {}) as Record<string, unknown>;
  const itens = lerItensDeCusto(pr.itens);
  const margem = numero(pr.margem, 0, 0.9);
  const imposto = numero(pr.imposto, 0, 0.5);
  const arredondar = numero(pr.arredondar ?? 0, 0, 10_000);
  const lo = (b.logistica ?? {}) as Record<string, unknown>;
  const pg = (b.pagamento ?? {}) as Record<string, unknown>;
  const financiamentos = lerFinanciamentos(pg.financiamentos);
  const aVistaDesconto = numero(pg.aVistaDesconto, 0, 0.5);
  const sobre =
    alvo !== null && maximo !== null && maximo >= alvo ? { alvo, maximo } : SUGESTAO.sobredimensionamento;
  const margemPorDentro = typeof pr.margemPorDentro === "boolean" ? pr.margemPorDentro : SUGESTAO.precificacao.margemPorDentro;
  // Margem e imposto por dentro precisam deixar sobra: 60% + 45% não forma preço.
  const margemOk = margem !== null && imposto !== null && (!margemPorDentro || margem + imposto < 0.95);

  return {
    tarifaKwh: tarifaKwh!,
    fioBKwh: fioBKwh!,
    irradiacaoDia: irradiacaoDia!,
    desempenho: desempenho!,
    simultaneidade: simultaneidade!,
    reajusteAnual: reajusteAnual!,
    degradacaoAnual: degradacaoAnual!,
    validadeDias: validadeDias!,
    garantias: { inversor: inversor!, placas: placas!, estrutura: estrutura!, eficiencia: eficiencia! },
    cartao: { parcelas: parcelas!, taxaMes: taxaMes! },
    carenciaFinanciamentoDias: carencia!,
    numeroInicial: inicial,
    tributos: icms !== null && pisCofins !== null && icms + pisCofins < 0.6 ? { icms, pisCofins } : SUGESTAO.tributos,
    perfisDesempenho: lerPerfis(b.perfisDesempenho, 0.5, 0.95) ?? [{ nome: "Padrão", valor: desempenho! }],
    perfisSimultaneidade: lerPerfis(b.perfisSimultaneidade, 0, 1) ?? [{ nome: "Padrão", valor: simultaneidade! }],
    sobredimensionamento: sobre,
    tma: numero(b.tma, 0, 0.5) ?? SUGESTAO.tma,
    precificacao: {
      itens: itens ?? SUGESTAO.precificacao.itens,
      margem: margemOk ? margem! : SUGESTAO.precificacao.margem,
      margemPorDentro,
      imposto: margemOk ? imposto! : SUGESTAO.precificacao.imposto,
      arredondar: arredondar ?? 0,
    },
    logistica: {
      cidade: texto(lo.cidade, 80) ?? SUGESTAO.logistica.cidade,
      uf: (texto(lo.uf, 2) ?? SUGESTAO.logistica.uf).toUpperCase(),
      raioKm: numero(lo.raioKm, 0, 2000) ?? SUGESTAO.logistica.raioKm,
      valorKm: numero(lo.valorKm, 0, 100) ?? SUGESTAO.logistica.valorKm,
    },
    pagamento: {
      aVistaDesconto: aVistaDesconto ?? SUGESTAO.pagamento.aVistaDesconto,
      financiamentos:
        financiamentos ??
        [{ ...SUGESTAO.pagamento.financiamentos[0], carenciaDias: carencia! }],
    },
  };
}

/** Diz se a configuração gravada já tem os campos de 23/11 (senão, a tela avisa para conferir e salvar). */
export function temCamposNovos(bruto: unknown): boolean {
  if (!bruto || typeof bruto !== "object") return false;
  const b = bruto as Record<string, unknown>;
  return Boolean(b.tributos && b.precificacao && b.pagamento && b.perfisDesempenho);
}

function jsonDe(campo: string | undefined): unknown {
  if (!campo) return undefined;
  try {
    return JSON.parse(campo);
  } catch {
    return undefined;
  }
}

/**
 * O formulário digita porcentagem ("75", "0,8") e número comum; o que se grava
 * é fração (0,75). As listas (perfis, custos, financiamentos) chegam em JSON,
 * montadas pela tela. Devolve nulo se algum campo de base não é número.
 */
export function premissasDoFormulario(campos: Record<string, string>): Premissas | null {
  const n = (k: string) => Number(String(campos[k] ?? "").trim().replace(/\./g, (m, i, s: string) => (s.includes(",") ? "" : m)).replace(",", "."));
  const pct = (k: string) => n(k) / 100;
  const perfis = (k: string) => {
    const lista = jsonDe(campos[k]);
    return Array.isArray(lista) ? lista.map((p) => ({ ...(p as object), valor: Number((p as { valor?: unknown }).valor) / 100 })) : undefined;
  };
  const itens = jsonDe(campos.custos);
  const financiamentos = jsonDe(campos.financiamentos);
  const bruto = {
    tarifaKwh: n("tarifaKwh"),
    fioBKwh: n("fioBKwh"),
    irradiacaoDia: n("irradiacaoDia"),
    desempenho: pct("desempenho"),
    simultaneidade: pct("simultaneidade"),
    reajusteAnual: pct("reajusteAnual"),
    degradacaoAnual: pct("degradacaoAnual"),
    validadeDias: n("validadeDias"),
    garantias: { inversor: n("garantiaInversor"), placas: n("garantiaPlacas"), estrutura: n("garantiaEstrutura"), eficiencia: n("garantiaEficiencia") },
    cartao: { parcelas: n("cartaoParcelas"), taxaMes: pct("cartaoTaxa") },
    carenciaFinanciamentoDias: n("carencia"),
    numeroInicial: String(campos.numeroInicial ?? "").trim() === "" ? null : n("numeroInicial"),
    tributos: { icms: pct("icms"), pisCofins: pct("pisCofins") },
    perfisDesempenho: perfis("perfisDesempenho"),
    perfisSimultaneidade: perfis("perfisSimultaneidade"),
    sobredimensionamento: { alvo: pct("sobreAlvo"), maximo: pct("sobreMaximo") },
    tma: pct("tma"),
    precificacao: {
      itens: Array.isArray(itens)
        ? itens.map((i) => {
            const o = i as Record<string, unknown>;
            return o.tipo === "percentual" ? { ...o, valor: Number(o.valor) / 100 } : o;
          })
        : undefined,
      margem: pct("margem"),
      margemPorDentro: campos.margemPorDentro !== "fora",
      imposto: pct("imposto"),
      arredondar: n("arredondar"),
    },
    logistica: { cidade: campos.logisticaCidade, uf: campos.logisticaUf, raioKm: n("raioKm"), valorKm: n("valorKm") },
    pagamento: {
      aVistaDesconto: pct("aVistaDesconto"),
      financiamentos: Array.isArray(financiamentos)
        ? financiamentos.map((f) => {
            const o = f as Record<string, unknown>;
            return { ...o, taxaMes: Number(o.taxaMes) / 100 };
          })
        : undefined,
    },
  };
  const lidas = lerPremissas(bruto);
  if (!lidas) return null;
  // No formulário, campo novo que veio errado é erro (não vira a sugestão escondida).
  // Campo que nem veio (formulário antigo) fica com o que `lerPremissas` decidiu.
  const veio = (k: string) => campos[k] !== undefined;
  const t = bruto.tributos;
  if ((veio("icms") || veio("pisCofins")) && !(t.icms >= 0 && t.icms <= 0.4 && t.pisCofins >= 0 && t.pisCofins <= 0.2)) return null;
  const s = bruto.sobredimensionamento;
  if ((veio("sobreAlvo") || veio("sobreMaximo")) && !(s.alvo >= 0.7 && s.maximo <= 2.5 && s.maximo >= s.alvo)) return null;
  const pr = bruto.precificacao;
  if ((veio("margem") || veio("imposto")) && !(pr.margem >= 0 && pr.imposto >= 0 && (!pr.margemPorDentro || pr.margem + pr.imposto < 0.95))) return null;
  if (veio("tma") && !(bruto.tma >= 0 && bruto.tma <= 0.5)) return null;
  return lidas;
}
