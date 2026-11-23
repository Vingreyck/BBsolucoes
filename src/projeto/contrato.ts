/**
 * O contrato de prestação de serviços, sem banco e sem PDF: quais dados ele
 * precisa, o que falta, e os textos que mudam de um cliente para outro.
 *
 * O modelo é o "CONTRATO MODELO (CONTRATADO)" que a BB Soluções usa desde
 * 21/11 (o anterior era o do David Bruno, de 12/11). Muda só o que é de cada
 * cliente: quem contrata, o kit, o valor, a entrada e as parcelas, e as
 * garantias (as das premissas da proposta). O resto do texto é o do modelo,
 * em `contrato-pdf.tsx`.
 *
 * Conferido pelo `testar-regras.ts`.
 */

import { lerNumeroBr } from "../proposta/proposta";
import { ehFormaPagamento, type FormaPagamento } from "./pagamento";

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

export interface Garantias {
  inversor: number;
  placas: number;
  estrutura: number;
  eficiencia: number;
}

/**
 * As garantias escritas no modelo de contrato da empresa. Valem só quando as
 * premissas da proposta ainda não foram salvas (e para os contratos gerados
 * antes de 21/11, que não guardavam as garantias).
 */
export const GARANTIAS_DO_MODELO: Garantias = { inversor: 10, placas: 12, estrutura: 10, eficiencia: 25 };

/** A entrada e o saldo, quando a venda foi com entrada (preenchidos ao gerar o contrato). */
export interface PagamentoCombinado {
  entrada: number;
  /** Em quantas parcelas o saldo é pago (1 = de uma vez). */
  parcelas: number;
  /** "após a finalização do projeto", como no modelo, se ninguém escrever outra coisa. */
  quando: string | null;
}

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
  /** Entrada e parcelas do saldo; nulo quando não houve entrada. */
  pagamento?: PagamentoCombinado | null;
  /** As garantias das premissas da proposta; nulo usa as do modelo. */
  garantias?: Garantias | null;
}

