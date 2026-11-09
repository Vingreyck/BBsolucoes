"use client";

import { Check, Copy, KeyRound, UserPlus, X } from "lucide-react";
import { useActionState, useEffect, useState } from "react";

import { criarUsuario, mudarPapel, reiniciarSenha, type ResultadoUsuario } from "./actions";
import { OPCOES_PAPEL } from "./papeis";

/**
 * A senha provisória aparece uma vez e some no próximo carregamento.
 *
 * De propósito: ela não é guardada em lugar nenhum legível — o banco tem só o
 * hash. Se o adm fechar a janela sem anotar, o caminho é gerar outra, que é
 * mais seguro do que deixar senha em texto parada numa tabela.
 */
function Senha({ estado }: { estado: ResultadoUsuario }) {
  const [copiada, setCopiada] = useState(false);
  if (!estado.senha) return null;
  return (
    <div className="senha-gerada" role="status">
      <span className="senha-gerada-rotulo">Senha provisória de {estado.nome}</span>
      <div className="senha-gerada-linha">
        <code>{estado.senha}</code>
        <button
          type="button"
          className="botao secundario"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(estado.senha!);
              setCopiada(true);
            } catch {
              // sem permissão de área de transferência: a senha continua na tela para copiar à mão
            }
          }}
        >
          {copiada ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />} {copiada ? "Copiada" : "Copiar"}
        </button>
      </div>
      <small>Anote agora e entregue à pessoa: esta senha não aparece de novo. No primeiro acesso ela troca pela dela.</small>
    </div>
  );
}

/** Fecha a janelinha com Esc. */
function useEsc(aberto: boolean, fechar: () => void) {
  useEffect(() => {
    if (!aberto) return;
    const aoTeclar = (e: KeyboardEvent) => e.key === "Escape" && fechar();
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, [aberto, fechar]);
}

/** O botão "Nova conta" do cabeçalho e a janelinha com o formulário. */
export function NovaConta() {
  const [aberto, setAberto] = useState(false);
  // A cada abertura, um formulário novo: a senha da conta anterior não reaparece.
  const [vez, setVez] = useState(0);
  const fechar = () => setAberto(false);
  useEsc(aberto, fechar);

  return (
    <>
      <button
        type="button"
        className="botao"
        onClick={() => {
          setVez((v) => v + 1);
          setAberto(true);
        }}
      >
        <UserPlus size={15} aria-hidden /> Nova conta
      </button>
      {aberto && (
        <div className="dialogo-fundo" onClick={fechar}>
          <div className="dialogo" role="dialog" aria-modal="true" aria-labelledby="nova-conta-titulo" onClick={(e) => e.stopPropagation()}>
            <header className="dialogo-topo">
              <span className="dialogo-icone" aria-hidden>
                <UserPlus size={18} />
              </span>
              <div>
                <h2 id="nova-conta-titulo">Nova conta</h2>
                <p>A senha sai sorteada e aparece uma vez só.</p>
              </div>
              <button type="button" className="botao-icone" onClick={fechar} aria-label="Fechar">
                <X size={16} aria-hidden />
              </button>
            </header>
            <FormularioConta key={vez} />
          </div>
        </div>
      )}
    </>
  );
}

function FormularioConta() {
  const [estado, acao, enviando] = useActionState<ResultadoUsuario, FormData>(criarUsuario, {});
  if (estado.senha) return <Senha estado={estado} />;
  return (
    <form action={acao} className="form-conta">
      <label className="entrada">
        <span className="entrada-rotulo">Nome completo</span>
        <input name="nome" required autoFocus autoComplete="off" />
      </label>
      <label className="entrada">
        <span className="entrada-rotulo">E-mail</span>
        <input name="email" type="email" placeholder="nome@bbsolucoes.com.br" required autoComplete="off" />
      </label>
      <div className="entrada-dupla">
        <label className="entrada">
          <span className="entrada-rotulo">Papel</span>
          <select name="papel" defaultValue="tecnico">
            {OPCOES_PAPEL.map(([valor, rotulo]) => (
              <option key={valor} value={valor}>
                {rotulo}
              </option>
            ))}
          </select>
        </label>
        <label className="entrada">
          <span className="entrada-rotulo">
            Telefone <span className="entrada-opcional">(opcional)</span>
          </span>
          <input name="telefone" inputMode="tel" placeholder="(79) 99999-1234" />
        </label>
      </div>
      {estado.erro && (
        <p className="dialogo-erro" role="alert">
          {estado.erro}
        </p>
      )}
      <div className="dialogo-acoes">
        <button type="submit" className="botao" disabled={enviando}>
          {enviando ? "Criando…" : "Criar conta"}
        </button>
      </div>
    </form>
  );
}

/**
 * Gerar senha nova: pergunta antes (a senha atual deixa de valer e a pessoa
 * sai de todos os aparelhos) e mostra a nova na mesma janelinha.
 */
export function Reiniciar({ usuarioId, nome }: { usuarioId: string; nome: string }) {
  const [aberto, setAberto] = useState(false);
  const [vez, setVez] = useState(0);
  const fechar = () => setAberto(false);
  useEsc(aberto, fechar);

  return (
    <>
      <button
        type="button"
        className="botao-icone"
        title={`Gerar senha nova para ${nome}`}
        aria-label={`Gerar senha nova para ${nome}`}
        onClick={() => {
          setVez((v) => v + 1);
          setAberto(true);
        }}
      >
        <KeyRound size={15} aria-hidden />
      </button>
      {aberto && (
        <div className="dialogo-fundo" onClick={fechar}>
          <div className="dialogo" role="dialog" aria-modal="true" aria-labelledby={`senha-${usuarioId}`} onClick={(e) => e.stopPropagation()}>
            <header className="dialogo-topo">
              <span className="dialogo-icone" aria-hidden>
                <KeyRound size={18} />
              </span>
              <div>
                <h2 id={`senha-${usuarioId}`}>Senha nova</h2>
                <p>{nome}</p>
              </div>
              <button type="button" className="botao-icone" onClick={fechar} aria-label="Fechar">
                <X size={16} aria-hidden />
              </button>
            </header>
            <ConfirmarSenha key={vez} usuarioId={usuarioId} fechar={fechar} />
          </div>
        </div>
      )}
    </>
  );
}

function ConfirmarSenha({ usuarioId, fechar }: { usuarioId: string; fechar: () => void }) {
  const [estado, acao, enviando] = useActionState<ResultadoUsuario, FormData>(reiniciarSenha, {});
  if (estado.senha) return <Senha estado={estado} />;
  return (
    <form action={acao} className="form-conta">
      <input type="hidden" name="usuarioId" value={usuarioId} />
      <p className="dialogo-texto">
        A senha atual deixa de valer agora e a pessoa sai do sistema em todos os aparelhos. Ela entra com a senha nova e
        escolhe a dela no primeiro acesso.
      </p>
      {estado.erro && (
        <p className="dialogo-erro" role="alert">
          {estado.erro}
        </p>
      )}
      <div className="dialogo-acoes">
        <button type="button" className="botao secundario" onClick={fechar} disabled={enviando}>
          Cancelar
        </button>
        <button type="submit" className="botao" disabled={enviando}>
          {enviando ? "Gerando…" : "Gerar senha nova"}
        </button>
      </div>
    </form>
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
        className="select-discreto"
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
