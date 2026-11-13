/**
 * O contrato de prestação de serviços, sem banco e sem PDF: quais dados ele
 * precisa, o que falta, e os textos que mudam de um cliente para outro.
 *
 * O modelo é o contrato que a BB Soluções já usa (o do David Bruno, de 12/11).
 * Muda só o que é de cada cliente: quem contrata, o kit, o valor e a forma de
 * pagamento. O resto do texto é o do modelo, em `contrato-pdf.tsx`.
 *
 * Conferido pelo `testar-regras.ts`.
 */

import { FORMAS_PAGAMENTO, ehFormaPagamento } from "./pagamento";

// ---------------------------------------------------------------- formatação

export function formatarCpf(cpf: string): string {
  return cpf.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4");
}

export function formatarCnpj(cnpj: string): string {
  return cnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
}

export function formatarCep(cep: string): string {
  return cep.replace(/^(\d{5})(\d{3})$/, "$1-$2");
}

export function formatarReais(valor: number): string {
  return valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }).replace(/ /g, " ");
}

// ---------------------------------------------------------------- por extenso

const UNIDADES = ["", "um", "dois", "três", "quatro", "cinco", "seis", "sete", "oito", "nove"];
const DEZ_A_DEZENOVE = [
  "dez", "onze", "doze", "treze", "quatorze", "quinze", "dezesseis", "dezessete", "dezoito", "dezenove",
];
const DEZENAS = ["", "", "vinte", "trinta", "quarenta", "cinquenta", "sessenta", "setenta", "oitenta", "noventa"];
const CENTENAS = [
  "", "cento", "duzentos", "trezentos", "quatrocentos", "quinhentos", "seiscentos", "setecentos", "oitocentos",
  "novecentos",
];

/** 0 a 999, por extenso. */
function ateMil(n: number): string {
  if (n === 0) return "";
  if (n === 100) return "cem";
  const c = Math.floor(n / 100);
  const resto = n % 100;
  const partes: string[] = [];
  if (c) partes.push(CENTENAS[c]);
  if (resto >= 10 && resto < 20) partes.push(DEZ_A_DEZENOVE[resto - 10]);
  else {
    const d = Math.floor(resto / 10);
    const u = resto % 10;
    if (d) partes.push(DEZENAS[d]);
    if (u) partes.push(UNIDADES[u]);
  }
  return partes.join(" e ");
}

/** Um inteiro por extenso, até 999.999.999. */
export function inteiroPorExtenso(n: number): string {
  if (n === 0) return "zero";
  const milhoes = Math.floor(n / 1_000_000);
  const milhares = Math.floor((n % 1_000_000) / 1000);
  const resto = n % 1000;

  const grupos: string[] = [];
  let ultimo = 0;
  if (milhoes) {
    grupos.push(milhoes === 1 ? "um milhão" : `${ateMil(milhoes)} milhões`);
    ultimo = milhoes;
  }
  if (milhares) {
    grupos.push(milhares === 1 ? "mil" : `${ateMil(milhares)} mil`);
    ultimo = milhares;
  }
  if (resto) {
    grupos.push(ateMil(resto));
    ultimo = resto;
  }

  // "e" antes do último grupo quando ele é só centena redonda ou menor que cem:
  // "mil e quinhentos", "dois mil e trinta", "dois milhões e quinhentos mil";
  // mas "mil duzentos e trinta".
  if (grupos.length > 1 && (ultimo < 100 || ultimo % 100 === 0)) {
    const fim = grupos.pop()!;
    return `${grupos.join(" ")} e ${fim}`;
  }
  return grupos.join(" ");
}

/** 18500.5 → "dezoito mil e quinhentos reais e cinquenta centavos". */
export function reaisPorExtenso(valor: number): string {
  const centavosTotais = Math.round(valor * 100);
  const reais = Math.floor(centavosTotais / 100);
  const centavos = centavosTotais % 100;
  const partes: string[] = [];
  if (reais) {
    const exatoEmMilhao = reais >= 1_000_000 && reais % 1_000_000 === 0;
    partes.push(`${inteiroPorExtenso(reais)}${exatoEmMilhao ? " de" : ""} ${reais === 1 ? "real" : "reais"}`);
  }
  if (centavos) partes.push(`${inteiroPorExtenso(centavos)} ${centavos === 1 ? "centavo" : "centavos"}`);
  return partes.length ? partes.join(" e ") : "zero reais";
}

// ---------------------------------------------------------------- o contrato

export interface EntradaContrato {
  cliente: {
    nome: string;
    tipo: "pf" | "pj";
    cpfCnpj: string | null;
    logradouro: string | null;
    numero: string | null;
    complemento: string | null;
    bairro: string | null;
    cidade: string | null;
    uf: string | null;
    cep: string | null;
  };
  projeto: {
    equipamentos: string | null;
    valor: string | number | null;
    formaPagamento: string | null;
    pagamentoCondicoes: string | null;
  };
  empresa: {
    nome: string;
    razaoSocial: string | null;
    cnpj: string | null;
    endereco: string | null;
    email: string | null;
  };
  representante: { nome: string; cpf: string | null } | null;
}

