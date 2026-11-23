/**
 * O tamanho do sistema e o kit: quantos kWp zeram as contas, quantos módulos,
 * que inversor (ou quantos microinversores) e o que está fora do lugar no kit
 * montado. Sem banco — conferido pelo `testar-regras.ts`.
 *
 * O Solarz sugere o kit pelos kits prontos dos distribuidores; aqui a sugestão
 * sai da base de equipamentos (os modelos que mais se instalam no Brasil e em
 * Sergipe) e do catálogo da empresa, e quem vende confere e troca.
 */

import { DISPONIBILIDADE_KWH, type Ligacao } from "./calculo";
import { geracaoPorKwpAno } from "./simulacao";

export interface ConsumoDaUc {
  ligacao: Ligacao;
  consumoMes: number[];
}

/**
 * A potência que zera as contas: a energia que dá para compensar no ano (o
 * consumo menos o mínimo da distribuidora, de cada unidade) dividida pelo que
 * cada kWp gera no ano na cidade.
 */
export function potenciaNecessariaKwp(ucs: ConsumoDaUc[], irradiacaoMensal: number[], desempenho: number): number | null {
  const compensavel = ucs.reduce(
    (s, u) => s + Math.max(0, u.consumoMes.reduce((a, b) => a + b, 0) - DISPONIBILIDADE_KWH[u.ligacao] * 12),
    0,
  );
  const porKwp = geracaoPorKwpAno(irradiacaoMensal, desempenho);
  if (!(compensavel > 0) || !(porKwp > 0)) return null;
  return compensavel / porKwp;
}

/** Módulos inteiros para chegar à potência (arredonda para cima). */
export function modulosParaPotencia(kwp: number, moduloW: number): number {
  if (!(kwp > 0) || !(moduloW > 0)) return 0;
  return Math.max(1, Math.ceil((kwp * 1000) / moduloW - 1e-9));
}

export interface InversorCandidato {
  id: string;
  nome: string;
  tipo: "inversor" | "microinversor";
  potenciaW: number;
  fases?: 1 | 3 | null;
  /** Micro: quantos módulos cada unidade recebe. */
  modulosPorUnidade?: number | null;
  /** Peso de preferência (catálogo da empresa e uso em Sergipe pesam mais). */
  preferencia?: number;
}

export interface LinhaDeInversor {
  inversor: InversorCandidato;
  qtd: number;
}

/** Fases que a ligação aceita: monofásica e bifásica levam inversor monofásico; trifásica leva qualquer um. */
export function fasesAceitas(ligacao: Ligacao): (1 | 3)[] {
  return ligacao === "trifasico" ? [1, 3] : [1];
}

/**
 * O inversor (ou os micros) para os módulos escolhidos.
 *
 * - Inversor de string: a menor quantidade de aparelhos iguais em que a relação
 *   CC/CA (potência de módulos ÷ potência do inversor) fica até o máximo, e
 *   entre esses a mais perto do alvo. Empate: o preferido (catálogo, uso).
 * - Microinversor: um para cada N módulos (as entradas do modelo).
 *
 * Inversor de fases que a ligação não aceita fica de fora. Nulo: nenhum serve.
 */
export function sugerirInversores(
  modulos: { qtd: number; potenciaW: number },
  candidatos: InversorCandidato[],
  sobre: { alvo: number; maximo: number },
  ligacao: Ligacao,
  tipo: "inversor" | "microinversor",
): LinhaDeInversor[] | null {
  const dcW = modulos.qtd * modulos.potenciaW;
  if (!(dcW > 0)) return null;
  const aceitas = fasesAceitas(ligacao);
  const daLigacao = candidatos.filter((c) => c.tipo === tipo && c.potenciaW > 0 && (!c.fases || aceitas.includes(c.fases)));

  type Opcao = { linha: LinhaDeInversor; nota: number };
  const opcoes: Opcao[] = [];
  for (const c of daLigacao) {
    if (tipo === "microinversor") {
      const entradas = c.modulosPorUnidade ?? 0;
      if (entradas < 1) continue;
      const qtd = Math.ceil(modulos.qtd / entradas);
      const relacao = dcW / (qtd * c.potenciaW);
      if (relacao > sobre.maximo) continue;
      // Menos micros e entradas sem sobrar muito; depois a relação perto do alvo.
      const vagas = qtd * entradas - modulos.qtd;
      const nota = qtd * 10 + vagas * 3 + Math.abs(relacao - sobre.alvo) * 5 - (c.preferencia ?? 0);
      opcoes.push({ linha: { inversor: c, qtd }, nota });
    } else {
      const qtd = Math.max(1, Math.ceil(dcW / (c.potenciaW * sobre.maximo) - 1e-9));
      const relacao = dcW / (qtd * c.potenciaW);
      if (relacao < 0.75) continue; // inversor grande demais para o arranjo
      const nota = qtd * 100 + Math.abs(relacao - sobre.alvo) * 40 - (c.preferencia ?? 0);
      opcoes.push({ linha: { inversor: c, qtd }, nota });
    }
  }
  if (!opcoes.length) return null;
  opcoes.sort((a, b) => a.nota - b.nota);
  return [opcoes[0].linha];
}

