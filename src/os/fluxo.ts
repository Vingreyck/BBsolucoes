import { randomBytes } from "node:crypto";

import { and, eq, sql } from "drizzle-orm";

import { db, schema } from "@/db";
import { moverNaEsteira } from "@/projeto/esteira";
import { publicar } from "@/rastreamento/hub";

import { ErroOs, podeExecutar, type Ator } from "./acesso";
import { modeloDoTipo, prazoDaOs } from "./modelos";
import { relogioAgora, relogioDe } from "./relogio";
import {
  numeroOs,
  STATUS_ROTULO,
  type PrioridadeOs,
  type StatusOs,
  type TipoOs,
} from "./tipos";

/**
 * O ciclo de vida da ordem de serviço.
 *
 * Toda mudança passa por `executarAcao`, venha do site ou do app: a mesma
 * regra, a mesma trava, o mesmo histórico. É o que impede o app de concluir
 * uma OS com foto obrigatória faltando só porque o botão do site não deixaria.
 *
 *   aberta ──agendar──▶ agendada ──deslocamento──▶ em_deslocamento
 *     │                    │                             │
 *     └──────iniciar───────┴───────────iniciar───────────┘
 *                          ▼
 *                    em_andamento ◀──retomar── aguardando_peca
 *                     │    │   └──pausar──────────▲
 *              concluir  nao_atendida (volta para "a agendar")
 *                     ▼
 *                 concluida ──reabrir──▶ aberta
 *
 * Cancelar vale de qualquer situação em aberto.
 *
 * O app trabalha sem sinal: cada ação dele traz um `idCliente` gerado no
 * celular. A mesma ação reenviada depois de uma queda de conexão encontra o
 * evento já gravado e não faz nada — nem duplica, nem dá erro.
 */

type Transacao = Parameters<Parameters<typeof db.transaction>[0]>[0];

export interface Local {
  latitude?: number | null;
  longitude?: number | null;
  precisao?: number | null;
}

export interface OpcoesAcao extends Local {
  idCliente?: string | null;
  /** A hora do celular. Sem sinal, a ação só chega ao servidor horas depois. */
  ocorridoEm?: Date | null;
}

export type Acao =
  | { tipo: "atribuir"; responsavelId: string | null }
  | { tipo: "agendar"; agendadaPara: Date; motivo?: string | null }
  | { tipo: "deslocamento" }
  | { tipo: "iniciar" }
  | { tipo: "pausar"; motivo: string }
  | { tipo: "retomar" }
  | {
      tipo: "concluir";
      resultado: "resolvido" | "nao_resolvido";
      laudo?: string | null;
      assinaturaNome?: string | null;
    }
  | { tipo: "nao_atendida"; motivo: string }
  | { tipo: "cancelar"; motivo: string }
  | { tipo: "reabrir"; motivo: string }
  | {
      tipo: "editar";
      descricao?: string;
      prioridade?: PrioridadeOs;
      usinaId?: string | null;
      projetoId?: string | null;
      prazoSla?: Date | null;
    };

export type TipoAcao = Acao["tipo"];

const ABERTAS: readonly StatusOs[] = [
  "aberta",
  "agendada",
  "em_deslocamento",
  "em_andamento",
  "aguardando_peca",
];

/** De quais situações cada ação pode partir. */
const PERMITIDO: Record<TipoAcao, readonly StatusOs[]> = {
  atribuir: ABERTAS,
  agendar: ["aberta", "agendada", "aguardando_peca"],
  deslocamento: ["aberta", "agendada"],
  iniciar: ["aberta", "agendada", "em_deslocamento"],
  pausar: ["em_andamento"],
  retomar: ["aguardando_peca"],
  concluir: ABERTAS,
  nao_atendida: ["agendada", "em_deslocamento", "em_andamento"],
  cancelar: ABERTAS,
  reabrir: ["concluida", "cancelada"],
  editar: ABERTAS,
};

/** Decidir quem atende, quando, e se a OS existe — é da gestão. */
const SO_GESTAO = new Set<TipoAcao>(["atribuir", "agendar", "cancelar", "reabrir", "editar"]);