/** A fotografia do contrato, guardada em `contrato.dados` e lida pelo PDF. */
export interface DadosContrato {
  contratante: {
    nome: string;
    /** "brasileiro(a), inscrito(a) no CPF sob o nº 000.000.000-00" */
    qualificacao: string;
    documento: string;
    endereco: string;
  };
  contratado: {
    nomeFantasia: string;
    razaoSocial: string;
    cnpj: string;
    endereco: string;
    email: string;
    representante: string;
    representanteCpf: string | null;
  };
  equipamentos: string;
  valor: number;
  /** A frase inteira do pagamento, como entra na cláusula 4. */
  pagamento: string;
  geradoEm: string;
}

function vazio(v: string | null | undefined): boolean {
  return !v || !v.trim();
}

/**
 * O que falta para gerar o contrato, em palavras de quem vai preencher.
 *
 * Vazio = dá para gerar. A tela mostra esta lista em vez do botão, para a
 * pessoa saber exatamente o que completar e onde.
 */
export function faltaParaContrato(e: EntradaContrato): string[] {
  const falta: string[] = [];
  const c = e.cliente;
  const doc = (c.cpfCnpj ?? "").replace(/\D/g, "");
  if (c.tipo === "pj" ? doc.length !== 14 : doc.length !== 11) falta.push(c.tipo === "pj" ? "CNPJ do cliente" : "CPF do cliente");
  if (vazio(c.logradouro)) falta.push("endereço do cliente (rua)");
  if (vazio(c.numero)) falta.push("número da casa");
  if (vazio(c.bairro)) falta.push("bairro");
  if (vazio(c.cidade)) falta.push("cidade");
  if ((c.cep ?? "").replace(/\D/g, "").length !== 8) falta.push("CEP");

  const p = e.projeto;
  if (vazio(p.equipamentos)) falta.push("equipamentos do kit (inversores, módulos, estrutura)");
  const valor = Number(p.valor);
  if (p.valor === null || p.valor === "" || !Number.isFinite(valor) || valor <= 0) falta.push("valor total");
  if (!ehFormaPagamento(p.formaPagamento)) falta.push("forma de pagamento");

  const em = e.empresa;
  if (vazio(em.razaoSocial)) falta.push("razão social da empresa");
  if ((em.cnpj ?? "").replace(/\D/g, "").length !== 14) falta.push("CNPJ da empresa");
  if (vazio(em.endereco)) falta.push("endereço da empresa");
  if (vazio(em.email)) falta.push("e-mail da empresa");

  if (!e.representante) falta.push("quem assina pela empresa");
  return falta;
}

/** Só os itens que são da empresa: a tela manda o adm para outra página para eles. */
export function faltaDaEmpresa(falta: string[]): string[] {
  return falta.filter((f) => f.endsWith("da empresa"));
}

/** "Rua X nº 62, Apto 802 - Jardins, Aracaju/SE, CEP 49025-180", como no modelo. */
export function enderecoDoContratante(c: EntradaContrato["cliente"]): string {
  const rua = `${c.logradouro!.trim()} nº ${c.numero!.trim()}`;
  const comComplemento = vazio(c.complemento) ? rua : `${rua}, ${c.complemento!.trim()}`;
  const cidade = vazio(c.uf) ? c.cidade!.trim() : `${c.cidade!.trim()}/${c.uf!.trim().toUpperCase()}`;
  return `${comComplemento} - ${c.bairro!.trim()}, ${cidade}, CEP ${formatarCep((c.cep ?? "").replace(/\D/g, ""))}`;
}

/** A cláusula 4: "R$ 50.000,00 (cinquenta mil reais), cartão de crédito: 6x sem juros." */
export function fraseDoPagamento(valor: number, forma: string, condicoes: string | null): string {
  const rotulo = ehFormaPagamento(forma) ? FORMAS_PAGAMENTO[forma] : forma;
  const formaTexto = rotulo.charAt(0).toLowerCase() + rotulo.slice(1);
  const resto = vazio(condicoes) ? "" : `: ${condicoes!.trim().replace(/[.;\s]+$/, "")}`;
  return `O(a) CONTRATANTE efetuará o pagamento de ${formatarReais(valor)} (${reaisPorExtenso(valor)}), ${formaTexto}${resto}.`;
}

/**
 * Monta a fotografia do contrato. Só chame com `faltaParaContrato` vazia —
 * aqui os campos obrigatórios já são dados como presentes.
 */