export type NivelDoAviso = "erro" | "atencao" | "ok";
export interface AvisoDoKit {
  nivel: NivelDoAviso;
  texto: string;
}

/** A relação CC/CA do kit: potência de módulos ÷ potência dos inversores (nulo sem inversor). */
export function relacaoCcCa(modulos: { qtd: number; potenciaW: number }, inversores: { potenciaW: number; qtd: number }[]): number | null {
  const ca = inversores.reduce((s, i) => s + i.potenciaW * i.qtd, 0);
  return ca > 0 ? (modulos.qtd * modulos.potenciaW) / ca : null;
}

const br = (n: number, casas = 2) => n.toLocaleString("pt-BR", { maximumFractionDigits: casas, minimumFractionDigits: casas });

/**
 * O que está fora do lugar no kit, em palavras de quem vende: falta inversor,
 * módulo demais para o inversor, micro sem entrada para todos os módulos,
 * inversor trifásico em casa monofásica.
 */
export function avaliarKit(k: {
  modulos: { qtd: number; potenciaW: number };
  inversores: { nome: string; tipo: "inversor" | "microinversor"; potenciaW: number; qtd: number; modulosPorUnidade?: number | null; fases?: 1 | 3 | null }[];
  sobre: { alvo: number; maximo: number };
  ligacao: Ligacao;
}): AvisoDoKit[] {
  const avisos: AvisoDoKit[] = [];
  if (!(k.modulos.qtd > 0) || !(k.modulos.potenciaW > 0)) {
    avisos.push({ nivel: "erro", texto: "Escolha o módulo e a quantidade." });
    return avisos;
  }
  const comInversor = k.inversores.filter((i) => i.qtd > 0 && i.potenciaW > 0);
  if (!comInversor.length) {
    avisos.push({ nivel: "erro", texto: "Falta o inversor (ou os microinversores)." });
    return avisos;
  }
  const r = relacaoCcCa(k.modulos, comInversor)!;
  if (r > k.sobre.maximo + 1e-9) {
    avisos.push({
      nivel: "erro",
      texto: `Módulos demais para o inversor: ${br(r)} de potência de módulos para cada 1 de inversor (o máximo configurado é ${br(k.sobre.maximo)}). Aumente o inversor ou tire módulos.`,
    });
  } else if (r < 0.8) {
    avisos.push({ nivel: "atencao", texto: `Inversor folgado: a relação CC/CA é ${br(r)}. Um inversor menor sai mais barato, ou cabem mais módulos.` });
  } else {
    avisos.push({ nivel: "ok", texto: `Relação CC/CA de ${br(r)} (alvo ${br(k.sobre.alvo)}, máximo ${br(k.sobre.maximo)}).` });
  }

  const micros = comInversor.filter((i) => i.tipo === "microinversor");
  if (micros.length) {
    const entradas = micros.reduce((s, i) => s + (i.modulosPorUnidade ?? 0) * i.qtd, 0);
    const semEntrada = micros.some((i) => !i.modulosPorUnidade);
    if (semEntrada) {
      avisos.push({ nivel: "atencao", texto: "Não sei quantas entradas tem o microinversor: confira no datasheet se todos os módulos cabem." });
    } else if (entradas < k.modulos.qtd) {
      avisos.push({ nivel: "erro", texto: `Faltam entradas: ${k.modulos.qtd} módulos e só ${entradas} entradas nos microinversores.` });
    } else if (entradas - k.modulos.qtd >= Math.max(...micros.map((i) => i.modulosPorUnidade ?? 1))) {
      avisos.push({ nivel: "atencao", texto: `Sobra um microinversor inteiro: ${entradas} entradas para ${k.modulos.qtd} módulos.` });
    }
  }

  const aceitas = fasesAceitas(k.ligacao);
  for (const i of comInversor) {
    if (i.fases && !aceitas.includes(i.fases)) {
      avisos.push({ nivel: "erro", texto: `${i.nome} é trifásico, e a ligação do cliente não é trifásica.` });
    }
  }
  return avisos;
}

/**
 * Área de telhado que os módulos ocupam, com folga para corredor e fixação.
 * Sem a área do datasheet, estima pela potência (módulo de ~21% de eficiência).
 */
export function areaDosModulos(qtd: number, moduloW: number, areaM2?: number | null): number {
  const uma = areaM2 && areaM2 > 0 ? areaM2 : moduloW / 210;
  return Math.ceil(qtd * uma * 1.15);
}
