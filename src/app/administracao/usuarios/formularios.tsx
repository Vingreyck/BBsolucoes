"use client";

import { useActionState } from "react";

import { criarUsuario, mudarPapel, reiniciarSenha, type ResultadoUsuario } from "./actions";
import { OPCOES_PAPEL } from "./papeis";

/**
 * A senha provisória aparece uma vez e some no próximo carregamento.
 *
 * De propósito: ela não é guardada em lugar nenhum legível — o banco tem só o
 * hash. Se o adm fechar a tela sem anotar, o caminho é reiniciar e gerar outra,
 * que é mais seguro do que deixar senha em texto parada numa tabela.
 */
function Senha({ estado }: { estado: ResultadoUsuario }) {
  if (!estado.senha) return null;
  return (
    <p className="senha-provisoria">
      Senha de <strong>{estado.nome}</strong>: <code>{estado.senha}</code>
      <span>anote agora — ela não aparece de novo</span>
    </p>
  );
}

export function Criar() {
  const [estado, acao, enviando] = useActionState<ResultadoUsuario, FormData>(
    criarUsuario,
    {},
  );

  return (
    <>
      <form action={acao} className="form-usuario">
        <input name="nome" placeholder="Nome completo" required aria-label="Nome" />
        <input
          name="email"
          type="email"
          placeholder="email@bbsolucoes.com.br"
          required
          aria-label="E-mail"
        />
        <select name="papel" defaultValue="tecnico" aria-label="Papel">
          <option value="adm">Administração</option>
          <option value="vendedor">Vendas</option>
          <option value="engenheiro">Engenharia</option>
          <option value="tecnico">Técnico</option>
          <option value="estoque">Estoque</option>
        </select>
        <input name="telefone" placeholder="telefone (opcional)" aria-label="Telefone" />
        <button type="submit" disabled={enviando}>
          {enviando ? "Criando…" : "Criar conta"}
        </button>
      </form>
      {estado.erro && <p className="erro">{estado.erro}</p>}
      <Senha estado={estado} />
    </>
  );
}

export function Reiniciar({ usuarioId, nome }: { usuarioId: string; nome: string }) {
  const [estado, acao, enviando] = useActionState<ResultadoUsuario, FormData>(
    reiniciarSenha,
    {},
  );

  return (
    <>
      <form action={acao}>
        <input type="hidden" name="usuarioId" value={usuarioId} />
        <button type="submit" disabled={enviando} title={`Nova senha para ${nome}`}>
          {enviando ? "…" : "nova senha"}
        </button>
      </form>
      <Senha estado={estado} />
    </>
  );
}

/** Trocar o papel salva ao escolher — sem botão a mais em cada linha. */
export function SeletorPapel({ usuarioId, papel }: { usuarioId: string; papel: string }) {
  return (
    <form action={mudarPapel}>
      <input type="hidden" name="usuarioId" value={usuarioId} />
      <select
        name="papel"
        defaultValue={papel}
        className="select-compacto"
        aria-label="Papel"
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
      >
        {OPCOES_PAPEL.map(([valor, rotulo]) => (
          <option key={valor} value={valor}>
            {rotulo}
          </option>
        ))}
      </select>
    </form>
  );
}
