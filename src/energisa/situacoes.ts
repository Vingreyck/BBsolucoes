/**
 * O que cada situação do portal de projetos da Energisa (AWGPE) quer dizer para
 * a esteira do Selebi — sem banco, para o `testar-regras.ts` conferir.
 *
 * A tabela de códigos é a do próprio portal: o JavaScript da página
 * (`/AWGPE/dashboard`) agrupa as situações em "aprovado", "reprovado" e "em
 * análise", com estes códigos de uma letra. "Etapa de Obra" aparece na tela sem
 * estar na tabela deles (fica sem bolinha colorida); entra aqui pela descrição.
 */

/** O que importa para a esteira, em vez das 26 situações deles. */
export type FaseEnergisa =
  | "analise" // projeto em análise
  | "aprovado" // projeto aprovado (e os passos de contrato que vêm depois)
  | "indeferido" // projeto indeferido ou reprovado — corrigir e reenviar
  | "cancelado" // cancelado ou dispensado
  | "obra" // obra em andamento
  | "vistoria_pendente" // vistoria pedida, esperando a Energisa
  | "vistoria_aprovada" // vistoria aprovada, ligação liberada, falta conectar
  | "vistoria_reprovada" // vistoria, fiscalização ou comissionamento reprovados
  | "conectada" // UC GD conectada: a usina está ligada
  | "desconhecida";

/** Código do portal → descrição e fase. */
export const SITUACOES: Record<string, { descricao: string; fase: FaseEnergisa }> = {
  A: { descricao: "Projeto em Análise", fase: "analise" },
  P: { descricao: "Projeto Aprovado", fase: "aprovado" },
  B: { descricao: "Parecer de Acesso em Aberto", fase: "aprovado" },
  T: { descricao: "Contrato em Aberto", fase: "aprovado" },
  Z: { descricao: "CUSD/CCER em Aberto", fase: "aprovado" },
  F: { descricao: "Acordo Operativo em Aberto", fase: "aprovado" },
  G: { descricao: "Relacionamento Operacional em Aberto", fase: "aprovado" },
  I: { descricao: "Projeto Indeferido", fase: "indeferido" },
  E: { descricao: "Projeto Reprovado", fase: "indeferido" },
  X: { descricao: "Projeto Cancelado", fase: "cancelado" },
  D: { descricao: "Projeto Dispensado", fase: "cancelado" },
  O: { descricao: "Obra em Andamento", fase: "obra" },
  H: { descricao: "Vistoria Pendente", fase: "vistoria_pendente" },
  V: { descricao: "Vistoria", fase: "vistoria_pendente" },
  R: { descricao: "Roteirização", fase: "vistoria_pendente" },
  Y: { descricao: "Fiscalização", fase: "vistoria_pendente" },
  U: { descricao: "Fiscalização Pendente", fase: "vistoria_pendente" },
  S: { descricao: "Comissionamento", fase: "vistoria_pendente" },
  K: { descricao: "Vistoria Aprovada", fase: "vistoria_aprovada" },
  L: { descricao: "Ligação Liberada", fase: "vistoria_aprovada" },
  Q: { descricao: "Ligação Parcial Liberada", fase: "vistoria_aprovada" },
  J: { descricao: "Vistoria Reprovada", fase: "vistoria_reprovada" },
  W: { descricao: "Fiscalização Reprovada", fase: "vistoria_reprovada" },
  N: { descricao: "Comissionamento Reprovado", fase: "vistoria_reprovada" },
  M: { descricao: "UC GD Conectada", fase: "conectada" },
  C: { descricao: "Projeto Concluído", fase: "conectada" },
};

const sem = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

/** A fase pelo código; sem código conhecido, pela descrição ("Etapa de Obra"). */
export function faseDe(codigo: string | null | undefined, descricao?: string | null): FaseEnergisa {
  const porCodigo = codigo ? SITUACOES[codigo.trim().toUpperCase()] : undefined;
  if (porCodigo) return porCodigo.fase;
  const d = sem(descricao ?? "");
  if (!d) return "desconhecida";
  const porTexto = Object.values(SITUACOES).find((s) => sem(s.descricao) === d);
  if (porTexto) return porTexto.fase;
  if (d.includes("obra")) return "obra";
  if (d.includes("conectad")) return "conectada";
  if (d.includes("vistoria") && d.includes("reprov")) return "vistoria_reprovada";
  if (d.includes("vistoria")) return "vistoria_pendente";
  if (d.includes("indeferid") || d.includes("reprovad")) return "indeferido";
  if (d.includes("aprovad")) return "aprovado";
  if (d.includes("analise")) return "analise";
  return "desconhecida";
}

