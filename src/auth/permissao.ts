import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";

import { db, schema } from "@/db";

import { exigirUsuario, type UsuarioSessao } from "./sessao";

/**
 * Quem pode mexer em qual documento do cliente.
 *
 * A regra é **"você cuida dos documentos das suas etapas"**, e ela não precisou
 * de tabela nova: `etapa.papelResponsavel` já diz de quem é cada etapa, e
 * `exigencia_documento` já diz qual documento nasce em qual etapa. Juntando os
 * dois, o acesso sai pronto — e passa a seguir a esteira: se o dono mudar quem
 * responde por uma etapa, o acesso ao documento acompanha, sem ninguém lembrar
 * de ajustar uma segunda lista.
 *
 * Na prática, hoje:
 *
 * | papel | documentos |
 * | --- | --- |
 * | técnico | foto do padrão, comprovante, nota fiscal |
 * | vendedor | conta de luz, orçamento, simulação, documento do titular, ficha, UCs |
 * | engenheiro | projeto, memorial, ART, boleto, datasheet, declaração, protocolo, compensativo |
 * | adm | tudo |
 * | estoque | nenhum — não entra na tela |
 *
 * A primeira versão disto era uma lista de papéis chapada no código, e barrava
 * o técnico por inteiro. Estava errada pelo motivo mais concreto possível: **é
 * o técnico quem tira a foto do padrão**, e faltar essa foto é o que trava 70
 * dossiês — o maior gargalo da empresa. Ele ia ao local, fotografava e tinha de
 * mandar por WhatsApp para alguém do escritório anexar, que é exatamente o
 * processo manual que o Selebi existe para acabar.
 *
 * O que continua valendo é o princípio da necessidade do art. 6º da LGPD: o
 * técnico sobe a foto do quadro e **não vê** a CNH nem o contrato do cliente.
 */

/** Papéis que respondem pela empresa e enxergam o dossiê inteiro. */
const VE_TUDO = new Set(["adm"]);

export type TipoDocumento = (typeof schema.tipoDocumento.enumValues)[number];

export interface AcessoDocumentos {
  usuario: UsuarioSessao;
  /** Verdadeiro quando o papel enxerga qualquer documento. */
  tudo: boolean;
  /** Tipos que este papel pode ver e enviar. Vazio quando `tudo`. */
  tipos: Set<string>;
  /** Este papel pode abrir e enviar documento deste tipo? */
  pode(tipo: string): boolean;
}

/**
 * Tipos de documento que um papel cuida, pelas etapas que são dele.
 *
 * Fora do `exigirAcesso` porque o menu também precisa saber, e porque testar
 * uma função que só lê é bem mais fácil do que testar um redirecionamento.
 */
export async function tiposDoPapel(
  empresaId: string,
  papel: string,
): Promise<Set<string>> {
  if (VE_TUDO.has(papel)) {
    return new Set(schema.tipoDocumento.enumValues);
  }

  const linhas = await db
    .select({ tipo: schema.exigenciaDocumento.tipo })
    .from(schema.exigenciaDocumento)
    .innerJoin(schema.etapa, eq(schema.etapa.id, schema.exigenciaDocumento.etapaId))
    .where(
      and(
        eq(schema.exigenciaDocumento.empresaId, empresaId),
        eq(schema.etapa.papelResponsavel, papel as never),
      ),
    );

  return new Set(linhas.map((l) => l.tipo));
}

/** Para o menu: vale a pena mostrar o link de Documentos para este usuário? */
export async function podeVerDocumentos(
  empresaId: string,
  papel: string,
): Promise<boolean> {
  if (VE_TUDO.has(papel)) return true;
  const tipos = await tiposDoPapel(empresaId, papel);
  return tipos.size > 0;
}

/**
 * Exige sessão **e** pelo menos um tipo de documento sob responsabilidade.
 *
 * Esconder o link no menu não protege nada — quem digitar o endereço entra. É
 * esta função, chamada dentro de cada página, rota e ação, que de fato barra.
 */
export async function exigirAcessoDocumentos(): Promise<AcessoDocumentos> {
  const usuario = await exigirUsuario();
  const tudo = VE_TUDO.has(usuario.papel);
  const tipos = await tiposDoPapel(usuario.empresaId, usuario.papel);

  if (!tudo && tipos.size === 0) redirect("/sem-acesso");

  return {
    usuario,
    tudo,
    tipos,
    pode: (tipo: string) => tudo || tipos.has(tipo),
  };
}
