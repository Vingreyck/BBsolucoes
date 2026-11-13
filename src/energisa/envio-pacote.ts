import { and, desc, eq, inArray, isNull, or } from "drizzle-orm";

import { db, schema } from "@/db";
import { distribuidoraDaCidade } from "@/projeto/da-vistoria";

import { conferirEnvio, dadosParaOPortal, DOCUMENTOS_DO_ENVIO, type CampoDoPortal, type ItemDoEnvio } from "./envio";

export interface PacoteDeEnvio {
  projetoId: string;
  cliente: string;
  etapaSlug: string;
  protocolo: string | null;
  enviadoEm: Date | null;
  campos: CampoDoPortal[];
  itens: (ItemDoEnvio & { documentoId: string | null; nomeArquivo: string | null })[];
  faltam: string[];
}

/**
 * Tudo o que o engenheiro precisa para pedir o acesso no portal: os dados do
 * formulário e, de cada documento do pedido, a versão mais nova que vale (da
 * venda ou da pessoa). Serve a tela do dossiê e a extensão, para as duas
 * mostrarem o mesmo.
 */
export async function pacoteDeEnvio(empresaId: string, projetoId: string): Promise<PacoteDeEnvio | null> {
  const projeto = await db.query.projeto.findFirst({
    where: and(eq(schema.projeto.id, projetoId), eq(schema.projeto.empresaId, empresaId)),
    with: { cliente: true, etapa: { columns: { slug: true } } },
  });
  if (!projeto) return null;

  const tipos = DOCUMENTOS_DO_ENVIO.map((d) => d.tipo) as (typeof schema.tipoDocumento.enumValues)[number][];
  const modelos = [projeto.inversorModeloId, projeto.moduloModeloId].filter((id): id is string => Boolean(id));
  const [uc, catalogo, docs, assinatura] = await Promise.all([
    db.query.unidadeConsumidora.findFirst({
      where: and(
        eq(schema.unidadeConsumidora.empresaId, empresaId),
        eq(schema.unidadeConsumidora.clienteId, projeto.clienteId),
      ),
      orderBy: desc(schema.unidadeConsumidora.criadoEm),
      columns: { numeroInstalacao: true, titular: true, concessionaria: true },
    }),
    modelos.length
      ? db.query.modeloEquipamento.findMany({
          where: and(eq(schema.modeloEquipamento.empresaId, empresaId), inArray(schema.modeloEquipamento.id, modelos)),
          columns: { id: true, fabricante: true, modelo: true, potenciaW: true },
        })
      : [],
    db.query.documento.findMany({
      where: and(
        eq(schema.documento.empresaId, empresaId),
        inArray(schema.documento.tipo, tipos),
        or(
          eq(schema.documento.projetoId, projeto.id),
          and(eq(schema.documento.clienteId, projeto.clienteId), isNull(schema.documento.projetoId)),
        ),
      ),
      columns: { id: true, tipo: true, status: true, versao: true, nomeArquivo: true, projetoId: true },
    }),
    db.query.exigenciaDocumento.findMany({
      where: and(eq(schema.exigenciaDocumento.empresaId, empresaId), eq(schema.exigenciaDocumento.exigeAssinatura, true)),
      columns: { tipo: true },
    }),
  ]);

  // Vale o que conta como entregue no dossiê (`tiposEntregues`): nem arquivo de
  // trabalho, nem o que exige assinatura e ainda espera por ela. Entre os que
  // valem, o da venda antes do da pessoa, e a versão mais nova.
  const exigeAssinatura = new Set(assinatura.map((e) => e.tipo));
  const melhor = new Map<string, (typeof docs)[number]>();
  for (const d of docs) {
    if (d.status === "trabalho" || (exigeAssinatura.has(d.tipo) && d.status === "aguardando_assinatura")) continue;
    const atual = melhor.get(d.tipo);
    const nota = (x: typeof d) => (x.projetoId ? 1_000_000 : 0) + x.versao;
    if (!atual || nota(d) > nota(atual)) melhor.set(d.tipo, d);
  }

  const { itens, faltam } = conferirEnvio(new Set(melhor.keys()));
  const doCatalogo = (id: string | null) => catalogo.find((m) => m.id === id) ?? null;

  return {
    projetoId: projeto.id,
    cliente: projeto.cliente.nome,
    etapaSlug: projeto.etapa.slug,
    protocolo: projeto.protocoloConcessionaria,
    enviadoEm: projeto.energisaEnviadoEm,
    campos: dadosParaOPortal({
      cliente: projeto.cliente,
      uc: uc ? { numero: uc.numeroInstalacao, titular: uc.titular, concessionaria: uc.concessionaria } : null,
      distribuidora: projeto.concessionaria?.trim() || distribuidoraDaCidade(projeto.cliente.cidade),
      potenciaKwp: projeto.potenciaKwp,
      inversor: doCatalogo(projeto.inversorModeloId),
      inversorQtd: projeto.inversorQtd,
      modulo: doCatalogo(projeto.moduloModeloId),
      moduloQtd: projeto.moduloQtd,
      telhado: projeto.telhadoTipo,
      numeroArt: projeto.numeroArt,
    }),
    itens: itens.map((i) => {
      const d = melhor.get(i.tipo);
      return { ...i, documentoId: d?.id ?? null, nomeArquivo: d?.nomeArquivo ?? null };
    }),
    faltam,
  };
}
