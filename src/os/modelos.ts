import { and, asc, eq } from "drizzle-orm";

import { db, schema } from "@/db";

import type { PrioridadeOs, TipoOs, TipoResposta } from "./tipos";

type TipoDocumento = (typeof schema.tipoDocumento.enumValues)[number];

/**
 * O ponto de partida de cada tipo de OS.
 *
 * Isto é só a **primeira versão**: os modelos vão para o banco na primeira vez
 * que a empresa precisa deles, e dali em diante quem manda é a tela
 * Administração → Modelos de OS. Mudar aqui não mexe em empresa que já tem
 * modelo gravado.
 *
 * Os itens saíram de três lugares: o que a NDU 013 da Energisa exige na
 * vistoria de ligação (padrão de entrada, placa de advertência, aterramento),
 * a manutenção usual de sistema fotovoltaico, e o que deu errado nas 10
 * conversas de WhatsApp analisadas — equipamento instalado diferente do
 * projeto em 3 de 6 instalações, telha quebrada e infiltração depois do
 * serviço, vistoria da Energisa reprovada por aterramento.
 *
 * Modelo gravado sem nenhum item recebe os itens daqui: foi como a vistoria
 * nasceu (vazia, esperando o roteiro), e um modelo vazio não serve para nada.
 * Modelo com qualquer item — mesmo um só — é da empresa e não é tocado.
 */

export interface ItemPadrao {
  secao?: string;
  descricao: string;
  ajuda?: string;
  tipoResposta: TipoResposta;
  opcoes?: string[];
  unidade?: string;
  obrigatorio?: boolean;
  fotosMinimas?: number;
  apenasCamera?: boolean;
  tipoDocumento?: TipoDocumento;
  chave?: string;
}

interface ModeloPadrao {
  nome: string;
  instrucoes?: string;
  prazoHoras?: number;
  exigeAssinatura?: boolean;
  etapaSlug?: string;
  itens: ItemPadrao[];
}

const MARCAS_INVERSOR = [
  "Growatt",
  "Solis",
  "Huawei",
  "FoxESS",
  "Hoymiles",
  "GoodWe",
  "NEP",
  "Outra",
];

