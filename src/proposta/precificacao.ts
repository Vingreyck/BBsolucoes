/**
 * O preço da proposta: o kit, os custos da empresa (projeto, mão de obra,
 * material CA, frete, deslocamento…), a margem e o imposto. Sem banco —
 * conferido pelo `testar-regras.ts`.
 *
 * É a aba "Precificação" do Solarz: cada custo tem um tipo (fixo, por kWp, por
 * módulo, por inversor, percentual, faixa por potência) e pode valer só para
 * alguns telhados. A margem pode ser "por dentro" (preço = custo ÷ (1 − margem
 * − imposto), a margem é parte do preço) ou "por fora" (custo × (1 + margem),
 * e o imposto por dentro em cima disso).
 */

import type { ItemDeCusto, Premissas } from "./premissas";

export interface LinhaDeCusto {
  id: string;
  nome: string;
  grupo: "kit" | "material" | "servico" | "outro";
  valor: number;
}

export interface EntradaDoPreco {
  /** Quanto o kit custa para a empresa (o total, ou a soma dos preços de custo). */
  custoKit: number;
  kwp: number;
  modulos: number;
  inversores: number;
  /** O tipo de telhado (uma das opções da vistoria), para os custos que dependem dele. */
  telhado: string | null;
  /** Distância de ida, em km, da base da equipe até a cidade do cliente. */
  distanciaKm: number | null;
  /** Custos do assistente: ligados ou desligados, e valor mudado à mão. */
  ajustes?: Record<string, { ativo?: boolean; valor?: number }>;
  /** Custos avulsos desta proposta. */
  extras?: { nome: string; valor: number }[];
}

export interface ResultadoDoPreco {
  linhas: LinhaDeCusto[];
  custoTotal: number;
  /** Preço calculado pela margem e pelo imposto, já arredondado. */
  precoSugerido: number;
  margemValor: number;
  impostoValor: number;
}

/** O valor de um custo para esta proposta (0 se não se aplica ao telhado). */
export function valorDoCusto(item: ItemDeCusto, e: EntradaDoPreco, custoAteAqui: number): number {
  if (item.estruturas?.length && !(e.telhado && item.estruturas.includes(e.telhado))) return 0;
  switch (item.tipo) {
    case "fixo":
      return item.valor;
    case "por_kwp":
      return item.valor * e.kwp;
    case "por_modulo":
      return item.valor * e.modulos;
    case "por_inversor":
      return item.valor * e.inversores;
    case "percentual":
      return item.valor * (item.base === "custo" ? custoAteAqui : e.custoKit);
    case "faixa_kwp": {
      const faixas = item.faixas ?? [];
      const f = faixas.find((x) => e.kwp <= x.ateKwp + 1e-9) ?? faixas[faixas.length - 1];
      return f ? f.valor : 0;
    }
  }
}

/** Arredonda para cima no múltiplo pedido (0 = só centavos). */
export function arredondarPreco(v: number, multiplo: number): number {
  if (!(multiplo > 0)) return Math.round(v * 100) / 100;
  return Math.ceil(v / multiplo - 1e-9) * multiplo;
}

export function calcularPreco(e: EntradaDoPreco, p: Pick<Premissas, "precificacao" | "logistica">): ResultadoDoPreco {
  const linhas: LinhaDeCusto[] = [{ id: "kit", nome: "Kit (módulos, inversores e estrutura)", grupo: "kit", valor: e.custoKit }];
  let custo = e.custoKit;
  for (const item of p.precificacao.itens) {
    const ajuste = e.ajustes?.[item.id];
    if (ajuste?.ativo === false) continue;
    const calculado = valorDoCusto(item, e, custo);
    const valor = ajuste?.valor !== undefined && Number.isFinite(ajuste.valor) && ajuste.valor >= 0 ? ajuste.valor : calculado;
    if (valor <= 0 && ajuste?.valor === undefined) continue;
    linhas.push({ id: item.id, nome: item.nome, grupo: item.grupo, valor });
    custo += valor;
  }
  // Deslocamento além do raio, ida e volta.
  const lo = p.logistica;
  if (e.distanciaKm !== null && e.distanciaKm > lo.raioKm && lo.valorKm > 0) {
    const ajuste = e.ajustes?.logistica;
    if (ajuste?.ativo !== false) {
      const calculado = (e.distanciaKm - lo.raioKm) * 2 * lo.valorKm;
      const valor = ajuste?.valor !== undefined && ajuste.valor >= 0 ? ajuste.valor : calculado;
      linhas.push({ id: "logistica", nome: `Deslocamento (${Math.round(e.distanciaKm)} km da base)`, grupo: "outro", valor });
      custo += valor;
    }
  }
  for (const [i, x] of (e.extras ?? []).entries()) {
    if (!(x.valor > 0) || !x.nome.trim()) continue;
    linhas.push({ id: `extra-${i + 1}`, nome: x.nome.trim(), grupo: "outro", valor: x.valor });
    custo += x.valor;
  }

  const { margem, imposto, margemPorDentro, arredondar } = p.precificacao;
  const bruto = margemPorDentro ? custo / (1 - margem - imposto) : (custo * (1 + margem)) / (1 - imposto);
  const precoSugerido = arredondarPreco(bruto, arredondar);
  const impostoValor = precoSugerido * imposto;
  return {
    linhas,
    custoTotal: custo,
    precoSugerido,
    margemValor: precoSugerido - custo - impostoValor,
    impostoValor,
  };
}

/** A margem que sobra num preço escolhido à mão (desconto ou acréscimo): fração do preço. */
export function margemDoPreco(preco: number, custoTotal: number, imposto: number): number {
  if (!(preco > 0)) return 0;
  return (preco - custoTotal - preco * imposto) / preco;
}
