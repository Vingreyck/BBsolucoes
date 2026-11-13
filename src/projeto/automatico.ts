import { and, eq, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";

import { db, schema } from "@/db";
import { faltaNoDossie, tiposEntregues } from "@/documentos/cobranca";

import { moverNaEsteira } from "./esteira";

/**
 * A esteira que anda sozinha pelos documentos.
 *
 * - **Documentação do cliente**: anda quando todo documento obrigatório, exigido
 *   até esta etapa (`exigencia_documento`), está na pasta — da venda ou da
 *   pessoa. A foto do padrão e a conta de luz chegam sozinhas pela OS de
 *   vistoria; o documento do titular vem do cliente pelo WhatsApp.
 * - **Contrato e procuração**: anda quando o contrato volta assinado. É o que o
 *   dono pediu: "a partir do momento que o cliente reenviar o contrato".
 */

/** As etapas que andam sozinhas quando a papelada fica completa. */
export const ETAPAS_DE_DOCUMENTO = new Set(["documentacao", "contrato"]);

/**
 * Documentos que não são arquivo enviado, mas fato que o sistema já sabe.
 *
 * O protocolo da Energisa é o número do pedido de acesso: a extensão do Chrome
 * lê o portal e liga o projeto a ele (`energisa_projeto`), ou alguém anota o
 * número no projeto. Exigir também um PDF com esse número seria pedir à equipe
 * para provar o que o sistema já viu.
 */
export const DOCUMENTOS_DE_FATO = new Set(["protocolo"]);

interface ProjetoParaConferir {
  id: string;
  clienteId: string;
  protocoloConcessionaria?: string | null;
  etapa: { slug: string; ordem: number };
}

export interface SituacaoDocumentos {
  /** Pode andar para a próxima etapa. */
  pronto: boolean;
  /** Os tipos obrigatórios que ainda faltam (na Documentação), ou `["contrato"]` (no Contrato). */
  falta: string[];
}

/**
 * Confere a papelada de vários projetos de uma vez — a esteira pergunta por
 * todos os cartões da coluna numa ida só ao banco.
 */
export async function situacaoDosDocumentos(
  empresaId: string,
  projetos: ProjetoParaConferir[],
): Promise<Map<string, SituacaoDocumentos>> {
  const resultado = new Map<string, SituacaoDocumentos>();
  const alvo = projetos.filter((p) => ETAPAS_DE_DOCUMENTO.has(p.etapa.slug));
  if (!alvo.length) return resultado;

  const ids = alvo.map((p) => p.id);
  const clientes = [...new Set(alvo.map((p) => p.clienteId))];
  const [exigencias, docs, naEnergisa] = await Promise.all([
    db.query.exigenciaDocumento.findMany({
      where: eq(schema.exigenciaDocumento.empresaId, empresaId),
      columns: { tipo: true, obrigatorio: true, exigeAssinatura: true },
      with: { etapa: { columns: { ordem: true } } },
    }),
    db
      .select({
        tipo: schema.documento.tipo,
        status: schema.documento.status,
        projetoId: schema.documento.projetoId,
        clienteId: schema.documento.clienteId,
      })
      .from(schema.documento)
      .where(
        and(
          eq(schema.documento.empresaId, empresaId),
          or(
            inArray(schema.documento.projetoId, ids),
            // Documento da pessoa (CNH, RG) vale para qualquer venda dela.
            and(inArray(schema.documento.clienteId, clientes), isNull(schema.documento.projetoId)),
          ),
        ),
      ),
    db
      .select({ projetoId: schema.energisaProjeto.projetoId })
      .from(schema.energisaProjeto)
      .where(
        and(
          eq(schema.energisaProjeto.empresaId, empresaId),
          isNotNull(schema.energisaProjeto.projetoId),
          inArray(schema.energisaProjeto.projetoId, ids),
        ),
      ),
  ]);

  const assinatura = new Set(exigencias.filter((e) => e.exigeAssinatura).map((e) => e.tipo));
  assinatura.add("contrato");
  const comEnergisa = new Set(naEnergisa.map((e) => e.projetoId));

  for (const p of alvo) {
    const deles = docs.filter((d) => d.projetoId === p.id || (!d.projetoId && d.clienteId === p.clienteId));
    const entregues = tiposEntregues(deles, assinatura);
    if (comEnergisa.has(p.id) || p.protocoloConcessionaria) entregues.add("protocolo");

    if (p.etapa.slug === "contrato") {
      const tem = entregues.has("contrato");
      resultado.set(p.id, { pronto: tem, falta: tem ? [] : ["contrato"] });
      continue;
    }
    const falta = faltaNoDossie(p.etapa.ordem, exigencias, entregues).map((e) => e.tipo);
    // Sem nenhuma exigência cadastrada não há o que conferir: não anda às cegas.
    const devidas = exigencias.filter((e) => e.obrigatorio && e.etapa.ordem <= p.etapa.ordem);
    resultado.set(p.id, { pronto: devidas.length > 0 && falta.length === 0, falta });
  }
  return resultado;
}

/**
 * Anda o projeto se a papelada da etapa dele está completa.
 *
 * Chamada depois de todo jeito de um documento entrar (envio pela tela, foto da
 * OS, conclusão de OS, seta da esteira). Repete enquanto der: o projeto que
 * chega na Documentação com tudo já na pasta segue direto para o Contrato.
 *
 * Devolve o nome da última etapa a que chegou, ou null se não andou.
 */
export async function avancarPorDocumentos(
  empresaId: string,
  projetoId: string,
  usuarioId: string | null = null,
): Promise<string | null> {
  let chegou: string | null = null;

  for (let passo = 0; passo < 3; passo++) {
    const projeto = await db.query.projeto.findFirst({
      where: and(eq(schema.projeto.id, projetoId), eq(schema.projeto.empresaId, empresaId)),
      columns: { id: true, clienteId: true, situacao: true, protocoloConcessionaria: true },
      with: { etapa: { columns: { slug: true, ordem: true } } },
    });
    if (!projeto || projeto.situacao !== "em_andamento") break;
    const slug = projeto.etapa.slug;
    if (!ETAPAS_DE_DOCUMENTO.has(slug)) break;

    const situacao = (await situacaoDosDocumentos(empresaId, [projeto])).get(projeto.id);
    if (!situacao?.pronto) break;

    // Saindo do contrato porque ele voltou assinado: se o dia não foi anotado no
    // envio (documento que entrou por outro caminho), vale o de hoje.
    if (slug === "contrato") {
      await db
        .update(schema.projeto)
        .set({ contratoAssinadoEm: sql`coalesce(${schema.projeto.contratoAssinadoEm}, now())` })
        .where(eq(schema.projeto.id, projeto.id));
    }

    const nova = await moverNaEsteira({
      empresaId,
      projetoId: projeto.id,
      direcao: "avancar",
      usuarioId,
      observacao:
        slug === "contrato"
          ? "Automático: o contrato voltou assinado."
          : "Automático: os documentos exigidos até aqui estão na pasta.",
    });
    if (!nova) break;
    chegou = nova.nome;
  }

  return chegou;
}
