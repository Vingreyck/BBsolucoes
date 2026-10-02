import { and, count, eq, isNull, ne } from "drizzle-orm";
import type { Metadata } from "next";
import { Inter } from "next/font/google";

import { podeVerDocumentos } from "@/auth/permissao";
import { usuarioAtual } from "@/auth/sessao";
import { db, schema } from "@/db";
import { ehGestaoWeb } from "@/os/acesso";

import { BarraLateral, type GrupoMenu } from "./barra-lateral";
import { BarraSuperior } from "./barra-superior";
import { CHAVE_MENU } from "./menu";
import "./globals.css";

/**
 * Inter, a fonte dos hubs: números com a mesma largura (tabular) e boa leitura
 * em tamanho pequeno, que é onde vivem tabelas e etiquetas. Vem baixada no
 * build e servida pelo próprio site — o navegador não fala com o Google.
 */
const fonte = Inter({ subsets: ["latin"], display: "swap", variable: "--fonte" });

export const metadata: Metadata = {
  title: "Selebi",
  description: "Cadastro, esteira, ordens de serviço e monitoramento solar",
};

const PAPEL_ROTULO: Record<string, string> = {
  adm: "Administrador",
  vendedor: "Vendedor",
  engenheiro: "Engenheiro",
  tecnico: "Técnico",
  estoque: "Estoque",
};

async function alertasAbertos(empresaId: string): Promise<number> {
  const [linha] = await db
    .select({ n: count() })
    .from(schema.alerta)
    .where(and(eq(schema.alerta.empresaId, empresaId), ne(schema.alerta.status, "resolvido")));
  return Number(linha?.n ?? 0);
}

/** Pedidos de acesso esperando o administrador — o número ao lado de Usuários. */
async function pedidosPendentes(empresaId: string): Promise<number> {
  const [linha] = await db
    .select({ n: count() })
    .from(schema.usuario)
    .where(and(eq(schema.usuario.empresaId, empresaId), isNull(schema.usuario.aprovadoEm)));
  return Number(linha?.n ?? 0);
}

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const usuario = await usuarioAtual();

  // Sem sessão não há menu: login e páginas públicas ficam limpas.
  if (!usuario) {
    return (
      <html lang="pt-BR" className={fonte.variable}>
        <body>{children}</body>
      </html>
    );
  }

  const [temDocumentos, alertas, pedidos] = await Promise.all([
    podeVerDocumentos(usuario.empresaId, usuario.papel),
    alertasAbertos(usuario.empresaId),
    usuario.papel === "adm" ? pedidosPendentes(usuario.empresaId) : Promise.resolve(0),
  ]);
  const gestao = ehGestaoWeb(usuario.papel);
  const temOs = usuario.papel !== "estoque";

  // Esconder o link é cortesia; quem barra é a própria página.
  const grupos: GrupoMenu[] = [
    { itens: [{ href: "/", rotulo: "Início", icone: "inicio" }] },
    {
      titulo: "Comercial",
      itens: [
        { href: "/esteira", rotulo: "Esteira de projetos", icone: "esteira" },
        ...(temDocumentos ? [{ href: "/documentos", rotulo: "Documentos", icone: "documentos" as const }] : []),
      ],
    },
    ...(temOs
      ? [
          {
            titulo: "Operação",
            itens: [
              { href: "/os", rotulo: "Ordens de serviço", icone: "os" as const },
              { href: "/os/agenda", rotulo: "Agenda", icone: "agenda" as const },
              ...(gestao ? [{ href: "/os/acompanhamento", rotulo: "Em campo", icone: "campo" as const }] : []),
            ],
          },
        ]
      : []),
    {
      titulo: "Monitoramento",
      itens: [
        { href: "/usinas", rotulo: "Usinas", icone: "usinas" },
        { href: "/alertas", rotulo: "Alertas", icone: "alertas", contador: alertas },
        { href: "/usinas/sem-dono", rotulo: "Sem dono", icone: "semDono" },
        { href: "/coleta", rotulo: "Coleta", icone: "coleta" },
        { href: "/cadastro", rotulo: "Nova usina", icone: "novaUsina" },
      ],
    },
    ...(usuario.papel === "adm"
      ? [
          {
            titulo: "Administração",
            itens: [
              { href: "/administracao/usuarios", rotulo: "Usuários", icone: "usuarios" as const, contador: pedidos },
              { href: "/administracao/modelos", rotulo: "Modelos de OS", icone: "modelos" as const },
            ],
          },
        ]
      : []),
  ];

  return (
    <html lang="pt-BR" className={fonte.variable} suppressHydrationWarning>
      <head>
        {/* Antes de pintar: aplica o menu recolhido, se a pessoa deixou assim. Sem isto
            a tela abriria com o menu largo e encolheria logo depois, piscando. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{if(localStorage.getItem("${CHAVE_MENU}")==="recolhido")document.documentElement.dataset.menu="recolhido"}catch(e){}`,
          }}
        />
      </head>
      <body>
        <div className="casca">
          <BarraLateral
            grupos={grupos}
            usuario={{ nome: usuario.nome, papel: PAPEL_ROTULO[usuario.papel] ?? usuario.papel }}
          />
          <div className="conteudo">
            <BarraSuperior podeCriarOs={gestao} podeCriarProjeto />
            {children}
          </div>
        </div>
      </body>
    </html>
  );
}