/** Usados na recusa: "Não dá para iniciar uma OS concluída." */
const VERBO: Record<TipoAcao, string> = {
  atribuir: "trocar o responsável de",
  agendar: "agendar",
  deslocamento: "sair para atender",
  iniciar: "iniciar",
  pausar: "pausar",
  retomar: "retomar",
  concluir: "concluir",
  nao_atendida: "marcar como não atendida",
  cancelar: "cancelar",
  reabrir: "reabrir",
  editar: "editar",
};

// ---------------------------------------------------------------------------

/** O banco recusou por índice único? (o Drizzle às vezes embrulha o erro) */
export function violouUnico(erro: unknown, indice?: string): boolean {
  let atual: unknown = erro;
  for (let i = 0; i < 4 && atual; i++) {
    const e = atual as { code?: string; constraint_name?: string; message?: string; cause?: unknown };
    if (e.code === "23505" && (!indice || e.constraint_name === indice || e.message?.includes(indice))) {
      return true;
    }
    if (indice && typeof e.message === "string" && e.message.includes(indice)) return true;
    atual = e.cause;
  }
  return false;
}

/** 32 caracteres aleatórios, seguros para URL — a chave do link do relatório. */
export function novoTokenRelatorio(): string {
  return randomBytes(24).toString("base64url");
}

/** A hora do celular, se fizer sentido; nunca no futuro. */
function momento(d?: Date | null): Date {
  const agora = new Date();
  if (!d || Number.isNaN(d.getTime())) return agora;
  // Relógio de celular adiantado não pode gravar uma chegada que ainda não houve.
  return d.getTime() > agora.getTime() + 5 * 60_000 ? agora : d;
}

function coordenada(valor: number | null | undefined, limite: number): string | null {
  if (valor === null || valor === undefined || !Number.isFinite(valor)) return null;
  return Math.abs(valor) <= limite ? valor.toFixed(7) : null;
}

function campoRelogio(d: Date | null): string | null {
  return d ? d.toISOString().slice(0, 16) : null;
}

interface Contexto {
  tx: Transacao;
  ator: Ator;
  os: typeof schema.ordemServico.$inferSelect;
  quando: Date;
  opcoes: OpcoesAcao;
  avisos: string[];
}

/**
 * Grava uma linha do histórico. Só o evento principal da ação leva o
 * `idCliente` — o índice único por ele é o que torna a ação idempotente.
 */
async function evento(
  c: Contexto,
  tipo: string,
  dados?: Record<string, unknown> | null,
  secundario = false,
): Promise<void> {
  await c.tx.insert(schema.osEvento).values({
    empresaId: c.os.empresaId,
    ordemServicoId: c.os.id,
    tipo,
    usuarioId: secundario ? null : c.ator.id,
    origem: secundario ? "sistema" : c.ator.origem,
    ocorridoEm: c.quando,
    latitude: secundario ? null : coordenada(c.opcoes.latitude, 90),
    longitude: secundario ? null : coordenada(c.opcoes.longitude, 180),
    precisaoM:
      secundario || c.opcoes.precisao == null || !Number.isFinite(c.opcoes.precisao)
        ? null
        : Math.round(c.opcoes.precisao),
    dados: dados ?? null,
    idCliente: secundario ? null : (c.opcoes.idCliente ?? null),
  });
}

async function atualizar(
  c: Contexto,
  campos: Partial<typeof schema.ordemServico.$inferInsert>,
): Promise<void> {
  await c.tx
    .update(schema.ordemServico)
    .set({ ...campos, atualizadoEm: new Date() })
    .where(eq(schema.ordemServico.id, c.os.id));
}

function exigirMotivo(motivo: string | null | undefined, frase: string): string {
  const m = motivo?.trim();
  if (!m) throw new ErroOs("validacao", frase);
  return m.slice(0, 500);
}

async function usuarioDaEmpresa(tx: Transacao, empresaId: string, id: string) {
  const u = await tx.query.usuario.findFirst({
    where: and(
      eq(schema.usuario.id, id),
      eq(schema.usuario.empresaId, empresaId),
      eq(schema.usuario.ativo, true),
    ),
    columns: { id: true, nome: true },
  });
  if (!u) throw new ErroOs("validacao", "Responsável não encontrado ou desativado.");
  return u;
}

