import { and, asc, eq, or, sql } from "drizzle-orm";
import {
  ArrowLeft,
  CalendarClock,
  Check,
  ChevronRight,
  MapPin,
  Search,
  SearchX,
  UserRound,
  Wrench,
} from "lucide-react";
import Link from "next/link";

import { db, schema } from "@/db";
import { exigirGestaoWeb } from "@/os/acesso";
import { responsaveisPossiveis } from "@/os/consultas";
import { garantirModelos } from "@/os/modelos";
import { PRIORIDADE_ROTULO, TIPO_ROTULO } from "@/os/tipos";

import { Cabecalho, Caminho, Cartao, Dados, Vazio } from "../../_ui";
import { criarOsAction } from "../actions";

export const dynamic = "force-dynamic";

/** A etapa em que o projeto está sugere o tipo da OS. */
const TIPO_DA_ETAPA: Record<string, string> = {
  vistoria_tecnica: "vistoria",
  execucao: "instalacao",
};

/** Os dois passos do assistente. */
const PASSOS = [
  { id: "cliente", nome: "Cliente" },
  { id: "dados", nome: "Dados da OS" },
];

function iniciais(nome: string): string {
  const p = nome.trim().split(/\s+/);
  return ((p[0]?.[0] ?? "") + (p.length > 1 ? p[p.length - 1][0] : "")).toUpperCase();
}

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
        <Cabecalho trilha={[{ href: "/os", rotulo: "Ordens de serviço" }]} titulo="Nova ordem de serviço" />
        <div className="faixa-caminho">
          <Caminho etapas={PASSOS} atual={0} rotuloAtual="passo atual" />
        </div>

        <div className="pagina-estreita">
          <Cartao titulo="Para qual cliente?" icone={<UserRound size={16} />}>
            <form method="get" action="/os/nova" className="busca-grande">
              <label className="campo-busca">
                <Search size={16} aria-hidden />
                <input
                  type="search"
                  name="q"
                  defaultValue={busca}
                  placeholder="Nome, cidade ou CPF/CNPJ do cliente"
                  autoFocus
                  aria-label="Buscar cliente"
                />
              </label>
              <button type="submit" className="botao">
                Buscar
              </button>
            </form>

            {busca && achados.length === 0 && (
              <Vazio icone={<SearchX size={20} />} titulo={`Nenhum cliente encontrado para “${busca}”`}>
                Tente só o primeiro nome, a cidade, ou os números do CPF sem pontos.
              </Vazio>
            )}

            {achados.length > 0 && (
              <ul className="lista-escolha-nova">
                {achados.map((c) => (
                  <li key={c.id}>
                    <Link href={`/os/nova?cliente=${c.id}`}>
                      <span className="avatar-mini" aria-hidden>
                        {iniciais(c.nome)}
                      </span>
                      <span className="celula-dupla">
                        <strong>{c.nome}</strong>
                        <small>{[c.cidade, c.uf].filter(Boolean).join(" - ") || "cidade não informada"}</small>
                      </span>
                      <ChevronRight size={16} aria-hidden />
                    </Link>
                  </li>
                ))}
              </ul>
            )}

            {!busca && (
              <p className="nota">
                Também dá para abrir uma OS direto da tela do projeto, já com a venda ligada, ou de um{" "}
                <Link href="/alertas">alerta de usina</Link>.
              </p>
            )}
          </Cartao>
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

  const cidade = [cliente.cidade, cliente.uf].filter(Boolean).join(" - ");

  return (
    <main>
      <Cabecalho
        trilha={[{ href: "/os", rotulo: "Ordens de serviço" }]}
        titulo="Nova ordem de serviço"
        meta={
          <span className="meta-pessoa">
            <UserRound size={14} aria-hidden /> {cliente.nome}
          </span>
        }
      />
      <div className="faixa-caminho">
        <Caminho etapas={PASSOS} atual={1} rotuloAtual="passo atual" />
      </div>

      {p.erro && (
        <p className="aviso erro" role="alert">
          {p.erro}
        </p>
      )}

      <form action={criarOsAction} className="registro-grade">
        <input type="hidden" name="clienteId" value={cliente.id} />

        <div className="registro-principal">
          <Cartao titulo="O que fazer" icone={<Wrench size={16} />}>
            <div className="form-ficha">
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
            </div>
          </Cartao>

          <Cartao titulo="Onde" icone={<MapPin size={16} />}>
            <div className="form-ficha">
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
                Ligada à venda, a OS aparece no projeto, as fotos que viram documento entram no dossiê e, concluída, a
                vistoria ou a instalação andam a esteira sozinhas.
              </p>
            </div>
          </Cartao>

          <Cartao titulo="Quem e quando" icone={<CalendarClock size={16} />}>
            <div className="form-ficha">
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
            </div>
          </Cartao>

          <div className="barra-enviar">
            <Link href="/os/nova" className="botao secundario">
              <ArrowLeft size={15} aria-hidden /> Trocar de cliente
            </Link>
            <button type="submit" className="botao">
              <Check size={15} aria-hidden /> Abrir OS
            </button>
          </div>
        </div>

        <aside className="registro-lateral">
          <Cartao titulo="Cliente" icone={<UserRound size={16} />}>
            <Dados
              itens={[
                ["Nome", cliente.nome],
                ["Cidade", cidade],
                ["Telefone", cliente.telefone],
                ["Usinas", cliente.usinas.length ? String(cliente.usinas.length) : null],
                ["Vendas em aberto", projetos.length ? String(projetos.length) : null],
              ]}
            />
          </Cartao>
        </aside>
      </form>
    </main>
  );
}