export const ROTULO_FASE: Record<FaseEnergisa, string> = {
  analise: "em análise",
  aprovado: "aprovado",
  indeferido: "indeferido",
  cancelado: "cancelado",
  obra: "em obra",
  vistoria_pendente: "vistoria pendente",
  vistoria_aprovada: "vistoria aprovada",
  vistoria_reprovada: "vistoria reprovada",
  conectada: "UC GD conectada",
  desconhecida: "situação desconhecida",
};

/** Cor da etiqueta na tela: o mesmo verde/vermelho/azul do portal deles. */
export function tomDaFase(fase: FaseEnergisa): "ok" | "ruim" | "espera" | "neutro" {
  if (fase === "aprovado" || fase === "vistoria_aprovada" || fase === "conectada" || fase === "obra") return "ok";
  if (fase === "indeferido" || fase === "vistoria_reprovada") return "ruim";
  if (fase === "analise" || fase === "vistoria_pendente") return "espera";
  return "neutro";
}

/** Entrada que ainda vale: reenviar o projeto (V2, V3) gera outra, e a indeferida fica para trás. */
function viva(fase: FaseEnergisa): boolean {
  return fase !== "indeferido" && fase !== "cancelado";
}

/**
 * Qual das entradas da Energisa de um mesmo projeto do Selebi vale agora.
 *
 * Projeto indeferido e reenviado vira outra linha no portal ("Rosangela V2",
 * "V3"), e a data de entrada nem sempre segue a ordem dos envios. Vale a mais
 * recente das que ainda estão vivas; se todas morreram, a mais recente.
 */
export function vigente<T extends { fase: FaseEnergisa; dataAbertura: Date | null }>(entradas: T[]): T | null {
  if (!entradas.length) return null;
  const recente = (a: T, b: T) => (b.dataAbertura?.getTime() ?? 0) - (a.dataAbertura?.getTime() ?? 0);
  const vivas = entradas.filter((e) => viva(e.fase)).sort(recente);
  return vivas[0] ?? [...entradas].sort(recente)[0];
}

/**
 * O que a esteira faz sozinha com a situação da Energisa — só na etapa em que
 * ela faz sentido, para nunca empurrar um projeto que está em outro lugar por
 * outro motivo:
 *
 * - **Projeto registrado no portal** (qualquer situação viva: em análise,
 *   aprovado…) com o projeto do Selebi em "Projeto" → avança para a Aprovação
 *   da concessionária. Aparecer no portal é a prova de que o engenheiro
 *   submeteu: não há o que clicar à mão. Indeferido ou cancelado não conta, e
 *   por isso o projeto devolvido para correção só anda de novo quando o
 *   reenvio ("V2") aparecer;
 * - **Vistoria aprovada** (ou ligação liberada, ou já a UC GD conectada) com o
 *   projeto em "Pedido de vistoria" → avança para Monitoramento: o pedido foi
 *   aceito, não há o que fazer à mão;
 * - **Vistoria reprovada** com o projeto em "Pedido de vistoria" → volta para
 *   Execução, que é para onde a esteira manda o retrabalho.
 *
 * A aprovação do projeto (Aprovação da concessionária) não move nada sozinha:
 * ela libera o botão "Gerar OS de instalação", porque a obra precisa de técnico
 * e de dia — é ao escolher os dois que o projeto anda.
 */
export function acaoNaEsteira(fase: FaseEnergisa, etapaSlug: string): "avancar" | "voltar" | null {
  if (etapaSlug === "projeto") {
    return viva(fase) && fase !== "desconhecida" ? "avancar" : null;
  }
  if (etapaSlug !== "pedido_vistoria") return null;
  if (fase === "vistoria_aprovada" || fase === "conectada") return "avancar";
  if (fase === "vistoria_reprovada") return "voltar";
  return null;
}

/** A aprovação libera a OS de instalação (aprovado, ou os passos de contrato/obra que vêm depois). */
export function liberaOsDeInstalacao(fase: FaseEnergisa): boolean {
  return fase === "aprovado" || fase === "obra";
}

// --- Casar a linha da Energisa com o projeto do Selebi --------------------------------

/** Palavras do nome do empreendimento que não são nome de gente. */
const RUIDO = new Set([
  "pe", "solar", "sr", "sra", "srta", "dr", "dra", "bb", "solucoes", "solucao", "aumento", "gd", "usina", "hibrido",
  "hibrida", "casa", "cond", "condominio", "residencia", "residencial", "eng", "engenharia",
  "de", "da", "do", "das", "dos", "e", "kw", "kwp", "fv", "loja", "sitio", "fazenda", "chacara", "galpao", "u1", "u2", "u3",
]);

