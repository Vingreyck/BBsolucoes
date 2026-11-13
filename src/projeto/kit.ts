/**
 * O kit do projeto em palavras: o nome de um modelo do catálogo e o texto que
 * entra como "Equipamentos" no contrato. Sem banco — conferido pelo
 * `testar-regras.ts`.
 */

import { estruturaDoTelhado } from "./da-vistoria";

export interface ModeloDoKit {
  tipo: string;
  fabricante: string;
  modelo: string;
  potenciaW: string | number | null;
}

/** "10 kW", "625 W": potência legível (inversor em kW, módulo em W). */
export function potenciaLegivel(potenciaW: string | number | null, tipo: string): string | null {
  const w = Number(potenciaW);
  if (potenciaW === null || potenciaW === "" || !Number.isFinite(w) || w <= 0) return null;
  if (tipo === "modulo") return `${w.toLocaleString("pt-BR", { maximumFractionDigits: 0 })} W`;
  return `${(w / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 2 })} kW`;
}

/** "Growatt MIN 10000TL-X (10 kW)" — o nome do modelo nas listas. */
export function rotuloDoModelo(m: ModeloDoKit): string {
  const pot = potenciaLegivel(m.potenciaW, m.tipo);
  return `${m.fabricante.trim()} ${m.modelo.trim()}${pot ? ` (${pot})` : ""}`;
}

const NOME_DO_TIPO: Record<string, [string, string]> = {
  inversor: ["inversor", "inversores"],
  microinversor: ["microinversor", "microinversores"],
  modulo: ["módulo fotovoltaico", "módulos fotovoltaicos"],
};

function parte(qtd: number | null, m: ModeloDoKit | null): string | null {
  if (!m) return null;
  const n = qtd && qtd > 0 ? qtd : 1;
  const [um, varios] = NOME_DO_TIPO[m.tipo] ?? [m.tipo, m.tipo];
  const pot = m.tipo === "modulo" ? potenciaLegivel(m.potenciaW, m.tipo) : null;
  return `${n} ${n === 1 ? um : varios} ${m.fabricante.trim()} ${m.modelo.trim()}${pot ? ` ${pot.replace(" ", "")}` : ""}`;
}

/**
 * "2 inversores Growatt MIN 10000TL-X, 40 módulos fotovoltaicos Jinko Tiger
 * Neo 625W / estrutura fibrocimento" — o começo do objeto do contrato. A
 * estrutura vem do tipo de telhado (da vistoria, ver `da-vistoria.ts`); sem
 * ela, o texto termina nos módulos e quem gera o contrato completa na janela.
 */
export function textoDoKit(k: {
  inversor: ModeloDoKit | null;
  inversorQtd: number | null;
  modulo: ModeloDoKit | null;
  moduloQtd: number | null;
  estrutura?: string | null;
}): string | null {
  const partes = [parte(k.inversorQtd, k.inversor), parte(k.moduloQtd, k.modulo)].filter(Boolean);
  if (!partes.length) return null;
  const kit = partes.join(", ");
  return k.estrutura ? `${kit} / ${k.estrutura}` : kit;
}

/**
 * O texto de "Equipamentos" que o contrato sugere: o que alguém digitou no
 * projeto e, em branco, o montado do kit do catálogo e do telhado.
 */
export function sugestaoDeEquipamentos(
  p: {
    equipamentos: string | null;
    inversorModeloId: string | null;
    inversorQtd: number | null;
    moduloModeloId: string | null;
    moduloQtd: number | null;
    telhadoTipo: string | null;
  },
  catalogo: (ModeloDoKit & { id: string })[],
): string | null {
  if (p.equipamentos?.trim()) return p.equipamentos;
  return textoDoKit({
    inversor: catalogo.find((m) => m.id === p.inversorModeloId) ?? null,
    inversorQtd: p.inversorQtd,
    modulo: catalogo.find((m) => m.id === p.moduloModeloId) ?? null,
    moduloQtd: p.moduloQtd,
    estrutura: estruturaDoTelhado(p.telhadoTipo),
  });
}