/** A fotografia do contrato, guardada em `contrato.dados` e lida pelo PDF. */
export interface DadosContrato {
  contratante: {
    nome: string;
    /** "brasileiro(a), inscrito(a) sob o nº CPF 000.000.000-00" */
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
    /** Quem assina pela empresa. Desde 21/11 não sai escrito no contrato (o modelo não traz). */
    representante: string;
    representanteCpf: string | null;
  };
  equipamentos: string;
  valor: number;
  /** A frase inteira do pagamento, como entra na cláusula "Do pagamento". */
  pagamento: string;
  /** Guardado para o próximo "Gerar de novo" já vir preenchido. Ausente antes de 21/11. */
  combinado?: PagamentoCombinado | null;
  /** Ausente nos contratos de antes de 21/11: o PDF usa as do modelo. */
  garantias?: Garantias;
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

/** "Rua X, nº 62, Apto 802 - Centro, Itabaiana - SE, CEP: 49500-000", como no modelo. */
export function enderecoDoContratante(c: EntradaContrato["cliente"]): string {
  const rua = `${c.logradouro!.trim()}, nº ${c.numero!.trim()}`;
  const comComplemento = vazio(c.complemento) ? rua : `${rua}, ${c.complemento!.trim()}`;
  const cidade = vazio(c.uf) ? c.cidade!.trim() : `${c.cidade!.trim()} - ${c.uf!.trim().toUpperCase()}`;
  return `${comComplemento} - ${c.bairro!.trim()}, ${cidade}, CEP: ${formatarCep((c.cep ?? "").replace(/\D/g, ""))}`;
}

/** Como cada forma entra no meio da frase do pagamento. */
const FORMA_NA_FRASE: Record<FormaPagamento, string> = {
  a_vista: "à vista, por PIX ou transferência",
  financiamento: "por financiamento bancário",
  cartao: "no cartão de crédito",
  boleto: "por boleto comercial",
  cheque: "em cheque",
  misto: "com entrada e o saldo parcelado",
};

/** "R$ 2.800,00 (dois mil e oitocentos reais)" */
function reais(v: number): string {
  return `${formatarReais(v)} (${reaisPorExtenso(v)})`;
}

/** Contagem no feminino, para "parcelas": "duas", "vinte e uma". */
function parcelasPorExtenso(n: number): string {
  return inteiroPorExtenso(n).replace(/\bum\b/g, "uma").replace(/\bdois\b/g, "duas");
}

/**
 * A cláusula "Do pagamento", no texto do modelo.
 *
 * Com entrada: "O(A) CONTRATANTE efetuará o pagamento de entrada no valor de
 * R$ 2.800,00 (…), referente ao valor total do projeto, fixado em R$ 14.000,00
 * (…), ficando o saldo remanescente de R$ 11.200,00 (…) dividido em duas
 * parcelas de R$ 5.600,00 (…), a serem pagas após a finalização do projeto."
 *
 * Sem entrada: o valor total, a forma e as condições combinadas.
 */
export function fraseDoPagamento(
  valor: number,
  forma: string,
  condicoes: string | null,
  combinado: PagamentoCombinado | null = null,
): string {
  const modo = ehFormaPagamento(forma) ? FORMA_NA_FRASE[forma] : `por ${forma}`;
  if (combinado) {
    const saldoCent = Math.round(valor * 100) - Math.round(combinado.entrada * 100);
    const n = combinado.parcelas;
    const quando = vazio(combinado.quando)
      ? "após a finalização do projeto"
      : combinado.quando!.trim().replace(/[.;\s]+$/, "");
    // Forma que não é "entrada + parcelado" diz como o saldo é pago (financiamento, cartão…).
    const como = ehFormaPagamento(forma) && forma !== "misto" ? `, ${modo}` : "";
    let saldo: string;
    if (n <= 1) saldo = `a ser pago${como}${como ? "," : ""} ${quando}`;
    else {
      const parcela = Math.floor(saldoCent / n);
      const ultima = saldoCent - parcela * (n - 1);
      saldo =
        `dividido em ${parcelasPorExtenso(n)} parcelas de ${reais(parcela / 100)}` +
        (ultima !== parcela ? `, sendo a última de ${reais(ultima / 100)}` : "") +
        `${como}, a serem pagas ${quando}`;
    }
    return (
      `O(A) CONTRATANTE efetuará o pagamento de entrada no valor de ${reais(combinado.entrada)}, ` +
      `referente ao valor total do projeto, fixado em ${reais(valor)}, ` +
      `ficando o saldo remanescente de ${reais(saldoCent / 100)} ${saldo}.`
    );
  }
  const resto = vazio(condicoes) ? "" : `: ${condicoes!.trim().replace(/[.;\s]+$/, "")}`;
  return `O(A) CONTRATANTE efetuará o pagamento no valor de ${reais(valor)}, referente ao valor total do projeto, ${modo}${resto}.`;
}

/**
 * Lê a entrada e as parcelas do formulário "Gerar contrato". Entrada em branco
 * = sem entrada (vale a frase com a forma e as condições do projeto).
 */
export function lerPagamentoCombinado(
  campos: { entrada: string; parcelas: string; quando: string },
  valor: number,
): { combinado: PagamentoCombinado | null } | { erro: string } {
  if (!campos.entrada.trim()) return { combinado: null };
  const entrada = lerNumeroBr(campos.entrada);
  if (entrada === null) return { erro: "Entrada inválida: escreva o valor em reais, como 2.800,00." };
  if (!(valor > 0) || Math.round(entrada * 100) >= Math.round(valor * 100)) {
    return { erro: `A entrada precisa ser menor que o valor total do projeto (${formatarReais(valor)}).` };
  }
  const p = campos.parcelas.trim() ? Number(campos.parcelas.trim()) : 1;
  if (!Number.isInteger(p) || p < 1 || p > 120) return { erro: "Número de parcelas do saldo inválido: de 1 a 120." };
  const quando = campos.quando.trim().slice(0, 200) || null;
  return { combinado: { entrada: Math.round(entrada * 100) / 100, parcelas: p, quando } };
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
        ? `pessoa jurídica inscrita sob o nº CNPJ ${documento}`
        : `brasileiro(a), inscrito(a) sob o nº CPF ${documento}`,
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
    pagamento: fraseDoPagamento(valor, e.projeto.formaPagamento!, e.projeto.pagamentoCondicoes, e.pagamento ?? null),
    combinado: e.pagamento ?? null,
    garantias: e.garantias ?? GARANTIAS_DO_MODELO,
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