// ---------------------------------------------------------------------------
// Abrir

export interface NovaOs {
  clienteId: string;
  usinaId?: string | null;
  projetoId?: string | null;
  tipo: TipoOs;
  prioridade: PrioridadeOs;
  descricao: string;
  responsavelId?: string | null;
  /** Relógio de Sergipe (ver `relogio.ts`). */
  agendadaPara?: Date | null;
  origem?: "manual" | "alerta" | "cliente";
  osOrigemId?: string | null;
}

/**
 * Abre uma OS, já com o checklist do modelo do tipo dela.
 *
 * O número é o maior da empresa mais um, calculado dentro da transação; duas
 * aberturas no mesmo instante leem o mesmo máximo, e o índice único barra a
 * segunda — que tenta de novo com o número seguinte.
 */
export async function criarOs(ator: Ator, dados: NovaOs): Promise<{ id: string; numero: number }> {
  if (!ator.gestao && ator.origem !== "sistema") {
    throw new ErroOs("sem_permissao", "Só a gestão abre ordem de serviço.", 403);
  }
  const descricao = dados.descricao.trim();
  if (!descricao) throw new ErroOs("validacao", "Descreva o que precisa ser feito.");
  if (descricao.length > 4000) throw new ErroOs("validacao", "A descrição passou de 4.000 caracteres.");

  const empresaId = ator.empresaId;
  const cliente = await db.query.cliente.findFirst({
    where: and(eq(schema.cliente.id, dados.clienteId), eq(schema.cliente.empresaId, empresaId)),
    columns: { id: true },
  });
  if (!cliente) throw new ErroOs("validacao", "Cliente não encontrado.");

  if (dados.usinaId) {
    const usina = await db.query.usina.findFirst({
      where: and(eq(schema.usina.id, dados.usinaId), eq(schema.usina.empresaId, empresaId)),
      columns: { clienteId: true },
    });
    if (!usina) throw new ErroOs("validacao", "Usina não encontrada.");
    if (usina.clienteId && usina.clienteId !== dados.clienteId) {
      throw new ErroOs("validacao", "Essa usina é de outro cliente.");
    }
  }
  if (dados.projetoId) {
    const projeto = await db.query.projeto.findFirst({
      where: and(eq(schema.projeto.id, dados.projetoId), eq(schema.projeto.empresaId, empresaId)),
      columns: { clienteId: true },
    });
    if (!projeto) throw new ErroOs("validacao", "Projeto não encontrado.");
    if (projeto.clienteId !== dados.clienteId) {
      throw new ErroOs("validacao", "Esse projeto é de outro cliente.");
    }
  }

  const modelo = await modeloDoTipo(empresaId, dados.tipo);
  const prazo = prazoDaOs(modelo, dados.prioridade, relogioAgora());

  for (let tentativa = 0; ; tentativa++) {
    try {
      return await db.transaction(async (tx) => {
        let responsavelNome: string | null = null;
        if (dados.responsavelId) {
          responsavelNome = (await usuarioDaEmpresa(tx, empresaId, dados.responsavelId)).nome;
        }

        const [{ proximo }] = await tx
          .select({ proximo: sql<number>`coalesce(max(${schema.ordemServico.numero}), 0) + 1` })
          .from(schema.ordemServico)
          .where(eq(schema.ordemServico.empresaId, empresaId));

        const [os] = await tx
          .insert(schema.ordemServico)
          .values({
            empresaId,
            numero: Number(proximo),
            clienteId: dados.clienteId,
            usinaId: dados.usinaId ?? null,
            projetoId: dados.projetoId ?? null,
            tipo: dados.tipo,
            status: dados.agendadaPara ? "agendada" : "aberta",
            prioridade: dados.prioridade,
            origem: dados.origem ?? "manual",
            descricao,
            responsavelId: dados.responsavelId ?? null,
            abertaPorId: ator.origem === "sistema" ? null : ator.id,
            agendadaPara: dados.agendadaPara ?? null,
            prazoSla: prazo,
            osOrigemId: dados.osOrigemId ?? null,
          })
          .returning();

        if (modelo.itens.length) {
          await tx.insert(schema.osChecklistItem).values(
            modelo.itens.map((item) => ({
              empresaId,
              ordemServicoId: os.id,
              ordem: item.ordem,
              descricao: item.descricao,
              obrigatorio: item.obrigatorio,
              secao: item.secao,
              ajuda: item.ajuda,
              tipoResposta: item.tipoResposta,
              opcoes: item.opcoes,
              unidade: item.unidade,
              fotosMinimas: item.fotosMinimas,
              apenasCamera: item.apenasCamera,
              tipoDocumento: item.tipoDocumento,
              chave: item.chave,
            })),
          );
        }

        const c: Contexto = { tx, ator, os, quando: new Date(), opcoes: {}, avisos: [] };
        await evento(c, "criada", {
          tipo: dados.tipo,
          prioridade: dados.prioridade,
          origem: dados.origem ?? "manual",
          ...(dados.osOrigemId ? { osOrigemId: dados.osOrigemId } : {}),
        });
        if (responsavelNome) await evento(c, "atribuida", { de: null, para: responsavelNome });
        if (dados.agendadaPara) {
          await evento(c, "agendada", { de: null, para: campoRelogio(dados.agendadaPara) });
        }
        return { id: os.id, numero: os.numero };
      });
    } catch (e) {
      if (tentativa < 3 && violouUnico(e, "os_numero_uq")) continue;
      throw e;
    }
  }
}