export const MODELOS_PADRAO: Record<TipoOs, ModeloPadrao> = {
  /**
   * O roteiro da vistoria, tirado de 10 vistorias reais do WhatsApp. Nenhuma
   * tinha roteiro: localização aparecia em 9 de 9, o disjuntor legível em 6,
   * o telhado em 2, e vagas no QDG, aterramento e medidas em nenhuma.
   *
   * Cada item existe por um problema que aconteceu: o disjuntor e a bitola,
   * pela Paloma (a vistoria mostrou 40 A e cabo de 6 mm, o projeto saiu com
   * 50 A e 10 mm², uma semana de retrabalho) e pelo Allan (bipolar virou
   * "tripolar"); o aterramento, pelo Jackson (Energisa reprovou); o estado do
   * telhado, pelas telhas quebradas e pela infiltração que voltaram depois; a
   * fachada só pela câmera, porque três vistorias usaram print do Street View.
   *
   * A foto do padrão e a da conta de luz entram no dossiê da venda — a foto do
   * padrão faltando é o que trava 70 dossiês.
   */
  vistoria: {
    nome: "Vistoria técnica",
    instrucoes:
      "Todas as fotos pela câmera do app, na hora — print do Street View não vale. Se algo não " +
      "existir (sem aterramento, sem vaga no quadro), responda assim mesmo e fotografe: é isso " +
      "que o engenheiro precisa saber antes de fazer o projeto.",
    prazoHoras: 72,
    etapaSlug: "vistoria_tecnica",
    itens: [
      {
        secao: "Cliente e unidade",
        descricao: "Número da unidade consumidora (UC)",
        ajuda: "Está na conta de luz. Fotografe a conta inteira, com o nome do titular aparecendo.",
        tipoResposta: "texto",
        fotosMinimas: 1,
        obrigatorio: true,
        tipoDocumento: "uc_geradora",
        chave: "uc_numero",
      },
      {
        secao: "Cliente e unidade",
        descricao: "Nome do titular da conta de luz",
        ajuda: "Como está na conta — nem sempre é quem está atendendo, e é o nome que vai no projeto.",
        tipoResposta: "texto",
        obrigatorio: true,
        chave: "titular_nome",
      },
      {
        secao: "Cliente e unidade",
        descricao: "Fachada com o número da casa",
        tipoResposta: "foto",
        fotosMinimas: 1,
        apenasCamera: true,
        obrigatorio: true,
        chave: "fachada",
      },
      {
        secao: "Padrão de entrada",
        descricao: "Número do medidor",
        tipoResposta: "texto",
        fotosMinimas: 1,
        apenasCamera: true,
        obrigatorio: true,
        tipoDocumento: "foto_padrao",
        chave: "medidor_numero",
      },
      {
        secao: "Padrão de entrada",
        descricao: "Disjuntor do padrão — amperagem",
        ajuda: "Fotografe de perto, com o número legível.",
        tipoResposta: "numero",
        unidade: "A",
        fotosMinimas: 1,
        apenasCamera: true,
        obrigatorio: true,
        tipoDocumento: "foto_padrao",
        chave: "disjuntor_amperagem",
      },
      {
        secao: "Padrão de entrada",
        descricao: "Disjuntor do padrão — polos",
        tipoResposta: "escolha",
        opcoes: ["Monopolar", "Bipolar", "Tripolar"],
        obrigatorio: true,
        chave: "disjuntor_polos",
      },
      {
        secao: "Padrão de entrada",
        descricao: "Bitola do cabo de entrada",
        tipoResposta: "escolha",
        opcoes: ["4 mm²", "6 mm²", "10 mm²", "16 mm²", "25 mm²", "35 mm²", "Não deu para ver"],
        fotosMinimas: 1,
        apenasCamera: true,
        obrigatorio: true,
        chave: "cabo_bitola",
      },
      {
        secao: "Padrão de entrada",
        descricao: "Aterramento",
        tipoResposta: "escolha",
        opcoes: ["Existe e está bom", "Existe, mas precisa refazer", "Não existe"],
        fotosMinimas: 1,
        apenasCamera: true,
        obrigatorio: true,
        chave: "aterramento",
      },
      {
        secao: "Quadro e cabos",
        descricao: "Vagas livres no quadro de distribuição (QDG)",
        ajuda: "Para o disjuntor da usina. Fotografe o quadro aberto.",
        tipoResposta: "numero",
        unidade: "vagas",
        fotosMinimas: 1,
        apenasCamera: true,
        obrigatorio: true,
        chave: "qdg_vagas",
      },
      {
        secao: "Quadro e cabos",
        descricao: "Caminho do cabo até o quadro e distância",
        ajuda: 'Ex.: "desce pela parede lateral, uns 15 m até o QDG na cozinha".',
        tipoResposta: "texto",
        fotosMinimas: 1,
        apenasCamera: true,
        obrigatorio: true,
        chave: "cabo_caminho",
      },
      {
        secao: "Quadro e cabos",
        descricao: "Vai precisar rasgar parede?",
        tipoResposta: "sim_nao",
        obrigatorio: true,
        chave: "rasgar_parede",
      },
      {
        secao: "Telhado",
        descricao: "Tipo de telhado",
        tipoResposta: "escolha",
        opcoes: ["Cerâmica", "Colonial", "Fibrocimento", "Metálico", "Laje", "Outro"],
        fotosMinimas: 2,
        apenasCamera: true,
        obrigatorio: true,
        chave: "telhado_tipo",
      },
      {
        secao: "Telhado",
        descricao: "Estado do telhado",
        ajuda: "Telha quebrada ou infiltração que já existe precisa ficar registrada antes da instalação.",
        tipoResposta: "multipla",
        opcoes: ["Bom", "Telhas quebradas", "Madeiramento comprometido", "Sinais de infiltração"],
        obrigatorio: true,
        chave: "telhado_estado",
      },
      {
        secao: "Telhado",
        descricao: "Sombra sobre o telhado",
        tipoResposta: "escolha",
        opcoes: ["Sem sombra", "Sombra de manhã", "Sombra à tarde", "Muita sombra"],
        fotosMinimas: 1,
        apenasCamera: true,
        obrigatorio: true,
        chave: "sombra",
      },
      {
        secao: "Telhado",
        descricao: "Espaço útil para os módulos",
        tipoResposta: "numero",
        unidade: "m²",
        obrigatorio: true,
        chave: "area_util",
      },
      {
        secao: "Inversor e futuro",
        descricao: "Onde vai ficar o inversor",
        ajuda: "Lugar ventilado, longe de sol direto e com acesso para manutenção.",
        tipoResposta: "texto",
        fotosMinimas: 1,
        apenasCamera: true,
        obrigatorio: true,
        chave: "inversor_local",
      },
      {
        secao: "Inversor e futuro",
        descricao: "Aumento de consumo previsto",
        ajuda: 'Ar-condicionado, piscina, carro elétrico… Ex.: "2 ar-condicionados até o verão".',
        tipoResposta: "texto",
        chave: "ampliacao",
      },
    ],
  },

  instalacao: {
    nome: "Instalação",
    instrucoes:
      "Confira o equipamento com o projeto antes de subir no telhado. Se o que chegou " +
      "for diferente do projeto, anote no laudo — o engenheiro precisa saber.",
    exigeAssinatura: true,
    etapaSlug: "execucao",
    itens: [
      {
        secao: "Antes de começar",
        descricao: "Foto do telhado antes da instalação",
        tipoResposta: "foto",
        fotosMinimas: 1,
        apenasCamera: true,
        obrigatorio: true,
      },
      {
        secao: "Módulos",
        descricao: "Quantidade de módulos instalados",
        tipoResposta: "numero",
        unidade: "un",
        obrigatorio: true,
        chave: "modulos_quantidade",
      },
      {
        secao: "Módulos",
        descricao: "Modelo e potência dos módulos",
        ajuda: 'Como está na etiqueta. Ex.: "JA Solar 550 W".',
        tipoResposta: "texto",
        obrigatorio: true,
        chave: "modulos_modelo",
      },
      {
        secao: "Módulos",
        descricao: "Fotos dos módulos instalados",
        tipoResposta: "foto",
        fotosMinimas: 2,
        apenasCamera: true,
        obrigatorio: true,
      },
      {
        secao: "Inversor",
        descricao: "Marca do inversor instalado",
        ajuda: "A que foi instalada de fato — em 3 de 6 instalações não era a do projeto.",
        tipoResposta: "escolha",
        opcoes: MARCAS_INVERSOR,
        obrigatorio: true,
        chave: "inversor_marca",
      },
      {
        secao: "Inversor",
        descricao: "Número de série do inversor",
        ajuda:
          "Um por inversor. É por ele que o sistema reconhece a usina no portal do " +
          "fabricante e liga ao cliente sozinho. Fotografe a etiqueta.",
        tipoResposta: "serial",
        fotosMinimas: 1,
        apenasCamera: true,
        obrigatorio: true,
        chave: "serial_inversor",
      },
      {
        secao: "Inversor",
        descricao: "Foto do inversor instalado",
        tipoResposta: "foto",
        fotosMinimas: 1,
        apenasCamera: true,
        obrigatorio: true,
      },
      {
        secao: "Proteção",
        descricao: "Foto do quadro de proteção (string box / CA)",
        tipoResposta: "foto",
        fotosMinimas: 1,
        apenasCamera: true,
        obrigatorio: true,
      },
      {
        secao: "Proteção",
        descricao: "Aterramento executado",
        ajuda: "A Energisa reprova a vistoria de ligação sem ele.",
        tipoResposta: "sim_nao",
        fotosMinimas: 1,
        apenasCamera: true,
        obrigatorio: true,
        chave: "aterramento",
      },
      {
        secao: "Padrão de entrada",
        descricao: "Placa de advertência instalada no padrão",
        ajuda: '"Cuidado — risco de choque elétrico — geração própria", exigência da NDU 013.',
        tipoResposta: "sim_nao",
        obrigatorio: true,
        chave: "placa_advertencia",
      },
      {
        secao: "Padrão de entrada",
        descricao: "Foto do padrão com a tampa aberta",
        tipoResposta: "foto",
        fotosMinimas: 1,
        apenasCamera: true,
        obrigatorio: true,
        tipoDocumento: "foto_padrao",
      },
      {
        secao: "Padrão de entrada",
        descricao: "Foto do padrão com a tampa fechada, mostrando a placa",
        tipoResposta: "foto",
        fotosMinimas: 1,
        apenasCamera: true,
        obrigatorio: true,
        tipoDocumento: "foto_padrao",
      },
      {
        secao: "Entrega",
        descricao: "Usina conectada e aparecendo no portal do fabricante",
        tipoResposta: "sim_nao",
        obrigatorio: true,
        chave: "monitoramento_ok",
      },
      {
        secao: "Entrega",
        descricao: "Telhado sem telha quebrada e sem risco de infiltração",
        ajuda: "Voltaram depois de instalados: telhas quebradas e infiltração de água.",
        tipoResposta: "sim_nao",
        fotosMinimas: 1,
        apenasCamera: true,
        obrigatorio: true,
        chave: "telhado_integro",
      },
      {
        secao: "Entrega",
        descricao: "Cliente orientado sobre o uso e o app de monitoramento",
        tipoResposta: "check",
        obrigatorio: true,
      },
    ],
  },

  corretiva: {
    nome: "Manutenção corretiva",
    prazoHoras: 48,
    itens: [
      {
        secao: "Diagnóstico",
        descricao: "Código de erro ou alarme no display do inversor",
        ajuda: 'Escreva exatamente como aparece. Sem erro, escreva "nenhum".',
        tipoResposta: "texto",
        fotosMinimas: 1,
        apenasCamera: true,
        obrigatorio: true,
        chave: "codigo_erro",
      },
      {
        secao: "Diagnóstico",
        descricao: "Fotos do inversor e do quadro antes de mexer",
        tipoResposta: "foto",
        fotosMinimas: 2,
        apenasCamera: true,
        obrigatorio: true,
      },
      {
        secao: "Depois do serviço",
        descricao: "Foto depois da intervenção",
        tipoResposta: "foto",
        fotosMinimas: 1,
        apenasCamera: true,
        obrigatorio: true,
      },
      {
        secao: "Depois do serviço",
        descricao: "O inversor voltou a gerar?",
        tipoResposta: "sim_nao",
        obrigatorio: true,
        chave: "geracao_ok",
      },
      {
        secao: "Depois do serviço",
        descricao: "Comunicação com o portal funcionando?",
        ajuda: "Datalogger ou Wi-Fi mandando dado — usina que não comunica vira alerta de novo.",
        tipoResposta: "sim_nao",
        obrigatorio: true,
        chave: "comunicacao_ok",
      },
      {
        secao: "Depois do serviço",
        descricao: "Potência no display depois da visita",
        tipoResposta: "numero",
        unidade: "kW",
        chave: "potencia_depois",
      },
    ],
  },

  preventiva: {
    nome: "Manutenção preventiva",
    itens: [
      {
        secao: "Elétrica",
        descricao: "Conexões CC e CA inspecionadas e reapertadas",
        tipoResposta: "check",
        fotosMinimas: 1,
        obrigatorio: true,
      },
      {
        secao: "Elétrica",
        descricao: "DPS íntegros (CC e CA)",
        tipoResposta: "sim_nao",
        obrigatorio: true,
        chave: "dps_ok",
      },
      {
        secao: "Elétrica",
        descricao: "Aterramento com continuidade e conexões firmes",
        tipoResposta: "sim_nao",
        fotosMinimas: 1,
        obrigatorio: true,
        chave: "aterramento",
      },
      {
        secao: "Inversor",
        descricao: "Inversor sem alarme e com ventilação livre",
        tipoResposta: "sim_nao",
        fotosMinimas: 1,
        obrigatorio: true,
      },
      {
        secao: "Inversor",
        descricao: "Geração total no display",
        tipoResposta: "numero",
        unidade: "kWh",
        chave: "geracao_total",
      },
      {
        secao: "Módulos e estrutura",
        descricao: "Módulos sem trinca, sombra nova ou sujeira excessiva",
        tipoResposta: "sim_nao",
        fotosMinimas: 2,
        apenasCamera: true,
        obrigatorio: true,
      },
      {
        secao: "Módulos e estrutura",
        descricao: "Estrutura e fixações sem corrosão ou folga",
        tipoResposta: "sim_nao",
        obrigatorio: true,
      },
    ],
  },

  limpeza: {
    nome: "Limpeza de módulos",
    itens: [
      {
        descricao: "Fotos dos módulos antes da limpeza",
        tipoResposta: "foto",
        fotosMinimas: 2,
        apenasCamera: true,
        obrigatorio: true,
      },
      {
        descricao: "Limpeza feita",
        ajuda: "Água e escova macia. Sem produto abrasivo e sem lavadora de alta pressão.",
        tipoResposta: "check",
        obrigatorio: true,
      },
      {
        descricao: "Fotos dos módulos depois da limpeza",
        tipoResposta: "foto",
        fotosMinimas: 2,
        apenasCamera: true,
        obrigatorio: true,
      },
      {
        descricao: "Algum módulo com dano?",
        ajuda: "Se sim, fotografe e descreva na observação.",
        tipoResposta: "sim_nao",
        obrigatorio: true,
        chave: "modulo_danificado",
      },
    ],
  },

  garantia: {
    nome: "Garantia",
    prazoHoras: 72,
    itens: [
      {
        descricao: "Equipamento com defeito",
        tipoResposta: "escolha",
        opcoes: ["Inversor", "Microinversor", "Módulo", "Otimizador", "Datalogger", "Outro"],
        obrigatorio: true,
        chave: "equipamento_defeito",
      },
      {
        descricao: "Número de série do equipamento com defeito",
        tipoResposta: "texto",
        fotosMinimas: 1,
        apenasCamera: true,
        obrigatorio: true,
        chave: "serial_defeito",
      },
      {
        descricao: "Código de erro",
        tipoResposta: "texto",
        chave: "codigo_erro",
      },
      {
        descricao: "Fotos do defeito",
        tipoResposta: "foto",
        fotosMinimas: 2,
        apenasCamera: true,
        obrigatorio: true,
      },
      {
        descricao: "Equipamento trocado nesta visita?",
        tipoResposta: "sim_nao",
        obrigatorio: true,
        chave: "equipamento_trocado",
      },
      {
        descricao: "Número de série do equipamento novo",
        ajuda: "Só se houve troca.",
        tipoResposta: "serial",
        chave: "serial_inversor",
      },
    ],
  },
};

