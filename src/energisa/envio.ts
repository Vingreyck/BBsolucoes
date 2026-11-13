/**
 * O envio do projeto à Energisa, sem banco: os documentos que vão no pedido, os
 * dados que o engenheiro copia para o formulário do portal e o número que o
 * portal devolve. Conferido pelo `testar-regras.ts`.
 *
 * Quem envia é o engenheiro, no portal, logado com o CPF dele: o Selebi junta
 * tudo, a extensão mostra os dados ao lado do formulário, e o clique final de
 * enviar é dele.
 */

import { ROTULO_DOCUMENTO } from "@/documentos/rotulos";

import { numeroDoProjeto } from "./situacoes";

/**
 * O que vai anexado no pedido de acesso de microgeração. Lista do mercado
 * (Lei 14.300 + guias de integradores), a confirmar com o engenheiro: corrigir
 * aqui muda a tela e o painel da extensão juntos.
 */
export const DOCUMENTOS_DO_ENVIO: { tipo: string; quando?: string }[] = [
  { tipo: "documento_pessoal" },
  { tipo: "uc_geradora" },
  { tipo: "art" },
  { tipo: "projeto_eletrico" },
  { tipo: "memorial" },
  { tipo: "datasheet" },
  { tipo: "procuracao", quando: "quando quem protocola não é o titular" },
  { tipo: "uc_beneficiaria", quando: "com mais de uma UC na compensação" },
  { tipo: "compensativo", quando: "com mais de uma UC na compensação" },
  { tipo: "declaracao", quando: "telhado de terceiro ou titular que não é o dono" },
];

export interface ItemDoEnvio {
  tipo: string;
  rotulo: string;
  tem: boolean;
  /** Preenchido nos que só vão em alguns casos: não contam como falta. */
  quando: string | null;
}

/** A lista do envio, cada documento com "está na pasta?". */
export function conferirEnvio(presentes: Set<string>): { itens: ItemDoEnvio[]; faltam: string[] } {
  const itens = DOCUMENTOS_DO_ENVIO.map((d) => ({
    tipo: d.tipo,
    rotulo: ROTULO_DOCUMENTO[d.tipo] ?? d.tipo,
    tem: presentes.has(d.tipo),
    quando: d.quando ?? null,
  }));
  return { itens, faltam: itens.filter((i) => !i.tem && !i.quando).map((i) => i.rotulo) };
}

/**
 * O número que o portal deu ao pedido ("ID Geração"), só os dígitos. É ele que
 * liga o projeto à linha que a extensão lê. Nulo se não parece número de projeto.
 */
export function lerNumeroDoPortal(texto: unknown): string | null {
  return numeroDoProjeto(typeof texto === "string" ? texto.trim() : "");
}

export interface ModeloParaOPortal {
  fabricante: string;
  modelo: string;
  potenciaW: string | number | null;
}

export interface ProjetoParaOPortal {
  cliente: {
    nome: string;
    cpfCnpj: string | null;
    telefone: string | null;
    email: string | null;
    cep: string | null;
    logradouro: string | null;
    numero: string | null;
    complemento: string | null;
    bairro: string | null;
    cidade: string | null;
    uf: string | null;
  };
  uc: { numero: string; titular: string | null; concessionaria: string } | null;
  distribuidora: string;
  potenciaKwp: string | number | null;
  inversor: ModeloParaOPortal | null;
  inversorQtd: number | null;
  modulo: ModeloParaOPortal | null;
  moduloQtd: number | null;
  telhado: string | null;
  numeroArt: string | null;
}

export interface CampoDoPortal {
  /** Chave estável: é por ela que a extensão vai achar o campo do formulário. */
  chave: string;
  rotulo: string;
  valor: string;
}

function documento(v: string | null): string | null {
  const d = (v ?? "").replace(/\D/g, "");
  if (d.length === 11) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
  if (d.length === 14) return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5");
  return d || null;
}

function cep(v: string | null): string | null {
  const d = (v ?? "").replace(/\D/g, "");
  return d.length === 8 ? `${d.slice(0, 5)}-${d.slice(5)}` : null;
}

function numero(v: string | number | null | undefined): number | null {
  const n = Number(v);
  return v === null || v === undefined || v === "" || !Number.isFinite(n) || n <= 0 ? null : n;
}

function decimal(n: number, casas: number): string {
  return n.toLocaleString("pt-BR", { maximumFractionDigits: casas });
}

/**
 * Os dados do formulário do portal, na ordem em que costumam ser pedidos. Campo
 * sem valor fica de fora: o painel mostra só o que dá para copiar.
 */
export function dadosParaOPortal(p: ProjetoParaOPortal): CampoDoPortal[] {
  const c = p.cliente;
  const qtdInv = p.inversorQtd && p.inversorQtd > 0 ? p.inversorQtd : 1;
  const qtdMod = p.moduloQtd && p.moduloQtd > 0 ? p.moduloQtd : null;
  const wInv = numero(p.inversor?.potenciaW);
  const wMod = numero(p.modulo?.potenciaW);
  const kwp = numero(p.potenciaKwp) ?? (wMod && qtdMod ? (wMod * qtdMod) / 1000 : null);

  const campos: [string, string, string | null][] = [
    ["titular", "Titular da UC", p.uc?.titular?.trim() || c.nome],
    ["cpf_cnpj", "CPF/CNPJ do titular", documento(c.cpfCnpj)],
    ["uc", "Unidade consumidora", p.uc?.numero ?? null],
    ["distribuidora", "Distribuidora", p.uc?.concessionaria ?? p.distribuidora],
    ["cep", "CEP", cep(c.cep)],
    ["logradouro", "Logradouro", c.logradouro?.trim() || null],
    ["numero", "Número", c.numero?.trim() || null],
    ["complemento", "Complemento", c.complemento?.trim() || null],
    ["bairro", "Bairro", c.bairro?.trim() || null],
    ["cidade", "Cidade", c.cidade?.trim() || null],
    ["uf", "UF", c.uf?.trim().toUpperCase() || null],
    ["telefone", "Telefone", c.telefone?.trim() || null],
    ["email", "E-mail", c.email?.trim() || null],
    ["potencia_kwp", "Potência instalada (kWp)", kwp ? decimal(kwp, 3) : null],
    ["inversor", "Inversor", p.inversor ? `${p.inversor.fabricante.trim()} ${p.inversor.modelo.trim()}` : null],
    ["inversor_qtd", "Quantidade de inversores", p.inversor ? String(qtdInv) : null],
    ["inversor_kw", "Potência dos inversores (kW)", wInv ? decimal((wInv * qtdInv) / 1000, 2) : null],
    ["modulo", "Módulo", p.modulo ? `${p.modulo.fabricante.trim()} ${p.modulo.modelo.trim()}` : null],
    ["modulo_qtd", "Quantidade de módulos", qtdMod ? String(qtdMod) : null],
    ["modulo_w", "Potência do módulo (W)", wMod ? decimal(wMod, 0) : null],
    ["telhado", "Tipo de telhado", p.telhado],
    ["art", "Número da ART", p.numeroArt?.trim() || null],
  ];
  return campos.filter((x): x is [string, string, string] => Boolean(x[2])).map(([chave, rotulo, valor]) => ({ chave, rotulo, valor }));
}
