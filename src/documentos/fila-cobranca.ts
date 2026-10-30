import { and, desc, eq, inArray } from "drizzle-orm";

import { db, schema } from "@/db";

import { faltaNoDossie, numeroWhatsapp, pedidosAoCliente } from "./cobranca";

/**
 * Quem cobrar, e de quê: os dossiês em andamento em que falta documento que é
 * do cliente mandar.
 *
 * Usa a mesma regra da tela de dossiês (`exigencia_documento` + etapa atual +
 * documento da pessoa valendo para todas as vendas dela), só que olhando
 * apenas para o que o cliente manda — ver `cobranca.ts`.
 */

export interface LinhaCobranca {
  projetoId: string;
  titulo: string;
  clienteId: string;
  cliente: string;
  telefone: string | null;
  /** Já no formato do WhatsApp (55 + DDD + número), ou nulo se o cadastro não tem um número válido. */
  whatsapp: string | null;
  etapa: string;
  etapaDesde: Date | null;
  /** Os tipos que o cliente deve, na ordem da mensagem. */
  tipos: string[];
  ultimaCobranca: { quando: Date; por: string | null } | null;
  vezes: number;
}

export async function filaDeCobranca(
  empresaId: string,
  opcoes: { pode?: (tipo: string) => boolean; projetoId?: string } = {},
): Promise<LinhaCobranca[]> {
  const pode = opcoes.pode ?? (() => true);

  const [exigencias, projetos] = await Promise.all([
    db.query.exigenciaDocumento.findMany({
      where: eq(schema.exigenciaDocumento.empresaId, empresaId),
      with: { etapa: { columns: { ordem: true } } },
    }),
    db.query.projeto.findMany({
      where: and(
        eq(schema.projeto.empresaId, empresaId),
        // Só venda andando: pausada ou cancelada não se cobra do cliente.
        eq(schema.projeto.situacao, "em_andamento"),
        ...(opcoes.projetoId ? [eq(schema.projeto.id, opcoes.projetoId)] : []),
      ),
      with: {
        cliente: { columns: { id: true, nome: true, telefone: true } },
        etapa: { columns: { nome: true, ordem: true } },
        documentos: { columns: { tipo: true, status: true } },
      },
    }),
  ]);
  if (!projetos.length) return [];

  // Documento da pessoa (CNH, RG) vale para qualquer venda dela.
  const clientes = [...new Set(projetos.map((p) => p.clienteId))];
  const daPessoa = await db
    .select({ clienteId: schema.documento.clienteId, tipo: schema.documento.tipo, status: schema.documento.status })
    .from(schema.documento)
    .where(and(eq(schema.documento.empresaId, empresaId), inArray(schema.documento.clienteId, clientes)));
  const tiposDaPessoa = new Map<string, Set<string>>();
  for (const d of daPessoa) {
    if (d.status === "trabalho") continue;
    const s = tiposDaPessoa.get(d.clienteId) ?? new Set<string>();
    s.add(d.tipo);
    tiposDaPessoa.set(d.clienteId, s);
  }

  const cobrancas = await db
    .select({
      projetoId: schema.cobrancaDocumento.projetoId,
      criadoEm: schema.cobrancaDocumento.criadoEm,
      por: schema.usuario.nome,
    })
    .from(schema.cobrancaDocumento)
    .leftJoin(schema.usuario, eq(schema.usuario.id, schema.cobrancaDocumento.usuarioId))
    .where(
      and(
        eq(schema.cobrancaDocumento.empresaId, empresaId),
        inArray(
          schema.cobrancaDocumento.projetoId,
          projetos.map((p) => p.id),
        ),
      ),
    )
    .orderBy(desc(schema.cobrancaDocumento.criadoEm));
  const historico = new Map<string, { quando: Date; por: string | null; vezes: number }>();
  for (const c of cobrancas) {
    const ja = historico.get(c.projetoId);
    if (ja) ja.vezes++;
    else historico.set(c.projetoId, { quando: c.criadoEm, por: c.por, vezes: 1 });
  }

  const linhas: LinhaCobranca[] = [];
  for (const p of projetos) {
    const entregues = new Set<string>(p.documentos.filter((d) => d.status !== "trabalho").map((d) => d.tipo));
    for (const t of tiposDaPessoa.get(p.clienteId) ?? []) entregues.add(t);
    const falta = faltaNoDossie(p.etapa.ordem, exigencias, entregues).map((e) => e.tipo);
    const tipos = pedidosAoCliente(falta.filter(pode));
    if (!tipos.length) continue;
    const h = historico.get(p.id);
    linhas.push({
      projetoId: p.id,
      titulo: p.titulo,
      clienteId: p.cliente.id,
      cliente: p.cliente.nome,
      telefone: p.cliente.telefone,
      whatsapp: numeroWhatsapp(p.cliente.telefone),
      etapa: p.etapa.nome,
      etapaDesde: p.etapaDesde ?? null,
      tipos,
      ultimaCobranca: h ? { quando: h.quando, por: h.por } : null,
      vezes: h?.vezes ?? 0,
    });
  }
  return linhas;
}

/**
 * A ordem da fila: quem nunca foi cobrado primeiro (o mais antigo na etapa na
 * frente), depois quem foi cobrado há mais tempo. Quem foi cobrado nos últimos
 * dois dias vai para o fim — o cliente ainda pode estar juntando os papéis.
 */
export function ordenarFila(linhas: LinhaCobranca[], agora = Date.now()): LinhaCobranca[] {
  const recente = (l: LinhaCobranca) => (l.ultimaCobranca ? agora - l.ultimaCobranca.quando.getTime() < 2 * 86_400_000 : false);
  const chave = (l: LinhaCobranca) => l.ultimaCobranca?.quando.getTime() ?? 0;
  const naEtapa = (l: LinhaCobranca) => l.etapaDesde?.getTime() ?? 0;
  return [...linhas].sort(
    (a, b) =>
      Number(recente(a)) - Number(recente(b)) ||
      Number(Boolean(a.ultimaCobranca)) - Number(Boolean(b.ultimaCobranca)) ||
      chave(a) - chave(b) ||
      naEtapa(a) - naEtapa(b),
  );
}
