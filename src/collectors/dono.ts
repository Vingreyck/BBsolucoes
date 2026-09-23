import { and, eq, sql } from "drizzle-orm";

import { db, schema } from "../db";

/**
 * De quem é esta usina que apareceu no portal?
 *
 * Um lugar só para a regra, porque os quatro coletores faziam a mesma coisa e
 * a mesma coisa estava errada nos quatro.
 *
 * O que mudou foi o `else`. Antes, não achando cliente com aquele nome, o
 * coletor **criava um**. Parece inofensivo e não é: o nome que vem no portal é
 * login de técnico, não nome de pessoa. "José Fernando7". "Deninho7".
 * "micaely 03". "EDPGV8001", que é o código de distribuidor da própria BB.
 *
 * Deu 289 clientes para cerca de 166 pessoas. `JOSE FERNANDO` ficou com 6
 * documentos e nenhuma usina; `José Fernando7` ficou com uma usina parada
 * desde agosto e nenhum documento. Quem abre o dossiê não vê a usina parada, e
 * quem abre o alerta não acha o contrato nem o telefone.
 *
 * Agora, não achando, devolve `null` — e a usina fica sem dono, esperando
 * alguém ligá-la ao cliente certo em `/usinas/sem-dono`. "Não sei de quem é" é
 * uma resposta honesta e reversível; inventar um dono não é nem uma coisa nem
 * outra.
 */

/** Minúsculo, sem acento, espaços colapsados. */
const COMPARAVEL = sql`lower(regexp_replace(translate(${schema.cliente.nome},
  'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
  'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC'), '\\s+', ' ', 'g'))`;

/**
 * Casa só por nome **idêntico**, ignorando maiúscula e acento.
 *
 * `BARBARA KELLY` e `Bárbara Kelly` são a mesma pessoa, com segurança. Já
 * `José Fernando7` e `JOSE FERNANDO` diferem por um dígito que pode ser
 * qualquer coisa — o sétimo cliente daquele técnico, o número da usina, um
 * engano. Casar isso sozinho juntaria duas pessoas às vezes, e juntar cliente
 * errado não se desfaz olhando a tela: os documentos de um passam a aparecer
 * no dossiê do outro.
 *
 * Aproximar nome é trabalho de gente conferindo, e é o que a tela de usinas
 * sem dono existe para tornar rápido.
 */
export async function donoConhecido(
  empresaId: string,
  nomeNoPortal: string,
): Promise<string | null> {
  const alvo = nomeNoPortal
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

  if (!alvo) return null;

  const [achado] = await db
    .select({ id: schema.cliente.id })
    .from(schema.cliente)
    .where(and(eq(schema.cliente.empresaId, empresaId), eq(COMPARAVEL, alvo)))
    .limit(1);

  return achado?.id ?? null;
}
