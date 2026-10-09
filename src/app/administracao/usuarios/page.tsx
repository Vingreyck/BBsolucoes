import { asc, eq } from "drizzle-orm";
import { Info, KeyRound, UserPlus } from "lucide-react";
import { redirect } from "next/navigation";

import { formatarCpf, ocultarCpf } from "@/auth/cpf";
import { exigirUsuario } from "@/auth/sessao";
import { db, schema } from "@/db";

import { Cabecalho, Cartao } from "../../_ui";
import { Criar, Reiniciar, SeletorPapel } from "./formularios";
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
 */
export default async function Usuarios() {
  const usuario = await exigirUsuario();
  if (usuario.papel !== "adm") redirect("/sem-acesso");

  const usuarios = await db.query.usuario.findMany({
    where: eq(schema.usuario.empresaId, usuario.empresaId),
    orderBy: asc(schema.usuario.nome),
  });

  const provisorias = usuarios.filter((u) => u.deveTrocarSenha && u.ativo);
  const genericas = usuarios.filter((u) => u.email?.endsWith("@bbsolucoes.local"));
  const pendentes = usuarios.filter((u) => !u.aprovadoEm);

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
        meta={<span>{usuarios.length} contas</span>}
      />

      {genericas.length > 0 && (
        <p className="aviso">
          <strong>
            {genericas.length} contas ainda são as genéricas do seed
          </strong>{" "}
          — <code>tecnico@</code>, <code>vendas@</code> e as outras. A senha
          delas está publicada no repositório, que é público. Crie uma conta
          para cada pessoa e depois desative estas. Enquanto elas existirem, os
          registros de quem baixou documento e de quem anotou serial não
          identificam ninguém.
        </p>
      )}

      {pendentes.length > 0 && (
        <div className="pagina-corpo pagina-corpo-topo">
        <Cartao titulo="Pedidos de acesso" icone={<UserPlus size={16} />} contador={pendentes.length} destaque>
          <p className="nota">
            Quem pediu acesso pelo app ou pelo site. Confira se a pessoa é mesmo da equipe, escolha o
            papel dela e libere. Recusar apaga o pedido.
          </p>
          <ul className="pedidos">
            {pendentes.map((u) => (
              <li key={u.id} className="pedido">
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
        </div>
      )}

      <div className="pagina-corpo pagina-corpo-topo">
      <Cartao titulo="Nova conta" icone={<KeyRound size={16} />}>
        <p className="nota">
          A senha sai sorteada e aparece <strong>uma vez só</strong> aqui na
          tela. Entregue à pessoa; ela é obrigada a trocar no primeiro acesso, e
          a partir daí ninguém mais sabe a senha dela — que é o que faz o nome
          nos registros valer alguma coisa.
        </p>
        <Criar />
      </Cartao>
      </div>

      <div className="tabela-wrap">
        <table className="tabela">
          <thead>
            <tr>
              <th>Nome</th>
              <th>E-mail ou CPF</th>
              <th>Papel</th>
              <th>Situação</th>
              <th>Senha</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {usuarios.map((u) => (
              <tr key={u.id}>
                <td className="forte">{u.nome}</td>
                <td className="fraco">
                  {u.email ?? (u.cpf ? `CPF ${ocultarCpf(u.cpf)}` : "—")}
                </td>
                <td className="fraco">
                  {u.aprovadoEm && u.id !== usuario.id ? (
                    <SeletorPapel usuarioId={u.id} papel={u.papel} />
                  ) : (
                    (PAPEL_ROTULO[u.papel] ?? u.papel)
                  )}
                </td>
                <td>
                  {!u.aprovadoEm ? (
                    <span className="pilula sev-atencao">aguardando aprovação</span>
                  ) : u.ativo ? (
                    <span className="pilula sev-info">ativo</span>
                  ) : (
                    <span className="pilula sev-atencao">desativado</span>
                  )}
                </td>
                <td>
                  {u.deveTrocarSenha ? (
                    <span className="pilula sev-critico">provisória</span>
                  ) : (
                    <span className="fraco">própria</span>
                  )}
                </td>
                <td className="acoes-usuario">
                  <Reiniciar usuarioId={u.id} nome={u.nome} />
                  {/* Conta excluída pela própria pessoa (sem CPF nem e-mail) não tem quem reative. */}
                  {u.id !== usuario.id && u.aprovadoEm && (u.cpf || u.email) && (
                    <form action={alternarAtivo.bind(null, u.id)}>
                      <button type="submit">
                        {u.ativo ? "desativar" : "reativar"}
                      </button>
                    </form>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <details className="como-ler">
        <summary>
          <Info size={15} aria-hidden /> Por que as contas não são apagadas
        </summary>
        <div>
          <p>
            Contas são <strong>desativadas, nunca apagadas</strong>. Apagar levaria junto quem enviou cada documento e quem
            anotou cada número de série — a trilha sumiria justamente quando alguém sai da empresa, que é quando ela mais
            importa. Desativado não entra mais e continua nomeado no histórico.
          </p>
        </div>
      </details>
    </main>
  );
}
