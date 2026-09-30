import { asc, eq } from "drizzle-orm";
import Link from "next/link";
import { redirect } from "next/navigation";

import { exigirUsuario } from "@/auth/sessao";
import { db, schema } from "@/db";
import { garantirModelos } from "@/os/modelos";
import { TIPO_ROTULO } from "@/os/tipos";

export const dynamic = "force-dynamic";

export default async function Modelos() {
  const usuario = await exigirUsuario();
  if (usuario.papel !== "adm") redirect("/sem-acesso");
  await garantirModelos(usuario.empresaId);

  const [modelos, etapas] = await Promise.all([
    db.query.modeloOs.findMany({
      where: eq(schema.modeloOs.empresaId, usuario.empresaId),
      with: { itens: { columns: { obrigatorio: true, fotosMinimas: true } } },
    }),
    db.query.etapa.findMany({
      where: eq(schema.etapa.empresaId, usuario.empresaId),
      columns: { slug: true, nome: true },
      orderBy: asc(schema.etapa.ordem),
    }),
  ]);
  const nomeEtapa = new Map(etapas.map((e) => [e.slug, e.nome]));
  modelos.sort((a, b) => a.nome.localeCompare(b.nome));

  return (
    <main>
      <header className="topo">
        <h1>Modelos de OS</h1>
        <span className="sub">o checklist, o prazo e a regra de cada tipo de ordem de serviço</span>
      </header>
      <p className="aviso">
        O que muda aqui vale para as OS abertas daqui em diante. As que já existem guardaram a própria cópia do
        checklist: o técnico no meio de um atendimento não vê a lista mudar, e o relatório continua batendo.
      </p>
      <div className="tabela-wrap">
        <table className="tabela">
          <thead>
            <tr>
              <th>Tipo</th>
              <th>Nome</th>
              <th className="num">Itens</th>
              <th className="num">Obrigatórios</th>
              <th className="num">Fotos exigidas</th>
              <th>Prazo</th>
              <th>Assinatura</th>
              <th>Anda a esteira de</th>
            </tr>
          </thead>
          <tbody>
            {modelos.map((m) => (
              <tr key={m.id}>
                <td>
                  <Link href={`/administracao/modelos/${m.tipo}`} className="forte">
                    {TIPO_ROTULO[m.tipo] ?? m.tipo}
                  </Link>
                </td>
                <td>{m.nome}</td>
                <td className={`num${m.itens.length ? "" : " ruim"}`}>{m.itens.length || "vazio"}</td>
                <td className="num">{m.itens.filter((i) => i.obrigatorio).length}</td>
                <td className="num">{m.itens.reduce((s, i) => s + i.fotosMinimas, 0)}</td>
                <td className={m.prazoHoras ? "" : "fraco"}>{m.prazoHoras ? `${m.prazoHoras} h` : "sem prazo"}</td>
                <td>{m.exigeAssinatura ? "exige" : <span className="fraco">não</span>}</td>
                <td className={m.etapaSlug ? "" : "fraco"}>
                  {m.etapaSlug ? (nomeEtapa.get(m.etapaSlug) ?? m.etapaSlug) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
