import { asc, eq } from "drizzle-orm";
import { Info, Power, RotateCcw, Search, SearchX, UserPlus } from "lucide-react";
import { redirect } from "next/navigation";

import { formatarCpf, ocultarCpf } from "@/auth/cpf";
import { exigirUsuario } from "@/auth/sessao";
import { db, schema } from "@/db";

import { Cabecalho, Cartao, Vazio } from "../../_ui";
import { endereco, paginar, Paginacao } from "../../_ui/paginacao";
import { iniciais, semAcento } from "../../formatar";
import { NovaConta, Reiniciar, SeletorPapel } from "./formularios";
import { OPCOES_PAPEL } from "./papeis";
import { alternarAtivo, aprovarPedido, recusarPedido } from "./actions";

export const dynamic = "force-dynamic";

const PAPEL_ROTULO: Record<string, string> = {
  adm: "Administração",
  vendedor: "Vendas",
  engenheiro: "Engenharia",
  tecnico: "Técnico",
  estoque: "Estoque",
};

/**
 * Contas de quem usa o sistema.
 *
 * Existe por causa de um risco concreto: os cinco usuários que o `db:seed` cria
 * são genéricos — um `tecnico` para todos os técnicos — e compartilham uma
 * senha que está escrita no `SETUP.md`, num repositório **público** no GitHub.
 *
 * Enquanto o Selebi rodava em `localhost` isso era só feio. Com o IP público da
 * VM, vira porta aberta para a CNH, o CPF e o contrato de 166 pessoas.
 *
 * O desenho segue as outras listas: uma linha por pessoa com o que identifica
 * (nome e e-mail) à esquerda, o estado em etiqueta e as ações em ícone no fim.
 * Criar conta e gerar senha abrem uma janelinha, que é onde a senha sorteada
 * aparece, uma vez só.
 */
