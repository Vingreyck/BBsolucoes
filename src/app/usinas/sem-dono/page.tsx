import { asc, eq, sql } from "drizzle-orm";
import { CheckCircle2, Hourglass, Info } from "lucide-react";

import { exigirUsuario } from "@/auth/sessao";
import { db, schema } from "@/db";

import { instalacoesSemUsina, projetosSemUsina } from "@/geracao/pendencias-de-usina";
import { sugerirVendasParaUsina } from "@/geracao/sugestao-dono";

import { Cabecalho, Cartao, Vazio } from "../../_ui";
import { TabelaSemDono, type UsinaSemDono } from "./tabela";

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
    where: sql`${schema.usina.empresaId} = ${usuario.empresaId} and ${schema.usina.clienteId} is null and ${schema.usina.arquivadaEm} is null`,
    orderBy: asc(schema.usina.nome),
    with: {
      vinculosPortal: { with: { contaPortal: { columns: { fabricante: true } } } },
    },
  });

  // As vendas já instaladas que ainda não têm usina: de quem pode ser cada usina órfã.
  const [candidatos, instalacoes] = await Promise.all([
    projetosSemUsina(usuario.empresaId),
    instalacoesSemUsina(usuario.empresaId),
  ]);

  const clientes = await db.query.cliente.findMany({
    where: eq(schema.cliente.empresaId, usuario.empresaId),
    columns: { id: true, nome: true, cidade: true },
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

  /** As vendas instaladas que mais combinam com a usina (nome, cidade, época). */
  function vendasSugeridas(u: (typeof orfas)[number]) {
    return sugerirVendasParaUsina(
      { nome: u.nome, cidade: u.cidade, instaladaEm: u.dataInstalacao, criadaEm: u.criadoEm },
      candidatos,
    );
  }

  if (orfas.length === 0 && instalacoes.length === 0) {
    return (
      <main>
        <Cabecalho trilha={[{ href: "/usinas", rotulo: "Usinas" }]} titulo="Usinas sem dono" />
        <div className="pagina-corpo">
          <Vazio
            icone={<CheckCircle2 size={20} />}
            titulo="Nenhuma usina esperando"
            acao={
              <a href="/usinas" className="botao secundario">
                Ver todas as usinas
              </a>
            }
          >
            Toda usina dos portais está ligada a um cliente.
          </Vazio>
        </div>
      </main>
    );
  }

  // Uma linha por usina órfã; os clientes vão uma vez só para a tabela inteira.
  const linhas: UsinaSemDono[] = orfas.map((u) => {
    const vendas = vendasSugeridas(u);
    return {
      id: u.id,
      nome: u.nome,
      portal: u.vinculosPortal[0]?.contaPortal?.fabricante ?? "—",
      cidade: u.cidade,
      instaladaEm: u.dataInstalacao ? u.dataInstalacao.toISOString().slice(0, 10) : null,
      vendas: vendas.map((v) => ({ projetoId: v.projetoId, clienteNome: v.clienteNome, motivos: v.motivos })),
      parecidos: sugerir(u.nome)
        .filter((c) => !vendas.some((v) => v.clienteId === c.id))
        .map((c) => ({ id: c.id, nome: c.nome, cidade: c.cidade, docs: c.docs })),
    };
  });
  // Todos os clientes, novos e antigos: a usina pode ser de quem comprou há anos.
  const todosOsClientes = clientes.map((c) => ({ id: c.id, nome: c.nome, cidade: c.cidade, docs: docsPor.get(c.id) ?? 0 }));
  const selos = (
    <>
      {orfas.length > 0 && <span className="pilula sev-atencao">{orfas.length} esperando dono</span>}
      {instalacoes.length > 0 && (
        <span className="pilula sev-atencao">
          {instalacoes.length} {instalacoes.length > 1 ? "instaladas" : "instalada"} sem usina
        </span>
      )}
    </>
  );

  return (
    <main>
      <Cabecalho
        trilha={[{ href: "/usinas", rotulo: "Usinas" }]}
        titulo="Usinas sem dono"
        selos={selos}
        meta="Ligue cada usina ao cliente certo: assim o alerta dela encontra o contrato, o telefone e a ART."
      />

      <details className="como-ler">
        <summary>
          <Info size={15} aria-hidden /> Por que essas usinas não têm dono
        </summary>
        <div>
          <p>
            Estas usinas apareceram no portal do fabricante e o sistema <strong>não inventou um dono para elas</strong>. O
            nome que vem do portal é login de técnico, não de pessoa — <code>José Fernando7</code>, <code>micaely 03</code>{" "}
            —, e criar cliente a partir dele foi o que encheu o cadastro de gente repetida.
          </p>
          <p>
            A sugestão prioriza quem <strong>tem documento</strong>, porque é o registro que veio do contrato assinado — mas
            confira: juntar duas pessoas diferentes não se desfaz olhando a tela.
          </p>
        </div>
      </details>

      {instalacoes.length > 0 && (
        <div className="pagina-corpo">
          <Cartao
            titulo="Instaladas e ainda sem usina no portal"
            icone={<Hourglass size={16} />}
            contador={instalacoes.length}
            ajuda="Instalação concluída há 3 dias ou mais e nenhuma usina do cliente apareceu. O técnico pode ter esquecido de criá-la no portal, ou o inversor é de um fabricante que o Selebi ainda não lê (Hoymiles, GoodWe e NEP)."
          >
            <ul className="lista-instalacoes">
              {instalacoes.map((i) => (
                <li key={i.projetoId}>
                  <a href={`/projeto/${i.projetoId}`}>
                    <strong>{i.clienteNome}</strong>
                  </a>
                  <span className="fraco">
                    {" "}
                    · instalada há {i.dias} dias{i.cidade ? ` · ${i.cidade}` : ""} ·{" "}
                    {i.seriais > 0
                      ? `${i.seriais === 1 ? "serial anotado" : `${i.seriais} seriais anotados`}, o portal ainda não mostrou`
                      : "sem serial do inversor anotado"}
                  </span>
                </li>
              ))}
            </ul>
          </Cartao>
        </div>
      )}

      {linhas.length > 0 && <TabelaSemDono usinas={linhas} clientes={todosOsClientes} />}
    </main>
  );
}
