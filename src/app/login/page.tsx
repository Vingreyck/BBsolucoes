import { redirect } from "next/navigation";

import { usuarioAtual } from "@/auth/sessao";

import { entrar } from "./actions";

export const dynamic = "force-dynamic";

const MENSAGENS: Record<string, string> = {
  credenciais: "E-mail ou senha incorretos.",
  vazio: "Preencha e-mail e senha.",
};

export default async function Login({
  searchParams,
}: {
  searchParams: Promise<{ erro?: string }>;
}) {
  // Quem já entrou não tem o que fazer aqui.
  if (await usuarioAtual()) redirect("/");

  const { erro } = await searchParams;
  const mensagem = erro ? (MENSAGENS[erro] ?? MENSAGENS.credenciais) : null;

  return (
    <main className="login">
      <div className="cartao-login">
        <h1>BB Soluções</h1>
        <p className="dica">Entre com seu e-mail e senha.</p>

        <form action={entrar} className="form-login">
          <label>
            E-mail
            <input
              type="email"
              name="email"
              autoComplete="username"
              required
              autoFocus
            />
          </label>
          <label>
            Senha
            <input
              type="password"
              name="senha"
              autoComplete="current-password"
              required
            />
          </label>

          {mensagem && (
            <p className="erro" role="alert">
              {mensagem}
            </p>
          )}

          <button type="submit">Entrar</button>
        </form>
      </div>
    </main>
  );
}