const TIPOS = Object.keys(MODELOS_PADRAO) as TipoOs[];

/**
 * Grava os modelos que a empresa ainda não tem.
 *
 * Preguiçoso de propósito: roda quando alguém precisa de um modelo — ao abrir
 * uma OS ou a tela de modelos —, e assim a VM não precisa de um passo a mais
 * na instalação. Duas chamadas ao mesmo tempo não duplicam: o índice único
 * por (empresa, tipo) barra a segunda.
 */
export async function garantirModelos(empresaId: string): Promise<void> {
  const existentes = await db.query.modeloOs.findMany({
    where: eq(schema.modeloOs.empresaId, empresaId),
    columns: { id: true, tipo: true, instrucoes: true },
    with: { itens: { columns: { id: true }, limit: 1 } },
  });
  const porTipo = new Map(existentes.map((m) => [m.tipo, m]));

  for (const tipo of TIPOS) {
    const padrao = MODELOS_PADRAO[tipo];
    const atual = porTipo.get(tipo);
    if (atual && atual.itens.length > 0) continue;
    if (atual && padrao.itens.length === 0) continue;

    await db.transaction(async (tx) => {
      let modeloId = atual?.id;
      if (!modeloId) {
        const [criado] = await tx
          .insert(schema.modeloOs)
          .values({
            empresaId,
            tipo,
            nome: padrao.nome,
            instrucoes: padrao.instrucoes ?? null,
            prazoHoras: padrao.prazoHoras ?? null,
            exigeAssinatura: padrao.exigeAssinatura ?? false,
            etapaSlug: padrao.etapaSlug ?? null,
          })
          .onConflictDoNothing()
          .returning({ id: schema.modeloOs.id });
        if (!criado) return; // outra chamada criou ao mesmo tempo
        modeloId = criado.id;
      } else {
        // Modelo vazio: ganha os itens e, se não tinha, as instruções.
        const vazio = await tx.query.modeloOsItem.findFirst({
          where: eq(schema.modeloOsItem.modeloId, modeloId),
          columns: { id: true },
        });
        if (vazio) return;
        if (!atual?.instrucoes && padrao.instrucoes) {
          await tx
            .update(schema.modeloOs)
            .set({ instrucoes: padrao.instrucoes, atualizadoEm: new Date() })
            .where(eq(schema.modeloOs.id, modeloId));
        }
      }
      if (padrao.itens.length === 0) return;

      await tx.insert(schema.modeloOsItem).values(
        padrao.itens.map((item, i) => ({
          empresaId,
          modeloId: modeloId!,
          ordem: (i + 1) * 10,
          secao: item.secao ?? null,
          descricao: item.descricao,
          ajuda: item.ajuda ?? null,
          tipoResposta: item.tipoResposta,
          opcoes: item.opcoes ?? null,
          unidade: item.unidade ?? null,
          obrigatorio: item.obrigatorio ?? false,
          fotosMinimas: item.fotosMinimas ?? 0,
          apenasCamera: item.apenasCamera ?? false,
          tipoDocumento: item.tipoDocumento ?? null,
          chave: item.chave ?? null,
        })),
      );
    });
  }
}

export async function modeloDoTipo(empresaId: string, tipo: TipoOs) {
  await garantirModelos(empresaId);
  const modelo = await db.query.modeloOs.findFirst({
    where: and(eq(schema.modeloOs.empresaId, empresaId), eq(schema.modeloOs.tipo, tipo)),
    with: { itens: { orderBy: asc(schema.modeloOsItem.ordem) } },
  });
  if (!modelo) throw new Error(`Modelo de OS "${tipo}" não encontrado para a empresa.`);
  return modelo;
}

export type ModeloComItens = Awaited<ReturnType<typeof modeloDoTipo>>;

/**
 * O prazo da OS, contado da abertura.
 *
 * Urgente nunca passa de 24 horas, qualquer que seja o prazo do modelo: é o
 * alerta crítico de usina parada, e cada dia parada é geração que o cliente
 * não recupera.
 */
export function prazoDaOs(
  modelo: { prazoHoras: number | null },
  prioridade: PrioridadeOs,
  aberturaRelogio: Date,
): Date | null {
  let horas = modelo.prazoHoras;
  if (prioridade === "urgente") horas = horas === null ? 24 : Math.min(horas, 24);
  if (horas === null) return null;
  return new Date(aberturaRelogio.getTime() + horas * 3_600_000);
}