function palavras(texto: string): string[] {
  return sem(texto)
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * "PE Solar Sr Jose Edenilson - BB Solucoes - 28 10 2026" → ["jose", "edenilson"].
 * O nome costuma vir antes do primeiro " - "; no aumento de geração vem depois
 * ("PE AUMENTO GD - ELIAS MADERE V2 - …"). Fica o primeiro pedaço que tem nome,
 * sem versão (V2), potência (75KW) e palavras do jargão do setor.
 */
export function nomeNoEmpreendimento(empreendimento: string): string[] {
  for (const pedaco of empreendimento.split(/\s+-\s+/)) {
    const nome = palavras(pedaco).filter((p) => !RUIDO.has(p) && !/^v\d+$/.test(p) && !/^\d/.test(p) && p.length > 1);
    if (nome.length) return nome;
  }
  return [];
}

export interface Candidato {
  projetoId: string;
  cliente: string;
}

// São centenas de linhas contra os mesmos candidatos: o nome de cada cliente é
// limpo uma vez só, e não uma vez por linha.
const jaLimpos = new WeakMap<Candidato, Set<string>>();
function palavrasDoCliente(c: Candidato): Set<string> {
  let p = jaLimpos.get(c);
  if (!p) {
    p = new Set(palavras(c.cliente));
    jaLimpos.set(c, p);
  }
  return p;
}

/**
 * Os projetos do Selebi que batem com o nome do empreendimento, do mais
 * provável ao menos. A nota é a fração das palavras do nome no empreendimento
 * que aparecem no nome do cliente.
 */
export function sugerirProjetos(empreendimento: string, candidatos: Candidato[]): (Candidato & { nota: number })[] {
  const alvo = nomeNoEmpreendimento(empreendimento);
  if (!alvo.length) return [];
  return candidatos
    .map((c) => {
      const doCliente = palavrasDoCliente(c);
      const batem = alvo.filter((p) => doCliente.has(p));
      // Uma palavra curta e comum ("jose") sozinha não basta para sugerir.
      const forte = batem.some((p) => p.length >= 4) && (batem.length >= 2 || alvo.length === 1);
      return { ...c, nota: forte ? batem.length / alvo.length : 0 };
    })
    .filter((c) => c.nota > 0)
    .sort((a, b) => b.nota - a.nota);
}

/**
 * Vincula sozinho só quando não há dúvida: todas as palavras do nome batem, e
 * com um projeto só. Qualquer empate fica para alguém escolher na tela.
 */
export function vinculoAutomatico(empreendimento: string, candidatos: Candidato[]): string | null {
  const s = sugerirProjetos(empreendimento, candidatos).filter((c) => c.nota === 1);
  return s.length === 1 ? s[0].projetoId : null;
}

/** "1236226" — o "ID Geração" do portal, só dígitos. */
export function numeroDoProjeto(valor: unknown): string | null {
  const d = String(valor ?? "").replace(/\D/g, "");
  return d.length >= 4 && d.length <= 20 ? d : null;
}

// --- A linha crua da página -------------------------------------------------------------

/** Uma linha da lista "Meus projetos", já limpa. */
export interface ItemEnergisa {
  numero: string;
  empreendimento: string;
  endereco: string | null;
  tipo: string | null;
  dataAbertura: Date | null;
  codigo: string | null;
  descricao: string | null;
  fase: FaseEnergisa;
}

const textoOuNulo = (v: unknown) => {
  const s = typeof v === "string" ? v.trim() : v === null || v === undefined ? "" : String(v).trim();
  return s ? s : null;
};

/**
 * A linha crua da página (`dadosServerSide.solicitacao[]`) → `ItemEnergisa`.
 * Os nomes dos campos são os do JavaScript do portal; o que não vier, fica nulo.
 */
export function normalizarItem(cru: Record<string, unknown>): ItemEnergisa | null {
  const numero = numeroDoProjeto(cru.numeroProjetoEletrico);
  if (!numero) return null;
  const endereco = [cru.descricaoLogradouro, cru.numeroEndereco, cru.nomeBairro, cru.codigoUF]
    .map(textoOuNulo)
    .filter(Boolean)
    .join(", ");
  const chaveTipo = Object.keys(cru).find((k) => /^descricaoTipo/i.test(k));
  const iso = textoOuNulo(cru.dataAberturaISO);
  const data = iso ? new Date(iso) : null;
  const codigo = textoOuNulo(cru.codigoSituacaoProjetoEletrico)?.toUpperCase() ?? null;
  const descricao =
    textoOuNulo(cru.descricaoSituacaoProjetoEletrico) ?? (codigo ? (SITUACOES[codigo]?.descricao ?? null) : null);
  return {
    numero,
    empreendimento: textoOuNulo(cru.nomeEmpreendimento) ?? `Projeto ${numero}`,
    endereco: endereco || null,
    tipo: chaveTipo ? textoOuNulo(cru[chaveTipo]) : null,
    dataAbertura: data && !Number.isNaN(data.getTime()) ? data : null,
    codigo,
    descricao,
    fase: faseDe(codigo, descricao),
  };
}
