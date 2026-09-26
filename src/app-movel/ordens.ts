import { and, desc, eq, gte, notInArray, or, type SQL } from "drizzle-orm";

import type { UsuarioApp } from "@/auth/sessao-app";
import { db } from "@/db";
import { ordemServico as osTable } from "@/db/schema";

import { pode } from "./permissoes";

/**
 * As ordens de serviço como o app enxerga.
 *
 * O app guarda tudo isto no celular e trabalha a partir da cópia local — é o
 * que deixa o técnico abrir a lista num povoado sem sinal. Por isso a lista
 * vem inteira, com o checklist junto, numa chamada só: o que não veio aqui
 * não existe offline.
 *
 * Duas regras de escopo:
 *
 * - **Quem**: o técnico vê as OS em que ele é o responsável; quem tem
 *   `os.ver_todas` (adm, engenheiro) vê as da empresa.
 * - **Quando**: toda OS em aberto, mais as concluídas e canceladas dos últimos
 *   30 dias — o suficiente para o técnico conferir o que fez no mês.
 *
 * Sem teto por quantidade entre as abertas. O SeeNet já pagou por isso: com
 * teto de 10 e lista em ordem crescente, a OS nova de quem tinha 28 abertas
 * nunca aparecia.
 */

const DIA = 86_400_000;
const JANELA_FECHADAS_DIAS = 30;

/** A consulta única: lista e detalhe saem daqui, com as mesmas relações. */
function buscar(filtro: SQL | undefined) {
  return db.query.ordemServico.findMany({
    where: filtro,
    with: {
      cliente: true,
      usina: true,
      responsavel: { columns: { id: true, nome: true } },
      checklist: { orderBy: (item, { asc }) => [asc(item.ordem)] },
    },
    orderBy: desc(osTable.numero),
  });
}

type OsCompleta = Awaited<ReturnType<typeof buscar>>[number];

function escopo(usuario: UsuarioApp): SQL | undefined {
  return pode(usuario, "os.ver_todas") ? undefined : eq(osTable.responsavelId, usuario.id);
}

function janela(): SQL | undefined {
  const limite = new Date(Date.now() - JANELA_FECHADAS_DIAS * DIA);
  return or(
    notInArray(osTable.status, ["concluida", "cancelada"]),
    and(eq(osTable.status, "concluida"), gte(osTable.concluidaEm, limite)),
    and(eq(osTable.status, "cancelada"), gte(osTable.criadoEm, limite)),
  );
}

/**
 * Data e hora "de relógio de parede": 2026-09-26T09:00:00, sem fuso.
 *
 * `agendada_para` e `prazo_sla` são `timestamp without time zone` — "dia 26 às
 * 9h" em Sergipe, e não um instante. O Drizzle lê esse tipo como se fosse UTC,
 * então o ISO sem o `Z` devolve exatamente o que foi gravado. O app trata como
 * hora local, que é o que o técnico quer ver.
 */
function relogio(d: Date | null): string | null {
  return d ? d.toISOString().slice(0, 19) : null;
}

function instante(d: Date | null): string | null {
  return d ? d.toISOString() : null;
}

/**
 * Rua, número e bairro. Cidade e UF vão em campos próprios: é o app que decide
 * a ordem — na lista, a cidade vem primeiro, porque é o que o técnico lê para
 * planejar o dia; no detalhe e no mapa, vem no fim, como se escreve endereço.
 */
function endereco(c: OsCompleta["cliente"]): string | null {
  const rua = [c.logradouro, c.numero].filter(Boolean).join(", ");
  const partes = [rua, c.bairro].filter(Boolean);
  return partes.length ? partes.join(" · ") : null;
}

function numeroOuNulo(valor: string | null): number | null {
  if (valor === null) return null;
  const n = Number(valor);
  return Number.isFinite(n) ? n : null;
}

export function serializarOrdem(o: OsCompleta) {
  return {
    id: o.id,
    numero: o.numero,
    tipo: o.tipo,
    status: o.status,
    prioridade: o.prioridade,
    origem: o.origem,
    descricao: o.descricao,
    laudo: o.laudo,
    agendadaPara: relogio(o.agendadaPara),
    prazoSla: relogio(o.prazoSla),
    iniciadaEm: instante(o.iniciadaEm),
    concluidaEm: instante(o.concluidaEm),
    criadoEm: instante(o.criadoEm),
    cliente: {
      id: o.cliente.id,
      nome: o.cliente.nome,
      telefone: o.cliente.telefone?.replace(/\D/g, "") || null,
      endereco: endereco(o.cliente),
      cidade: o.cliente.cidade,
      uf: o.cliente.uf,
    },
    usina: o.usina
      ? {
          id: o.usina.id,
          nome: o.usina.nome,
          potenciaKwp: numeroOuNulo(o.usina.potenciaKwp),
          latitude: numeroOuNulo(o.usina.latitude),
          longitude: numeroOuNulo(o.usina.longitude),
        }
      : null,
    responsavel: o.responsavel ? { id: o.responsavel.id, nome: o.responsavel.nome } : null,
    checklist: o.checklist.map((i) => ({
      id: i.id,
      ordem: i.ordem,
      descricao: i.descricao,
      obrigatorio: i.obrigatorio,
      concluido: i.concluido,
      observacao: i.observacao,
    })),
  };
}

export type OrdemApp = ReturnType<typeof serializarOrdem>;

export async function ordensDoUsuario(usuario: UsuarioApp): Promise<OrdemApp[]> {
  const ordens = await buscar(
    and(eq(osTable.empresaId, usuario.empresaId), escopo(usuario), janela()),
  );
  return ordens.map(serializarOrdem);
}

/** Uma OS, só se estiver no escopo de quem pede — senão, como se não existisse. */
export async function ordemDoUsuario(
  usuario: UsuarioApp,
  id: string,
): Promise<OrdemApp | null> {
  const [ordem] = await buscar(
    and(eq(osTable.id, id), eq(osTable.empresaId, usuario.empresaId), escopo(usuario)),
  );
  return ordem ? serializarOrdem(ordem) : null;
}
