import { and, asc, eq, inArray, or, sql, type SQL, type SQLWrapper } from "drizzle-orm";
import { ClipboardList, KanbanSquare, Search, Sun, UserRound } from "lucide-react";

import { exigirUsuario } from "@/auth/sessao";
import { db, schema } from "@/db";
import { atorDaWeb, ehGestaoWeb } from "@/os/acesso";
import { listarOs } from "@/os/consultas";
import { numeroOs, STATUS_ROTULO, TIPO_ROTULO } from "@/os/tipos";

import { Cabecalho } from "../_ui";
import { kWp } from "../formatar";

export const dynamic = "force-dynamic";

/**
 * Busca em tudo: clientes, OS, projetos e usinas, numa tela só.
 *
 * Sem acento e sem maiúscula ("sao cristovao" acha "São Cristóvão"), e com os
 * dígitos soltos ("123456" acha o CPF 123.456.789-09 e o telefone). Documento
 * de cliente fica de fora de propósito: quem pode vê-lo é decidido por tipo, e
 * a busca não vai contornar isso.
 */

const LIMITE = 8;

function semAcento(coluna: SQLWrapper): SQL {
  return sql`translate(lower(coalesce(${coluna}, '')), 'áàâãäéèêëíìîïóòôõöúùûüç', 'aaaaaeeeeiiiiooooouuuuc')`;
}

function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

