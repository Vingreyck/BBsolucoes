import { asc, eq } from "drizzle-orm";
import { redirect } from "next/navigation";

import { exigirUsuario } from "@/auth/sessao";
import { db, schema } from "@/db";

import { Criar, Reiniciar } from "./formularios";
import { alternarAtivo } from "./actions";

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
  const genericas = usuarios.filter((u) => u.email.endsWith("@bbsolucoes.local"));

  return (
    <main>
      <header className="topo">
        <h1>Usuários</h1>
        <span className="sub">{usuarios.length} contas</span>
        {provisorias.length > 0 && (
          <span className="alerta">{provisorias.length} com senha provisória</span>
        )}
      </header>

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

      <section className="bloco">
        <h2>Nova conta</h2>
        <p className="nota">
          A senha sai sorteada e aparece <strong>uma vez só</strong> aqui na
          tela. Entregue à pessoa; ela é obrigada a trocar no primeiro acesso, e
          a partir daí ninguém mais sabe a senha dela — que é o que faz o nome
          nos registros valer alguma coisa.
        </p>
        <Criar />
      </section>

      <div className="tabela-wrap">
        <table className="tabela">
          <thead>
            <tr>
              <th>Nome</th>
              <th>E-mail</th>
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
                <td className="fraco">{u.email}</td>
                <td className="fraco">{PAPEL_ROTULO[u.papel] ?? u.papel}</td>
                <td>
                  {u.ativo ? (
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
                  {u.id !== usuario.id && (
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

      <p className="aviso">
        Contas são <strong>desativadas, nunca apagadas</strong>. Apagar levaria
        junto quem enviou cada documento e quem anotou cada número de série — a
        trilha sumiria justamente quando alguém sai da empresa, que é quando ela
        mais importa. Desativado não entra mais e continua nomeado no histórico.
      </p>
    </main>
  );
}