export default async function Usuarios({
  searchParams,
}: {
  searchParams: Promise<{ busca?: string; ver?: string; pagina?: string }>;
}) {
  const usuario = await exigirUsuario();
  if (usuario.papel !== "adm") redirect("/sem-acesso");
  const { busca = "", ver = "", pagina: paginaPedida } = await searchParams;

  const usuarios = await db.query.usuario.findMany({
    where: eq(schema.usuario.empresaId, usuario.empresaId),
    orderBy: asc(schema.usuario.nome),
  });

  const aprovados = usuarios.filter((u) => u.aprovadoEm);
  const ativos = aprovados.filter((u) => u.ativo);
  const desativados = aprovados.filter((u) => !u.ativo);
  const provisorias = ativos.filter((u) => u.deveTrocarSenha);
  const genericas = ativos.filter((u) => u.email?.endsWith("@bbsolucoes.local"));
  const pendentes = usuarios.filter((u) => !u.aprovadoEm);

  const alvo = semAcento(busca.trim());
  const doFiltro = aprovados.filter((u) => {
    if (alvo && !semAcento(`${u.nome} ${u.email ?? ""}`).includes(alvo)) return false;
    if (ver === "ativos") return u.ativo;
    if (ver === "desativados") return !u.ativo;
    if (ver === "provisoria") return u.ativo && u.deveTrocarSenha;
    return true;
  });
  const pagina = paginar(doFiltro, paginaPedida);
  const atuais = { busca, ver };

  return (
    <main>
      <Cabecalho
        titulo="Usuários"
        selos={
          <>
            {pendentes.length > 0 && (
              <span className="pilula sev-atencao">
                {pendentes.length} {pendentes.length === 1 ? "pedido" : "pedidos"} de acesso
              </span>
            )}
            {provisorias.length > 0 && (
              <span className="pilula sev-critico">{provisorias.length} com senha provisória</span>
            )}
          </>
        }
        meta={
          <>
            <span>{ativos.length} ativas</span>
            {desativados.length > 0 && <span>{desativados.length} desativadas</span>}
          </>
        }
        acoes={<NovaConta />}
      />

      <div className="pagina-corpo pilha">
        {genericas.length > 0 && (
          <p className="aviso aviso-solto">
            <strong>
              {genericas.length} {genericas.length === 1 ? "conta ainda é genérica" : "contas ainda são as genéricas"} do
              seed
            </strong>{" "}
            — <code>tecnico@</code>, <code>vendas@</code> e as outras. A senha delas está publicada no repositório, que é
            público. Crie uma conta para cada pessoa e desative estas: enquanto existirem, os registros de quem baixou
            documento e de quem anotou serial não identificam ninguém.
          </p>
        )}

        {pendentes.length > 0 && (
          <Cartao titulo="Pedidos de acesso" icone={<UserPlus size={16} />} contador={pendentes.length} destaque>
            <p className="nota">
              Quem pediu acesso pelo app ou pelo site. Confira se a pessoa é mesmo da equipe, escolha o papel dela e
              libere. Recusar apaga o pedido.
            </p>
            <ul className="pedidos">
              {pendentes.map((u) => (
                <li key={u.id} className="pedido">
                  <span className="avatar-mini" aria-hidden>
                    {iniciais(u.nome)}
                  </span>
                  <div className="pedido-quem">
                    <strong>{u.nome}</strong>
                    <small>
                      {u.cpf ? `CPF ${formatarCpf(u.cpf)}` : "sem CPF"}
                      {u.email ? ` · ${u.email}` : ""}
                      {" · pediu em "}
                      {u.criadoEm.toLocaleDateString("pt-BR", { timeZone: "America/Maceio" })}
                    </small>
                  </div>
                  <form action={aprovarPedido} className="pedido-aprovar">
                    <input type="hidden" name="usuarioId" value={u.id} />
                    <select name="papel" defaultValue="tecnico" aria-label={`Papel de ${u.nome}`}>
                      {OPCOES_PAPEL.map(([valor, rotulo]) => (
                        <option key={valor} value={valor}>
                          {rotulo}
                        </option>
                      ))}
                    </select>
                    <button type="submit" className="botao">
                      Aprovar
                    </button>
                  </form>
                  <form action={recusarPedido}>
                    <input type="hidden" name="usuarioId" value={u.id} />
                    <button type="submit" className="botao secundario">
                      Recusar
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          </Cartao>
        )}

        <section className="lista" id="lista" aria-label="Contas">
          <div className="lista-barra">
            <form className="campo-busca" action="/administracao/usuarios">
              <Search size={15} aria-hidden />
              <input type="search" name="busca" placeholder="Nome ou e-mail" defaultValue={busca} aria-label="Buscar conta" />
              {ver && <input type="hidden" name="ver" value={ver} />}
            </form>
            <nav className="filtros" aria-label="Situação">
              {[
                ["", "Todas", aprovados.length],
                ["ativos", "Ativas", ativos.length],
                ["provisoria", "Senha provisória", provisorias.length],
                ["desativados", "Desativadas", desativados.length],
              ].map(([valor, rotulo, n]) => (
                <a
                  key={valor}
                  href={endereco("/administracao/usuarios", atuais, { ver: valor as string, pagina: null })}
                  className={`filtro${ver === valor ? " ativo" : ""}${valor === "provisoria" ? " perigo" : ""}`}
                  aria-current={ver === valor ? "page" : undefined}
                >
                  {rotulo} <span className="filtro-n">{n}</span>
                </a>
              ))}
            </nav>
          </div>

          {doFiltro.length === 0 ? (
            <Vazio
              icone={<SearchX size={20} />}
              titulo="Nenhuma conta com esse filtro"
              acao={
                <a href="/administracao/usuarios" className="botao secundario">
                  Limpar filtros
                </a>
              }
            />
          ) : (
            <>
              <div className="tabela-rolagem">
                <table className="tabela tabela-usuarios">
                  <thead>
                    <tr>
                      <th scope="col">Pessoa</th>
                      <th scope="col">Papel</th>
                      <th scope="col">Situação</th>
                      <th scope="col">Senha</th>
                      <th scope="col" className="col-acao">
                        <span className="sr-only">Ações</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {pagina.itens.map((u) => {
                      const eu = u.id === usuario.id;
                      // Conta excluída pela própria pessoa (sem CPF nem e-mail) não tem quem reative.
                      const podeAlternar = !eu && (u.cpf || u.email);
                      return (
                        <tr key={u.id} className={u.ativo ? undefined : "linha-esmaecida"}>
                          <td>
                            <span className="pessoa-linha">
                              <span className="avatar-mini avatar-medio" aria-hidden>
                                {iniciais(u.nome)}
                              </span>
                              <span className="celula-dupla">
                                <strong>
                                  {u.nome}
                                  {eu && <span className="voce"> · você</span>}
                                </strong>
                                <small>{u.email ?? (u.cpf ? `CPF ${ocultarCpf(u.cpf)}` : "—")}</small>
                              </span>
                            </span>
                          </td>
                          <td>
                            {eu || !u.ativo ? (
                              <span className="papel-texto">{PAPEL_ROTULO[u.papel] ?? u.papel}</span>
                            ) : (
                              <SeletorPapel usuarioId={u.id} papel={u.papel} />
                            )}
                          </td>
                          <td>
                            {u.ativo ? (
                              <span className="status-ok">
                                <span aria-hidden /> ativa
                              </span>
                            ) : (
                              <span className="status-parado">
                                <span aria-hidden /> desativada
                              </span>
                            )}
                          </td>
                          <td>
                            {u.deveTrocarSenha ? (
                              <span className="pilula sev-atencao" title="Ainda não trocou a senha que recebeu">
                                provisória
                              </span>
                            ) : (
                              <span className="fraco">própria</span>
                            )}
                          </td>
                          <td className="col-acao">
                            <span className="acoes-linha">
                              {u.ativo && <Reiniciar usuarioId={u.id} nome={u.nome} />}
                              {podeAlternar && (
                                <form action={alternarAtivo.bind(null, u.id)}>
                                  <button
                                    type="submit"
                                    className={`botao-icone${u.ativo ? " perigo" : ""}`}
                                    title={u.ativo ? `Desativar ${u.nome}` : `Reativar ${u.nome}`}
                                    aria-label={u.ativo ? `Desativar ${u.nome}` : `Reativar ${u.nome}`}
                                  >
                                    {u.ativo ? <Power size={15} aria-hidden /> : <RotateCcw size={15} aria-hidden />}
                                  </button>
                                </form>
                              )}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <Paginacao {...pagina} rotulo="contas" href={(n) => endereco("/administracao/usuarios", atuais, { pagina: n })} />
            </>
          )}
        </section>

        <details className="como-ler como-ler-solto">
          <summary>
            <Info size={15} aria-hidden /> Por que as contas não são apagadas
          </summary>
          <div>
            <p>
              Contas são <strong>desativadas, nunca apagadas</strong>. Apagar levaria junto quem enviou cada documento e
              quem anotou cada número de série — a trilha sumiria justamente quando alguém sai da empresa, que é quando
              ela mais importa. Desativada não entra mais e continua nomeada no histórico.
            </p>
          </div>
        </details>
      </div>
    </main>
  );
}