export function montarContrato(e: EntradaContrato, agora = new Date()): DadosContrato {
  const c = e.cliente;
  const doc = (c.cpfCnpj ?? "").replace(/\D/g, "");
  const pj = c.tipo === "pj";
  const documento = pj ? formatarCnpj(doc) : formatarCpf(doc);
  const valor = Number(e.projeto.valor);
  return {
    contratante: {
      nome: c.nome.trim(),
      qualificacao: pj
        ? `pessoa jurídica inscrita no CNPJ sob o nº ${documento}`
        : `brasileiro(a), inscrito(a) no CPF sob o nº ${documento}`,
      documento,
      endereco: enderecoDoContratante(c),
    },
    contratado: {
      nomeFantasia: e.empresa.nome.trim(),
      razaoSocial: e.empresa.razaoSocial!.trim(),
      cnpj: formatarCnpj((e.empresa.cnpj ?? "").replace(/\D/g, "")),
      endereco: e.empresa.endereco!.trim(),
      email: e.empresa.email!.trim(),
      representante: e.representante!.nome.trim(),
      representanteCpf: e.representante!.cpf ? formatarCpf(e.representante!.cpf) : null,
    },
    equipamentos: e.projeto.equipamentos!.trim().replace(/\.+$/, ""),
    valor,
    pagamento: fraseDoPagamento(valor, e.projeto.formaPagamento!, e.projeto.pagamentoCondicoes),
    geradoEm: agora.toISOString(),
  };
}

/** A mensagem que vai com o link do contrato pelo WhatsApp. */
export function mensagemDoContrato(d: { cliente: string; empresa: string; link: string }): string {
  const nome = d.cliente.trim().split(/\s+/)[0] ?? "";
  const primeiro = nome ? nome.charAt(0).toUpperCase() + nome.slice(1).toLowerCase() : "";
  return [
    `Olá${primeiro ? `, ${primeiro}` : ""}! Aqui é da ${d.empresa}. Segue o seu contrato de prestação de serviços:`,
    d.link,
    "",
    "Confira os dados, assine e nos devolva por aqui. Pode ser assinado à mão (foto ou escaneado, todas as páginas) ou pelo gov.br. Qualquer dúvida, é só chamar. Obrigado!",
  ].join("\n");
}

// ------------------------------------------------- pedir os dados ao cliente

/** Os dados do cliente que o contrato exige e que o cliente é quem tem na mão. */
export type DadoDoCliente = "cpf" | "cep" | "endereco";

/**
 * O que falta do cliente: o CPF (ou CNPJ), o CEP e o endereço (rua, número e
 * bairro). Cidade e telefone não entram: a cidade vem na criação do projeto e
 * o telefone é o que permite fazer o pedido.
 */
export function dadosDoClienteQueFaltam(c: {
  tipo: "pf" | "pj";
  cpfCnpj: string | null;
  logradouro: string | null;
  numero: string | null;
  bairro: string | null;
  cep: string | null;
}): DadoDoCliente[] {
  const falta: DadoDoCliente[] = [];
  const doc = (c.cpfCnpj ?? "").replace(/\D/g, "");
  if (c.tipo === "pj" ? doc.length !== 14 : doc.length !== 11) falta.push("cpf");
  if ((c.cep ?? "").replace(/\D/g, "").length !== 8) falta.push("cep");
  if (vazio(c.logradouro) || vazio(c.numero) || vazio(c.bairro)) falta.push("endereco");
  return falta;
}

/** O texto do botão: "Cobrar CPF no WhatsApp" quando só ele falta, senão "Pedir dados…". */
export function rotuloDoPedidoDeDados(falta: DadoDoCliente[], pj = false): string {
  return falta.length === 1 && falta[0] === "cpf"
    ? `Cobrar ${pj ? "CNPJ" : "CPF"} no WhatsApp`
    : "Pedir dados no WhatsApp";
}

const PEDIDO_DE_DADO = (pj: boolean): Record<DadoDoCliente, string> => ({
  cpf: pj ? "o CNPJ da empresa" : "o seu CPF",
  cep: "o CEP do imóvel onde vão ficar as placas",
  endereco: "o endereço completo do imóvel (rua, número e bairro)",
});

/** A mensagem pedindo só o que falta. Quem manda ainda pode mexer: o WhatsApp abre com o texto no campo. */
export function mensagemDeDadosDoCliente(d: {
  cliente: string;
  empresa: string;
  faltam: DadoDoCliente[];
  pj?: boolean;
}): string {
  const nome = d.cliente.trim().split(/\s+/)[0] ?? "";
  const primeiro = nome ? nome.charAt(0).toUpperCase() + nome.slice(1).toLowerCase() : "";
  const textos = PEDIDO_DE_DADO(Boolean(d.pj));
  return [
    `Olá${primeiro ? `, ${primeiro}` : ""}! Aqui é da ${d.empresa}. Para preparar o seu contrato de energia solar, preciso de:`,
    ...d.faltam.map((f) => `• ${textos[f]}`),
    "",
    "Pode mandar por aqui mesmo. Obrigado!",
  ].join("\n");
}
