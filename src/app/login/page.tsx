import { redirect } from "next/navigation";

import { usuarioAtual } from "@/auth/sessao";

import { CampoSenha } from "../_acesso/campo-senha";
import { CascaAcesso } from "../_acesso/casca";
import { entrar } from "./actions";

export const dynamic = "force-dynamic";

const MENSAGENS: Record<string, { texto: string; tom: "erro" | "aviso" }> = {
  credenciais: { texto: "E-mail, CPF ou senha incorretos.", tom: "erro" },
  vazio: { texto: "Preencha o e-mail (ou CPF) e a senha.", tom: "erro" },
  tentativas: {
    texto: "Muitas tentativas seguidas. Espere alguns minutos e tente de novo.",
    tom: "erro",
  },
  pendente: {
    texto: "Seu cadastro ainda está esperando um administrador liberar. Avise a sua coordenação.",
    tom: "aviso",
  },
  desativada: { texto: "Essa conta está desativada. Fale com o administrador.", tom: "erro" },
};

export default async function Login({
  searchParams,
}: {
  searchParams: Promise<{ erro?: string; pedido?: string }>;
}) {
  // Quem já entrou não tem o que fazer aqui.
  if (await usuarioAtual()) redirect("/");

  const { erro, pedido } = await searchParams;
  const mensagem = erro ? (MENSAGENS[erro] ?? MENSAGENS.credenciais) : null;

  return (
    <CascaAcesso
      titulo="Entrar no Selebi"
      subtitulo="Use o seu e-mail ou CPF e a sua senha."
      rodape={
        <span>
          Não tem conta? <a href="/solicitar-acesso">Solicitar acesso</a>
        </span>
      }
    >
      {pedido === "enviado" && !mensagem && (
        <p className="acesso-mensagem aviso" role="status">
          Pedido enviado. Assim que um administrador liberar, você entra por aqui.
        </p>
      )}

      {mensagem && (
        <p className={`acesso-mensagem ${mensagem.tom}`} role="alert">
          {mensagem.texto}
        </p>
      )}

      <form action={entrar} className="acesso-form">
        <label className="entrada">
          <span className="entrada-rotulo">E-mail ou CPF</span>
          <input
            type="text"
            name="email"
            autoComplete="username"
            inputMode="email"
            placeholder="seu e-mail ou CPF"
            required
            autoFocus
            aria-invalid={erro === "credenciais" || undefined}
          />
        </label>

        <label className="entrada">
          <span className="entrada-rotulo">Senha</span>
          <CampoSenha name="senha" autoComplete="current-password" invalido={erro === "credenciais"} />
        </label>

        <button type="submit" className="botao-grande">
          Entrar
        </button>
      </form>

      <details className="acesso-ajuda">
        <summary>Esqueceu a senha?</summary>
        <p>
          Peça ao administrador da sua empresa para gerar uma <strong>senha provisória</strong> em
          Usuários. Você entra com ela e o sistema pede para criar uma senha nova na hora — assim só
          você fica sabendo a sua senha.
        </p>
      </details>
    </CascaAcesso>
  );
}
