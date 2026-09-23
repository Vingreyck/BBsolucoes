import { asc, eq, sql } from "drizzle-orm";

import { exigirUsuario } from "@/auth/sessao";
import { db, schema } from "@/db";

import { Ligar } from "./ligar";

export const dynamic = "force-dynamic";

/**
 * Usinas que o portal mostrou e ainda não sabemos de quem são.
 *
 * Esta tela é a contrapartida de uma decisão: o coletor **não inventa mais
 * dono**. Antes, ao achar uma usina desconhecida, ele criava um cliente com o
 * nome do login do técnico — "José Fernando7", "Deninho7", "micaely 03" — e o
 * resultado foram 289 clientes para cerca de 166 pessoas, com os documentos de
 * uma pessoa num registro e a usina dela em outro.
 *
 * Aqui alguém olha e diz de quem é. Um clique, e o alerta daquela usina passa a
 * encontrar o contrato e o telefone no dossiê.
 */

export default async function SemDono() {
  const usuario = await exigirUsuario();

  const orfas = await db.query.usina.findMany({
    where: sql`${schema.usina.empresaId} = ${usuario.empresaId} and ${schema.usina.clienteId} is null`,
    orderBy: asc(schema.usina.nome),
    with: {
      vinculosPortal: { with: { contaPortal: { columns: { fabricante: true } } } },
    },
  });

  const clientes = await db.query.cliente.findMany({
    where: eq(schema.cliente.empresaId, usuario.empresaId),
    columns: { id: true, nome: true },
    orderBy: asc(schema.cliente.nome),
  });

  /**
   * Quantos documentos cada cliente tem.
   *
   * Aparece na sugestão porque é o sinal que separa a pessoa de verdade do
   * registro inventado: `JOSE FERNANDO` tem 6 documentos e nenhuma usina;
   * `José Fernando7` tem uma usina e nenhum documento. Quem tem papel é quem
   * assinou contrato.
   */
  const contagem = await db
    .select({
      clienteId: schema.documento.clienteId,
      docs: sql<number>`count(*)::int`,
    })
    .from(schema.documento)
    .where(eq(schema.documento.empresaId, usuario.empresaId))
    .groupBy(schema.documento.clienteId);
  const docsPor = new Map(contagem.map((c) => [c.clienteId, c.docs]));

  /**
   * Sugere o cliente cujo nome mais se parece com o da usina.
   *
   * Sugestão, nunca decisão: quem confirma é a pessoa. Casar nome parecido
   * sozinho juntaria gente diferente de vez em quando, e cliente juntado
   * errado não se separa olhando a tela — os documentos de um passam a
   * aparecer no dossiê do outro.
   */
  function sugerir(nomeUsina: string) {
    const alvo = nomeUsina
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");
    if (alvo.length < 3) return [];

    return clientes
      .map((c) => {
        const base = c.nome
          .normalize("NFD")
          .replace(/[̀-ͯ]/g, "")
          .toLowerCase()
          .replace(/[^a-z0-9]/g, "");
        const contido = base.includes(alvo) || alvo.includes(base);
        return { ...c, docs: docsPor.get(c.id) ?? 0, contido, base };
      })
      .filter((c) => c.contido && c.base.length >= 3)
      // Quem tem documento primeiro: é o registro que veio do contrato.
      .sort((a, b) => b.docs - a.docs || a.nome.localeCompare(b.nome, "pt-BR"))
      .slice(0, 4);
  }

  if (orfas.length === 0) {
    return (
      <main>
        <header className="topo">
          <h1>Usinas sem dono</h1>
        </header>
        <div className="vazio">
          <p>
            Nenhuma usina esperando. Toda usina dos portais está ligada a um
            cliente.
          </p>
          <p>
            <a href="/usinas">Ver todas as usinas</a>
          </p>
        </div>
      </main>
    );
  }

  return (
    <main>
      <header className="topo">
        <h1>Usinas sem dono</h1>
        <span className="sub">{orfas.length} esperando</span>
      </header>

      <p className="aviso">
        Estas usinas apareceram no portal do fabricante e o sistema{" "}
        <strong>não inventou um dono para elas</strong>. O nome que vem do
        portal é login de técnico, não de pessoa — <code>José Fernando7</code>,{" "}
        <code>micaely 03</code> —, e criar cliente a partir dele foi o que
        encheu o cadastro de gente repetida.
      </p>

      <p className="aviso">
        Ligue cada uma ao cliente certo. Feito isso, o alerta daquela usina
        passa a encontrar o contrato, o telefone e a ART no dossiê. A sugestão
        prioriza quem <strong>tem documento</strong>, porque é o registro que
        veio do contrato assinado — mas confira: juntar duas pessoas diferentes
        não se desfaz olhando a tela.
      </p>

      <div className="cartoes">
        {orfas.map((u) => {
          const portal = u.vinculosPortal[0]?.contaPortal?.fabricante ?? "—";
          return (
            <div key={u.id} className="cartao">
              <h3>{u.nome}</h3>
              <p className="fraco">
                {portal}
                {u.cidade ? ` · ${u.cidade}` : ""}
              </p>
              <Ligar
                usinaId={u.id}
                sugestoes={sugerir(u.nome)}
                clientes={clientes.map((c) => ({
                  id: c.id,
                  nome: c.nome,
                  docs: docsPor.get(c.id) ?? 0,
                }))}
              />
            </div>
          );
        })}
      </div>
    </main>
  );
}