/**
 * Abre o retorno de um atendimento não resolvido: mesma casa, mesmo tipo,
 * ligado à OS de origem — o histórico mostra as duas visitas como uma história.
 */
export async function abrirRetorno(ator: Ator, osId: string): Promise<{ id: string; numero: number }> {
  const origem = await db.query.ordemServico.findFirst({
    where: and(eq(schema.ordemServico.id, osId), eq(schema.ordemServico.empresaId, ator.empresaId)),
  });
  if (!origem) throw new ErroOs("nao_encontrada", "Ordem de serviço não encontrada.", 404);

  const nova = await criarOs(ator, {
    clienteId: origem.clienteId,
    usinaId: origem.usinaId,
    projetoId: origem.projetoId,
    tipo: origem.tipo,
    prioridade: origem.prioridade === "urgente" ? "urgente" : "alta",
    descricao:
      `Retorno da ${numeroOs(origem.numero)}.` + (origem.laudo ? `\n\nO que ficou pendente: ${origem.laudo}` : ""),
    responsavelId: origem.responsavelId,
    origem: origem.origem,
    osOrigemId: origem.id,
  });

  await db.insert(schema.osEvento).values({
    empresaId: origem.empresaId,
    ordemServicoId: origem.id,
    tipo: "retorno",
    usuarioId: ator.id,
    origem: ator.origem,
    dados: { osId: nova.id, numero: nova.numero },
  });
  return nova;
}

/** Troca a chave do link do relatório — o link antigo para de abrir. */
export async function renovarLinkRelatorio(ator: Ator, osId: string): Promise<string> {
  if (!ator.gestao) throw new ErroOs("sem_permissao", "Só a gestão troca o link do relatório.", 403);
  const token = novoTokenRelatorio();
  const [os] = await db
    .update(schema.ordemServico)
    .set({ relatorioToken: token, atualizadoEm: new Date() })
    .where(and(eq(schema.ordemServico.id, osId), eq(schema.ordemServico.empresaId, ator.empresaId)))
    .returning({ id: schema.ordemServico.id, empresaId: schema.ordemServico.empresaId });
  if (!os) throw new ErroOs("nao_encontrada", "Ordem de serviço não encontrada.", 404);
  await db.insert(schema.osEvento).values({
    empresaId: os.empresaId,
    ordemServicoId: os.id,
    tipo: "relatorio",
    usuarioId: ator.id,
    origem: ator.origem,
  });
  return token;
}

// ---------------------------------------------------------------------------
// Mudar

