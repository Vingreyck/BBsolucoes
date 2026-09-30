import { and, asc, eq, or, sql } from "drizzle-orm";
import Link from "next/link";

import { db, schema } from "@/db";
import { exigirGestaoWeb } from "@/os/acesso";
import { responsaveisPossiveis } from "@/os/consultas";
import { garantirModelos } from "@/os/modelos";
import { PRIORIDADE_ROTULO, TIPO_ROTULO } from "@/os/tipos";

import { criarOsAction } from "../actions";

export const dynamic = "force-dynamic";

/** A etapa em que o projeto está sugere o tipo da OS. */
const TIPO_DA_ETAPA: Record<string, string> = {
  vistoria_tecnica: "vistoria",
  execucao: "instalacao",
};

const PAPEL: Record<string, string> = {
  tecnico: "técnico",
  vendedor: "vendedor",
  engenheiro: "engenheiro",
  adm: "adm",
};

export default async function NovaOs({
  searchParams,
}: {
  searchParams: Promise<{ cliente?: string; projeto?: string; usina?: string; tipo?: string; q?: string; erro?: string }>;
}) {
  const ator = await exigirGestaoWeb();
  const p = await searchParams;
  const empresaId = ator.empresaId;

  // Veio de um projeto ou de uma usina: o cliente sai de lá.
  let clienteId = p.cliente;
  const projetoOrigem = p.projeto
    ? await db.query.projeto.findFirst({
        where: and(eq(schema.projeto.id, p.projeto), eq(schema.projeto.empresaId, empresaId)),
        with: { etapa: { columns: { slug: true } } },
      })
    : null;
  if (!clienteId && projetoOrigem) clienteId = projetoOrigem.clienteId;
  if (!clienteId && p.usina) {
    const usina = await db.query.usina.findFirst({
      where: and(eq(schema.usina.id, p.usina), eq(schema.usina.empresaId, empresaId)),
      columns: { clienteId: true },
    });
    clienteId = usina?.clienteId ?? undefined;
  }

  const cliente = clienteId
    ? await db.query.cliente.findFirst({
        where: and(eq(schema.cliente.id, clienteId), eq(schema.cliente.empresaId, empresaId)),
        with: {
          usinas: { columns: { id: true, nome: true, cidade: true } },
          projetos: {
            columns: { id: true, titulo: true, situacao: true },
            with: { etapa: { columns: { nome: true, slug: true } } },
          },
        },
      })
    : null;

  // ---- passo 1: escolher o cliente ----------------------------------------
  if (!cliente) {
    const busca = (p.q ?? "").trim();
    const padrao = `%${busca.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()}%`;
    const digitos = busca.replace(/\D/g, "");
    const achados = busca
      ? await db.query.cliente.findMany({
          where: and(
            eq(schema.cliente.empresaId, empresaId),
            or(
              sql`translate(lower(${schema.cliente.nome}), 'áàâãäéèêëíìîïóòôõöúùûüç', 'aaaaaeeeeiiiiooooouuuuc') like ${padrao}`,
              sql`translate(lower(coalesce(${schema.cliente.cidade}, '')), 'áàâãäéèêëíìîïóòôõöúùûüç', 'aaaaaeeeeiiiiooooouuuuc') like ${padrao}`,
              digitos.length >= 3
                ? sql`regexp_replace(coalesce(${schema.cliente.cpfCnpj}, ''), '\\D', '', 'g') like ${`%${digitos}%`}`
                : undefined,
            ),
          ),
          columns: { id: true, nome: true, cidade: true, uf: true },
          orderBy: asc(schema.cliente.nome),
          limit: 30,
        })
      : [];

    return (
      <main>
        <header className="topo">
          <h1>Nova ordem de serviço</h1>
          <span className="sub">Passo 1 de 2 · para qual cliente?</span>
        </header>
        <div className="os-form">
          <form method="get" action="/os/nova" className="busca-cliente">
            <input
              type="search"
              name="q"
              defaultValue={busca}
              placeholder="Nome, cidade ou CPF/CNPJ do cliente"
              autoFocus
              aria-label="Buscar cliente"
            />
            <button type="submit" className="botao">
              Buscar
            </button>
          </form>
          {busca && achados.length === 0 && (
            <p className="nota">Nenhum cliente encontrado para “{busca}”.</p>
          )}
          {achados.length > 0 && (
            <ul className="lista-escolha">
              {achados.map((c) => (
                <li key={c.id}>
                  <Link href={`/os/nova?cliente=${c.id}`}>
                    <strong>{c.nome}</strong>
                    <span className="fraco">{[c.cidade, c.uf].filter(Boolean).join(" - ")}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <p className="nota">
            Também dá para abrir uma OS direto da tela do projeto, já com a venda ligada, ou de um{" "}
            <Link href="/alertas">alerta de usina</Link>.
          </p>
        </div>
      </main>
    );
  }

  // ---- passo 2: os dados da OS --------------------------------------------
  await garantirModelos(empresaId);
  const [pessoas, modelos] = await Promise.all([
    responsaveisPossiveis(empresaId),
    db.query.modeloOs.findMany({
      where: eq(schema.modeloOs.empresaId, empresaId),
      columns: { tipo: true, nome: true, prazoHoras: true },
    }),
  ]);

  const projetos = cliente.projetos.filter((pr) => pr.situacao === "em_andamento" || pr.id === p.projeto);
  const projetoEscolhido = projetoOrigem?.id ?? (projetos.length === 1 ? projetos[0].id : "");
  const etapaSlug = projetoOrigem?.etapa.slug ?? projetos.find((pr) => pr.id === projetoEscolhido)?.etapa.slug;
  const tipoSugerido =
    (p.tipo && p.tipo in TIPO_ROTULO ? p.tipo : undefined) ?? (etapaSlug ? TIPO_DA_ETAPA[etapaSlug] : undefined) ?? "corretiva";
  const usinaEscolhida = p.usina ?? (cliente.usinas.length === 1 ? cliente.usinas[0].id : "");

  return (
    <main>
      <header className="topo">
        <h1>Nova ordem de serviço</h1>
        <span className="sub">Passo 2 de 2 · {cliente.nome}</span>
      </header>

      {p.erro && (
        <p className="aviso erro" role="alert">
          {p.erro}
        </p>
      )}

      <div className="os-form">
        <form action={criarOsAction} className="form-ficha">
          <input type="hidden" name="clienteId" value={cliente.id} />

          <fieldset>
            <legend>O que fazer</legend>
            <div className="dupla">
              <label>
                Tipo <span className="req">*</span>
                <select name="tipo" defaultValue={tipoSugerido} required>
                  {modelos
                    .sort((a, b) => (TIPO_ROTULO[a.tipo] ?? "").localeCompare(TIPO_ROTULO[b.tipo] ?? ""))
                    .map((m) => (
                      <option key={m.tipo} value={m.tipo}>
                        {m.nome}
                        {m.prazoHoras ? ` (prazo ${m.prazoHoras} h)` : ""}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                Prioridade
                <select name="prioridade" defaultValue="normal">
                  {Object.entries(PRIORIDADE_ROTULO).map(([v, r]) => (
                    <option key={v} value={v}>
                      {r}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Quem pediu
                <select name="origem" defaultValue="manual">
                  <option value="manual">A empresa</option>
                  <option value="cliente">O cliente</option>
                </select>
              </label>
            </div>
            <label>
              Descrição <span className="req">*</span>
              <textarea
                name="descricao"
                rows={4}
                required
                maxLength={4000}
                placeholder="O que o técnico precisa saber antes de sair: o problema, o que levar, com quem falar."
              />
            </label>
            <p className="ajuda">
              O checklist vem do modelo do tipo escolhido — dá para ajustar os modelos em{" "}
              {ator.papel === "adm" ? <Link href="/administracao/modelos">Modelos de OS</Link> : "Modelos de OS (adm)"}.
            </p>
          </fieldset>

          <fieldset>
            <legend>Onde</legend>
            <div className="dupla">
              <label>
                Usina
                <select name="usinaId" defaultValue={usinaEscolhida}>
                  <option value="">Nenhuma (ou ainda não existe)</option>
                  {cliente.usinas.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.nome}
                      {u.cidade ? ` · ${u.cidade}` : ""}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Venda (projeto)
                <select name="projetoId" defaultValue={projetoEscolhido}>
                  <option value="">Nenhuma — não é de uma venda</option>
                  {projetos.map((pr) => (
                    <option key={pr.id} value={pr.id}>
                      {pr.titulo} · {pr.etapa.nome}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <p className="ajuda">
              Ligada à venda, a OS aparece no projeto, as fotos que viram documento entram no dossiê e,
              concluída, a vistoria ou a instalação andam a esteira sozinhas.
            </p>
          </fieldset>

          <fieldset>
            <legend>Quem e quando</legend>
            <div className="dupla">
              <label>
                Responsável
                <select name="responsavelId" defaultValue="">
                  <option value="">Definir depois</option>
                  {pessoas.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.nome} ({PAPEL[u.papel] ?? u.papel})
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Agendar para
                <input type="datetime-local" name="agendadaPara" />
              </label>
            </div>
            <p className="ajuda">Sem data, a OS entra na fila “A agendar” da agenda.</p>
          </fieldset>

          <div className="ficha-acoes">
            <Link href="/os/nova" className="voltar">
              ← trocar de cliente
            </Link>
            <button type="submit">Abrir OS</button>
          </div>
        </form>
      </div>
    </main>
  );
}