export default async function Busca({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const usuario = await exigirUsuario();
  const { q = "" } = await searchParams;
  const termo = normalizar(q).slice(0, 80);
  const digitos = q.replace(/\D/g, "");
  const temOs = usuario.papel !== "estoque";

  if (termo.length < 2) {
    return (
      <main>
        <Cabecalho titulo="Busca" meta="Digite pelo menos 2 letras." />
        <div className="busca-vazia">
          <Search size={28} aria-hidden />
          <p>Procure por nome do cliente, número da OS, cidade, CPF/CNPJ, telefone ou nome da usina.</p>
        </div>
      </main>
    );
  }

  const padrao = `%${termo}%`;
  const porDigitos = digitos.length >= 4 ? `%${digitos}%` : null;
  const empresa = usuario.empresaId;

  const [clientes, ordens, projetos, usinas] = await Promise.all([
    db.query.cliente.findMany({
      where: and(
        eq(schema.cliente.empresaId, empresa),
        or(
          sql`${semAcento(schema.cliente.nome)} like ${padrao}`,
          sql`${semAcento(schema.cliente.cidade)} like ${padrao}`,
          porDigitos ? sql`regexp_replace(coalesce(${schema.cliente.cpfCnpj}, ''), '\\D', '', 'g') like ${porDigitos}` : undefined,
          porDigitos ? sql`regexp_replace(coalesce(${schema.cliente.telefone}, ''), '\\D', '', 'g') like ${porDigitos}` : undefined,
        ),
      ),
      columns: { id: true, nome: true, cidade: true, uf: true, telefone: true },
      with: {
        projetos: { columns: { id: true, titulo: true } },
        usinas: { columns: { id: true } },
      },
      orderBy: asc(schema.cliente.nome),
      limit: LIMITE,
    }),
    temOs ? listarOs(atorDaWeb(usuario), { aba: "todas", busca: q }) : Promise.resolve([]),
    (async () => {
      const clientesQueCasam = db
        .select({ id: schema.cliente.id })
        .from(schema.cliente)
        .where(and(eq(schema.cliente.empresaId, empresa), sql`${semAcento(schema.cliente.nome)} like ${padrao}`));
      return db.query.projeto.findMany({
        where: and(
          eq(schema.projeto.empresaId, empresa),
          or(sql`${semAcento(schema.projeto.titulo)} like ${padrao}`, inArray(schema.projeto.clienteId, clientesQueCasam)),
        ),
        columns: { id: true, titulo: true, situacao: true },
        with: { cliente: { columns: { nome: true, cidade: true } }, etapa: { columns: { nome: true } } },
        limit: LIMITE,
      });
    })(),
    db.query.usina.findMany({
      where: and(
        eq(schema.usina.empresaId, empresa),
        or(sql`${semAcento(schema.usina.nome)} like ${padrao}`, sql`${semAcento(schema.usina.cidade)} like ${padrao}`),
      ),
      columns: { id: true, nome: true, cidade: true, potenciaKwp: true, status: true },
      with: { cliente: { columns: { nome: true } } },
      orderBy: asc(schema.usina.nome),
      limit: LIMITE,
    }),
  ]);

  const os = ordens.slice(0, LIMITE);
  const total = clientes.length + os.length + projetos.length + usinas.length;
  const gestao = ehGestaoWeb(usuario.papel);

  return (
    <main>
      <Cabecalho
        titulo={`Resultados para “${q.trim()}”`}
        meta={total === 0 ? "nada encontrado" : `${total} ${total === 1 ? "resultado" : "resultados"}`}
      />

      {total === 0 ? (
        <div className="busca-vazia">
          <Search size={28} aria-hidden />
          <p>
            Nada com “{q.trim()}”. Tente só o primeiro nome, a cidade, ou os números do CPF sem pontos.
          </p>
        </div>
      ) : (
        <div className="busca-grade">
          {clientes.length > 0 && (
            <Grupo titulo="Clientes" icone={<UserRound size={16} />} quantidade={clientes.length}>
              {clientes.map((c) => (
                <li key={c.id} className="resultado">
                  <span className="resultado-corpo">
                    <strong>{c.nome}</strong>
                    <small>
                      {[c.cidade && `${c.cidade}${c.uf ? `/${c.uf}` : ""}`, c.telefone, `${c.usinas.length} usina(s)`]
                        .filter(Boolean)
                        .join(" · ")}
                    </small>
                  </span>
                  <span className="resultado-acoes">
                    {c.projetos.slice(0, 2).map((p) => (
                      <a key={p.id} href={`/projeto/${p.id}`} className="filtro">
                        Projeto
                      </a>
                    ))}
                    <a href={`/os?aba=todas&q=${encodeURIComponent(c.nome)}`} className="filtro">
                      OS
                    </a>
                    {gestao && (
                      <a href={`/os/nova?cliente=${c.id}`} className="filtro">
                        + Nova OS
                      </a>
                    )}
                  </span>
                </li>
              ))}
            </Grupo>
          )}

          {os.length > 0 && (
            <Grupo
              titulo="Ordens de serviço"
              icone={<ClipboardList size={16} />}
              quantidade={ordens.length}
              mais={ordens.length > LIMITE ? `/os?aba=todas&q=${encodeURIComponent(q)}` : undefined}
            >
              {os.map((o) => (
                <li key={o.id}>
                  <a href={`/os/${o.id}`} className="resultado">
                    <span className="linha-os-num">{numeroOs(o.numero)}</span>
                    <span className="resultado-corpo">
                      <strong>{o.cliente?.nome ?? "Sem cliente"}</strong>
                      <small>
                        {TIPO_ROTULO[o.tipo] ?? o.tipo}
                        {o.cliente?.cidade ? ` · ${o.cliente.cidade}` : ""}
                        {o.responsavel ? ` · ${o.responsavel.nome}` : ""}
                      </small>
                    </span>
                    <span className={`pilula st-${o.status}`}>{STATUS_ROTULO[o.status] ?? o.status}</span>
                  </a>
                </li>
              ))}
            </Grupo>
          )}

          {projetos.length > 0 && (
            <Grupo titulo="Projetos" icone={<KanbanSquare size={16} />} quantidade={projetos.length}>
              {projetos.map((p) => (
                <li key={p.id}>
                  <a href={`/projeto/${p.id}`} className="resultado">
                    <span className="resultado-corpo">
                      <strong>{p.cliente?.nome ?? p.titulo}</strong>
                      <small>
                        {p.titulo}
                        {p.cliente?.cidade ? ` · ${p.cliente.cidade}` : ""}
                      </small>
                    </span>
                    <span className="pilula">{p.situacao === "concluido" ? "Concluído" : (p.etapa?.nome ?? "—")}</span>
                  </a>
                </li>
              ))}
            </Grupo>
          )}

          {usinas.length > 0 && (
            <Grupo titulo="Usinas" icone={<Sun size={16} />} quantidade={usinas.length}>
              {usinas.map((u) => (
                <li key={u.id}>
                  <a href={`/usinas?busca=${encodeURIComponent(u.nome)}`} className="resultado">
                    <span className="resultado-corpo">
                      <strong>{u.nome}</strong>
                      <small>
                        {[u.cliente?.nome, u.cidade, kWp(u.potenciaKwp)].filter(Boolean).join(" · ")}
                      </small>
                    </span>
                    <span className="pilula">{u.status === "gerando" ? "Gerando" : u.status === "inativa" ? "Inativa" : "Em implantação"}</span>
                  </a>
                </li>
              ))}
            </Grupo>
          )}
        </div>
      )}
    </main>
  );
}

function Grupo({
  titulo,
  icone,
  quantidade,
  mais,
  children,
}: {
  titulo: string;
  icone: React.ReactNode;
  quantidade: number;
  mais?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="painel">
      <header className="painel-topo">
        <h2 className="titulo-com-icone">
          {icone} {titulo} <span className="contador-cinza">{quantidade}</span>
        </h2>
        {mais && <a href={mais}>Ver todas</a>}
      </header>
      <ul className="lista-limpa">{children}</ul>
    </section>
  );
}
