import type { Metadata } from "next";

import { usuarioAtual } from "@/auth/sessao";

import { sair } from "./login/actions";
import "./globals.css";

export const metadata: Metadata = {
  title: "BB Soluções",
  description: "Esteira de projetos, ordens de serviço e monitoramento",
};

const PAPEL_ROTULO: Record<string, string> = {
  adm: "ADM",
  vendedor: "Vendedor",
  engenheiro: "Engenheiro",
  tecnico: "Técnico",
  estoque: "Estoque",
};

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const usuario = await usuarioAtual();

  return (
    <html lang="pt-BR">
      <body>
        {/* Sem sessão não há navegação: a tela de login fica limpa. */}
        {usuario && (
          <nav className="nav">
            <span className="marca">BB Soluções</span>
            <a href="/">Esteira</a>
            <a href="/usinas">Usinas</a>
            <a href="/cadastro">Nova usina</a>
            <a href="/alertas">Alertas</a>
            <a href="/os">OS</a>
            <span className="quem">
              {usuario.nome}
              <span className="papel">{PAPEL_ROTULO[usuario.papel] ?? usuario.papel}</span>
            </span>
            <form action={sair}>
              <button type="submit" className="sair">
                Sair
              </button>
            </form>
          </nav>
        )}
        {children}
      </body>
    </html>
  );
}