export interface ResultadoAcao {
  /** A mesma ação já tinha chegado — reenvio do app depois de cair o sinal. */
  repetida: boolean;
  /** Coisas que deram certo e valem ser ditas: "o projeto avançou para…". */
  avisos: string[];
}

export async function executarAcao(
  ator: Ator,
  osId: string,
  acao: Acao,
  opcoes: OpcoesAcao = {},
): Promise<ResultadoAcao> {
  if (opcoes.idCliente) {
    const ja = await db.query.osEvento.findFirst({
      where: and(
        eq(schema.osEvento.empresaId, ator.empresaId),
        eq(schema.osEvento.idCliente, opcoes.idCliente),
      ),
      columns: { id: true },
    });
    if (ja) return { repetida: true, avisos: [] };
  }

  try {
    const resultado = await db.transaction(async (tx) => {
      // FOR UPDATE: duas ações na mesma OS ao mesmo tempo esperam uma pela
      // outra, em vez de as duas lerem "em andamento" e as duas concluírem.
      const [os] = await tx
        .select()
        .from(schema.ordemServico)
        .where(and(eq(schema.ordemServico.id, osId), eq(schema.ordemServico.empresaId, ator.empresaId)))
        .for("update");
      if (!os) throw new ErroOs("nao_encontrada", "Ordem de serviço não encontrada.", 404);

      const autorizado = SO_GESTAO.has(acao.tipo) ? ator.gestao : podeExecutar(ator, os);
      if (!autorizado) {
        throw new ErroOs("sem_permissao", "Você não pode fazer isso nesta ordem de serviço.", 403);
      }
      if (!PERMITIDO[acao.tipo].includes(os.status)) {
        throw new ErroOs(
          "transicao_invalida",
          `Não dá para ${VERBO[acao.tipo]} uma OS que está "${STATUS_ROTULO[os.status] ?? os.status}".`,
          409,
        );
      }

      const c: Contexto = { tx, ator, os, quando: momento(opcoes.ocorridoEm), opcoes, avisos: [] };
      await APLICAR[acao.tipo](c, acao as never);
      return { repetida: false, avisos: c.avisos };
    });
    // Quem está com o mapa do campo aberto recarrega a lista: o técnico chegou,
    // concluiu, saiu de campo.
    publicar(ator.empresaId, { tipo: "os", ordemId: osId });
    return resultado;
  } catch (e) {
    if (opcoes.idCliente && violouUnico(e, "os_evento_id_cliente_uq")) {
      return { repetida: true, avisos: [] };
    }
    throw e;
  }
}

type Aplicador<T extends TipoAcao> = (c: Contexto, acao: Extract<Acao, { tipo: T }>) => Promise<void>;

