import { and, desc, eq, inArray, isNotNull, isNull, like, not, or } from "drizzle-orm";

import { db, schema } from "@/db";

import type { EntradaContrato } from "./contrato";

/**
 * O que o contrato precisa do banco: quem pode assinar pela empresa, o último
 * contrato de cada projeto e a montagem da entrada a partir das linhas.
 */

/** Quem assina pela empresa: adm ou engenheiro com conta ativa e nominal. */
export async function representantesDaEmpresa(empresaId: string) {
  return db
    .select({ id: schema.usuario.id, nome: schema.usuario.nome, papel: schema.usuario.papel, cpf: schema.usuario.cpf })
    .from(schema.usuario)
    .where(
      and(
        eq(schema.usuario.empresaId, empresaId),
        eq(schema.usuario.ativo, true),
        isNotNull(schema.usuario.aprovadoEm),
        inArray(schema.usuario.papel, ["adm", "engenheiro"]),
        // As contas genéricas do seed não são de ninguém: não assinam contrato.
        // (Quem entra só pelo app não tem e-mail, e continua valendo.)
        or(isNull(schema.usuario.email), not(like(schema.usuario.email, "%@bbsolucoes.local"))),
      ),
    )
    .orderBy(schema.usuario.nome);
}

export type Representante = Awaited<ReturnType<typeof representantesDaEmpresa>>[number];

/** O contrato mais recente de cada projeto (gerar de novo cria outro; vale o último). */
export async function ultimosContratos(empresaId: string, projetoIds: string[]) {
  const mapa = new Map<
    string,
    { id: string; token: string; criadoEm: Date; enviadoEm: Date | null; representante: string | null }
  >();
  if (!projetoIds.length) return mapa;
  const linhas = await db
    .select({
      id: schema.contrato.id,
      projetoId: schema.contrato.projetoId,
      token: schema.contrato.token,
      criadoEm: schema.contrato.criadoEm,
      enviadoEm: schema.contrato.enviadoEm,
      representante: schema.usuario.nome,
    })
    .from(schema.contrato)
    .leftJoin(schema.usuario, eq(schema.usuario.id, schema.contrato.representanteId))
    .where(and(eq(schema.contrato.empresaId, empresaId), inArray(schema.contrato.projetoId, projetoIds)))
    .orderBy(desc(schema.contrato.criadoEm));
  for (const l of linhas) {
    if (!mapa.has(l.projetoId)) mapa.set(l.projetoId, l);
  }
  return mapa;
}

type LinhaCliente = Pick<
  typeof schema.cliente.$inferSelect,
  "nome" | "tipo" | "cpfCnpj" | "logradouro" | "numero" | "complemento" | "bairro" | "cidade" | "uf" | "cep"
>;
type LinhaProjeto = Pick<
  typeof schema.projeto.$inferSelect,
  "equipamentos" | "valor" | "formaPagamento" | "pagamentoCondicoes"
>;
type LinhaEmpresa = Pick<typeof schema.empresa.$inferSelect, "nome" | "razaoSocial" | "cnpj" | "endereco" | "email">;

/** As linhas do banco no formato que `faltaParaContrato` e `montarContrato` pedem. */
export function entradaDe(
  cliente: LinhaCliente,
  projeto: LinhaProjeto,
  empresa: LinhaEmpresa,
  representante: { nome: string; cpf: string | null } | null,
): EntradaContrato {
  return {
    cliente: {
      nome: cliente.nome,
      tipo: cliente.tipo,
      cpfCnpj: cliente.cpfCnpj,
      logradouro: cliente.logradouro,
      numero: cliente.numero,
      complemento: cliente.complemento,
      bairro: cliente.bairro,
      cidade: cliente.cidade,
      uf: cliente.uf,
      cep: cliente.cep,
    },
    projeto: {
      equipamentos: projeto.equipamentos,
      valor: projeto.valor,
      formaPagamento: projeto.formaPagamento,
      pagamentoCondicoes: projeto.pagamentoCondicoes,
    },
    empresa: {
      nome: empresa.nome,
      razaoSocial: empresa.razaoSocial,
      cnpj: empresa.cnpj,
      endereco: empresa.endereco,
      email: empresa.email,
    },
    representante,
  };
}
