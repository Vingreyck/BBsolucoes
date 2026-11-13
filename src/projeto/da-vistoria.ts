/**
 * O que a vistoria do técnico já responde e o sistema pode aproveitar, sem
 * banco: ler as respostas pela `chave` do item do checklist e traduzir o tipo
 * de telhado para o texto do contrato.
 *
 * As chaves são as do modelo de vistoria (`src/os/modelos.ts`). Conferido pelo
 * `testar-regras.ts`.
 */

export interface RespostaDaVistoria {
  chave: string | null;
  valor: unknown;
}

export interface DadosDaVistoria {
  /** Número da unidade consumidora, como o técnico digitou da conta de luz. */
  ucNumero: string | null;
  /** Nome do titular da conta, como está na conta (nem sempre é o cliente). */
  titular: string | null;
  /** Uma das opções de `TELHADOS`, ou nulo. */
  telhado: string | null;
}

/** As opções do item "Tipo de telhado" da vistoria, e como entram no contrato. */
export const TELHADOS: Record<string, string | null> = {
  Cerâmica: "estrutura cerâmica",
  Colonial: "estrutura colonial",
  Fibrocimento: "estrutura fibrocimento",
  Metálico: "estrutura metálica",
  Laje: "estrutura para laje",
  // "Outro" não diz nada: quem gera o contrato completa à mão.
  Outro: null,
};

export const OPCOES_DE_TELHADO = Object.keys(TELHADOS);

/** "estrutura fibrocimento", ou nulo se o telhado é desconhecido ou "Outro". */
export function estruturaDoTelhado(tipo: string | null | undefined): string | null {
  return tipo && tipo in TELHADOS ? TELHADOS[tipo] : null;
}

function texto(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const limpo = v.replace(/\s+/g, " ").trim().slice(0, max);
  return limpo || null;
}

/**
 * Lê as respostas. Resposta em branco ou de tipo inesperado vira nulo: o que
 * não veio não preenche nada.
 */
export function lerVistoria(itens: RespostaDaVistoria[]): DadosDaVistoria {
  const por = new Map(itens.filter((i) => i.chave).map((i) => [i.chave as string, i.valor]));
  // A UC é só dígitos, e o Drizzle devolve uma resposta de texto assim como
  // número (lê o jsonb "123456" e o converte). O valor é o mesmo; zero à
  // esquerda não se perde, porque "0123" não vira número.
  const bruto = por.get("uc_numero");
  const uc = texto(typeof bruto === "number" && Number.isSafeInteger(bruto) && bruto > 0 ? String(bruto) : bruto, 30);
  const telhado = texto(por.get("telhado_tipo"), 40);
  return {
    // Menos de 3 caracteres não é número de UC: é "-" ou "0" de quem pulou.
    ucNumero: uc && uc.length >= 3 ? uc : null,
    titular: texto(por.get("titular_nome"), 200),
    telhado: telhado && telhado in TELHADOS ? telhado : null,
  };
}

// ---------------------------------------------------- dados do projeto elétrico

/**
 * Os dados técnicos que o técnico mede e responde na vistoria e que o
 * engenheiro precisa para o projeto elétrico e o memorial: o padrão de entrada,
 * o quadro, o telhado e o local do inversor.
 *
 * Aqui só se **lê** (sem copiar para colunas): a resposta continua morando na
 * OS, e quem for gerar o projeto ou o memorial lê daqui, do mesmo jeito.
 */
export interface DadosTecnicos {
  disjuntorA: number | null;
  polos: string | null;
  bitola: string | null;
  aterramento: string | null;
  qdgVagas: number | null;
  caminhoCabo: string | null;
  rasgarParede: boolean | null;
  telhado: string | null;
  telhadoEstado: string[];
  sombra: string | null;
  areaUtilM2: number | null;
  inversorLocal: string | null;
  ampliacao: boolean | null;
}

/** O que o engenheiro precisa ter respondido para começar o projeto elétrico. */
export const ESSENCIAIS_DO_PROJETO: { campo: keyof DadosTecnicos; rotulo: string }[] = [
  { campo: "disjuntorA", rotulo: "amperagem do disjuntor" },
  { campo: "polos", rotulo: "polos do disjuntor" },
  { campo: "bitola", rotulo: "bitola do cabo de entrada" },
  { campo: "aterramento", rotulo: "aterramento" },
  { campo: "qdgVagas", rotulo: "vagas no quadro" },
  { campo: "telhado", rotulo: "tipo de telhado" },
  { campo: "areaUtilM2", rotulo: "área útil do telhado" },
  { campo: "inversorLocal", rotulo: "local do inversor" },
];

function numeroDe(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function simNao(v: unknown): boolean | null {
  return typeof v === "boolean" ? v : null;
}

/** Texto que o banco pode devolver como número (só dígitos): volta como texto. */
function textoOuNumero(v: unknown, max = 300): string | null {
  return texto(typeof v === "number" && Number.isFinite(v) ? String(v) : v, max);
}

export function lerDadosTecnicos(itens: RespostaDaVistoria[]): DadosTecnicos {
  const por = new Map(itens.filter((i) => i.chave).map((i) => [i.chave as string, i.valor]));
  const bitola = texto(por.get("cabo_bitola"), 40);
  const telhado = texto(por.get("telhado_tipo"), 40);
  const estado = por.get("telhado_estado");
  return {
    disjuntorA: numeroDe(por.get("disjuntor_amperagem")),
    polos: texto(por.get("disjuntor_polos"), 40),
    // "Não deu para ver" é a resposta de quem não conseguiu medir: não vale.
    bitola: bitola && bitola !== "Não deu para ver" ? bitola : null,
    aterramento: texto(por.get("aterramento"), 60),
    qdgVagas: numeroDe(por.get("qdg_vagas")),
    caminhoCabo: textoOuNumero(por.get("cabo_caminho")),
    rasgarParede: simNao(por.get("rasgar_parede")),
    telhado: telhado && telhado in TELHADOS ? telhado : null,
    telhadoEstado: Array.isArray(estado) ? estado.filter((e): e is string => typeof e === "string") : [],
    sombra: texto(por.get("sombra"), 60),
    areaUtilM2: numeroDe(por.get("area_util")),
    inversorLocal: textoOuNumero(por.get("inversor_local")),
    ampliacao: simNao(por.get("ampliacao")),
  };
}

/** O que ainda falta para começar o projeto elétrico, em palavras. Vazio = pode começar. */
export function faltaParaOProjeto(d: DadosTecnicos): string[] {
  return ESSENCIAIS_DO_PROJETO.filter((e) => d[e.campo] === null).map((e) => e.rotulo);
}