const APLICAR: { [T in TipoAcao]: Aplicador<T> } = {
  async atribuir(c, acao) {
    if (acao.responsavelId === c.os.responsavelId) return;
    const novo = acao.responsavelId
      ? await usuarioDaEmpresa(c.tx, c.os.empresaId, acao.responsavelId)
      : null;
    const anterior = c.os.responsavelId
      ? await c.tx.query.usuario.findFirst({
          where: eq(schema.usuario.id, c.os.responsavelId),
          columns: { nome: true },
        })
      : null;
    await atualizar(c, { responsavelId: novo?.id ?? null });
    await evento(c, "atribuida", { de: anterior?.nome ?? null, para: novo?.nome ?? null });
  },

  async agendar(c, acao) {
    const para = acao.agendadaPara;
    const tinha = c.os.agendadaPara;
    if (tinha && tinha.getTime() === para.getTime() && c.os.status === "agendada") return;
    const reagendando = Boolean(tinha);
    const motivo = reagendando
      ? exigirMotivo(acao.motivo, "Diga o motivo do reagendamento.")
      : acao.motivo?.trim() || null;
    await atualizar(c, { agendadaPara: para, status: "agendada" });
    await evento(c, reagendando ? "reagendada" : "agendada", {
      de: campoRelogio(tinha),
      para: campoRelogio(para),
      ...(motivo ? { motivo } : {}),
    });
  },

  async deslocamento(c) {
    await atualizar(c, {
      status: "em_deslocamento",
      responsavelId: c.os.responsavelId ?? c.ator.id,
    });
    await evento(c, "deslocamento");
  },

  async iniciar(c) {
    await atualizar(c, {
      status: "em_andamento",
      iniciadaEm: c.os.iniciadaEm ?? c.quando,
      responsavelId: c.os.responsavelId ?? c.ator.id,
    });
    await evento(c, "iniciada");
  },

  async pausar(c, acao) {
    const motivo = exigirMotivo(acao.motivo, "Diga por que o atendimento parou.");
    await atualizar(c, { status: "aguardando_peca" });
    await evento(c, "pausada", { motivo });
  },

  async retomar(c) {
    await atualizar(c, { status: "em_andamento" });
    await evento(c, "retomada");
  },

  async concluir(c, acao) {
    const itens = await c.tx.query.osChecklistItem.findMany({
      where: eq(schema.osChecklistItem.ordemServicoId, c.os.id),
      columns: { descricao: true, obrigatorio: true, concluido: true },
    });
    const pendentes = itens.filter((i) => i.obrigatorio && !i.concluido);
    if (pendentes.length) {
      const nomes = pendentes.slice(0, 3).map((i) => i.descricao).join("; ");
      throw new ErroOs(
        "checklist_incompleto",
        `${pendentes.length === 1 ? "Falta 1 item obrigatório" : `Faltam ${pendentes.length} itens obrigatórios`}: ${nomes}${pendentes.length > 3 ? "…" : "."}`,
        409,
      );
    }

    const laudo = acao.laudo?.trim().slice(0, 8000) || null;
    if (acao.resultado === "nao_resolvido" && !laudo) {
      throw new ErroOs("validacao", "Explique no laudo o que ficou pendente.");
    }

    const modelo = await c.tx.query.modeloOs.findFirst({
      where: and(eq(schema.modeloOs.empresaId, c.os.empresaId), eq(schema.modeloOs.tipo, c.os.tipo)),
    });
    if (modelo?.exigeAssinatura && acao.resultado === "resolvido") {
      const assinatura = await c.tx.query.osAnexo.findFirst({
        where: and(
          eq(schema.osAnexo.ordemServicoId, c.os.id),
          eq(schema.osAnexo.categoria, "assinatura"),
        ),
        columns: { id: true },
      });
      if (!assinatura) throw new ErroOs("falta_assinatura", "Falta a assinatura do cliente.", 409);
    }

    await atualizar(c, {
      status: "concluida",
      concluidaEm: c.quando,
      resultado: acao.resultado,
      laudo: laudo ?? c.os.laudo,
      assinaturaNome: acao.assinaturaNome?.trim().slice(0, 200) || c.os.assinaturaNome,
      relatorioToken: c.os.relatorioToken ?? novoTokenRelatorio(),
    });
    await evento(c, "concluida", { resultado: acao.resultado });

    if (acao.resultado !== "resolvido") return;

    // O alerta que originou a OS está resolvido junto.
    await c.tx
      .update(schema.alerta)
      .set({ status: "resolvido", resolvidoEm: new Date() })
      .where(eq(schema.alerta.ordemServicoId, c.os.id));

    if (!c.os.projetoId) return;

    if (c.os.tipo === "vistoria") {
      await c.tx
        .update(schema.projeto)
        .set({
          vistoriaEm: relogioDe(c.quando),
          vistoriaPorId: c.os.responsavelId ?? c.ator.id,
          vistoriaObservacoes: sql`coalesce(${schema.projeto.vistoriaObservacoes}, ${laudo})`,
          atualizadoEm: new Date(),
        })
        .where(eq(schema.projeto.id, c.os.projetoId));
    }

    // A esteira anda sozinha — mas só se o projeto está parado na etapa que
    // esta OS cumpre. Projeto que já passou dela, ou ainda nem chegou, fica.
    if (modelo?.etapaSlug) {
      const projeto = await c.tx.query.projeto.findFirst({
        where: eq(schema.projeto.id, c.os.projetoId),
        with: { etapa: { columns: { slug: true } } },
      });
      if (projeto?.etapa.slug === modelo.etapaSlug) {
        const nova = await moverNaEsteira({
          empresaId: c.os.empresaId,
          projetoId: projeto.id,
          direcao: "avancar",
          usuarioId: c.ator.id,
          observacao: `Automático: ${numeroOs(c.os.numero)} concluída.`,
          tx: c.tx,
        });
        if (nova) {
          await evento(c, "esteira", { etapa: nova.nome, projetoId: projeto.id }, true);
          c.avisos.push(`O projeto avançou para "${nova.nome}".`);
        }
      }
    }
  },

  async nao_atendida(c, acao) {
    const motivo = exigirMotivo(acao.motivo, "Diga por que não foi possível atender.");
    await atualizar(c, { status: "aberta", agendadaPara: null });
    await evento(c, "nao_atendida", { motivo, agendadaPara: campoRelogio(c.os.agendadaPara) });
  },

  async cancelar(c, acao) {
    const motivo = exigirMotivo(acao.motivo, "Diga o motivo do cancelamento.");
    await atualizar(c, { status: "cancelada", canceladaEm: new Date() });
    await evento(c, "cancelada", { motivo });
    // O alerta volta a ficar em aberto, para alguém abrir outra OS se precisar.
    await c.tx
      .update(schema.alerta)
      .set({ ordemServicoId: null, status: "aberto" })
      .where(
        and(eq(schema.alerta.ordemServicoId, c.os.id), eq(schema.alerta.status, "reconhecido")),
      );
  },

  async reabrir(c, acao) {
    const motivo = exigirMotivo(acao.motivo, "Diga por que a OS está sendo reaberta.");
    await atualizar(c, {
      status: "aberta",
      concluidaEm: null,
      canceladaEm: null,
      resultado: null,
    });
    await evento(c, "reaberta", { motivo, estava: c.os.status });
  },

  async editar(c, acao) {
    const campos: Partial<typeof schema.ordemServico.$inferInsert> = {};
    const mudou: string[] = [];

    if (acao.descricao !== undefined) {
      const d = acao.descricao.trim();
      if (!d) throw new ErroOs("validacao", "A descrição não pode ficar vazia.");
      if (d !== c.os.descricao) {
        campos.descricao = d.slice(0, 4000);
        mudou.push("descrição");
      }
    }
    if (acao.prioridade && acao.prioridade !== c.os.prioridade) {
      campos.prioridade = acao.prioridade;
      mudou.push("prioridade");
    }
    if (acao.usinaId !== undefined && acao.usinaId !== c.os.usinaId) {
      if (acao.usinaId) {
        const usina = await c.tx.query.usina.findFirst({
          where: and(eq(schema.usina.id, acao.usinaId), eq(schema.usina.empresaId, c.os.empresaId)),
          columns: { clienteId: true },
        });
        if (!usina || (usina.clienteId && usina.clienteId !== c.os.clienteId)) {
          throw new ErroOs("validacao", "Essa usina não é deste cliente.");
        }
      }
      campos.usinaId = acao.usinaId;
      mudou.push("usina");
    }
    if (acao.projetoId !== undefined && acao.projetoId !== c.os.projetoId) {
      if (acao.projetoId) {
        const projeto = await c.tx.query.projeto.findFirst({
          where: and(eq(schema.projeto.id, acao.projetoId), eq(schema.projeto.empresaId, c.os.empresaId)),
          columns: { clienteId: true },
        });
        if (!projeto || projeto.clienteId !== c.os.clienteId) {
          throw new ErroOs("validacao", "Esse projeto não é deste cliente.");
        }
      }
      campos.projetoId = acao.projetoId;
      mudou.push("projeto");
    }
    if (acao.prazoSla !== undefined && acao.prazoSla?.getTime() !== c.os.prazoSla?.getTime()) {
      campos.prazoSla = acao.prazoSla;
      mudou.push("prazo");
    }

    if (!mudou.length) return;
    await atualizar(c, campos);
    await evento(c, "editada", { campos: mudou });
  },
};
