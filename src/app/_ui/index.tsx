import { Check, ChevronRight, CircleHelp } from "lucide-react";
import Link from "next/link";

/**
 * As peças de tela que se repetem — cabeçalho, cartão, estado vazio, caminho
 * de etapas. Ficam aqui para todas as telas terem a mesma cara sem cada uma
 * reinventar o seu cabeçalho.
 *
 * O desenho segue o que os sistemas grandes convergiram: página de registro em
 * duas colunas (HubSpot, Attio), barra de etapas com o que fazer agora
 * (o "Path" do Salesforce), e explicação longa recolhida até alguém pedir.
 */

export interface Elo {
  href: string;
  rotulo: string;
}

/** Cabeçalho de página: de onde veio, o que é, em que pé está e o que dá para fazer. */
export function Cabecalho({
  trilha,
  titulo,
  selos,
  meta,
  acoes,
}: {
  trilha?: Elo[];
  titulo: React.ReactNode;
  selos?: React.ReactNode;
  meta?: React.ReactNode;
  acoes?: React.ReactNode;
}) {
  return (
    <header className="cabecalho">
      {trilha && trilha.length > 0 && (
        <nav className="ui-trilha" aria-label="Você está em">
          {trilha.map((e) => (
            <span key={e.href}>
              <Link href={e.href}>{e.rotulo}</Link>
              <ChevronRight size={13} aria-hidden />
            </span>
          ))}
        </nav>
      )}
      <div className="cabecalho-linha">
        <div className="cabecalho-texto">
          <div className="cabecalho-titulo">
            <h1>{titulo}</h1>
            {selos}
          </div>
          {meta && <div className="cabecalho-meta">{meta}</div>}
        </div>
        {acoes && <div className="cabecalho-acoes">{acoes}</div>}
      </div>
    </header>
  );
}

/**
 * Explicação que não precisa estar sempre na tela. Um "?" discreto abre o texto
 * — quem já sabe não tropeça nele, quem não sabe acha na hora.
 */
export function Ajuda({ children, rotulo = "Por que isto?" }: { children: React.ReactNode; rotulo?: string }) {
  return (
    <details className="ui-ajuda">
      <summary aria-label={rotulo} title={rotulo}>
        <CircleHelp size={15} aria-hidden />
      </summary>
      <div className="ui-ajuda-texto">{children}</div>
    </details>
  );
}

/** Cartão de conteúdo com título, contagem, ação no canto e ajuda recolhida. */
export function Cartao({
  titulo,
  icone,
  contador,
  acao,
  ajuda,
  id,
  destaque,
  children,
}: {
  titulo: React.ReactNode;
  icone?: React.ReactNode;
  contador?: React.ReactNode;
  acao?: React.ReactNode;
  ajuda?: React.ReactNode;
  id?: string;
  destaque?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className={`ui-cartao${destaque ? " ui-cartao-destaque" : ""}`} id={id}>
      <header className="ui-cartao-topo">
        <h2>
          {icone && (
            <span className="ui-cartao-icone" aria-hidden>
              {icone}
            </span>
          )}
          {titulo}
          {contador !== undefined && contador !== null && contador !== "" && (
            <span className="contador-cinza">{contador}</span>
          )}
          {ajuda && <Ajuda>{ajuda}</Ajuda>}
        </h2>
        {acao && <div className="ui-cartao-acao">{acao}</div>}
      </header>
      <div className="ui-cartao-corpo">{children}</div>
    </section>
  );
}

/** Estado vazio que diz o próximo passo, em vez de uma área em branco. */
export function Vazio({
  icone,
  titulo,
  children,
  acao,
}: {
  icone?: React.ReactNode;
  titulo: string;
  children?: React.ReactNode;
  acao?: React.ReactNode;
}) {
  return (
    <div className="vazio-novo">
      {icone && (
        <span className="vazio-icone" aria-hidden>
          {icone}
        </span>
      )}
      <strong>{titulo}</strong>
      {children && <p>{children}</p>}
      {acao}
    </div>
  );
}

/** Lista de rótulo e valor — o "resumo" das páginas de registro. Valor vazio vira um traço. */
export function Dados({ itens }: { itens: [React.ReactNode, React.ReactNode | null | undefined | false][] }) {
  return (
    <dl className="dados">
      {itens.map(([rotulo, valor], i) => (
        <div key={i}>
          <dt>{rotulo}</dt>
          <dd>{valor || valor === 0 ? valor : <span className="dados-vazio">—</span>}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * O caminho de etapas, como o "Path" do Salesforce: as feitas com um visto, a
 * atual acesa, as próximas apagadas. Rola na horizontal quando não cabe.
 */
export function Caminho({
  etapas,
  atual,
  rotuloAtual = "etapa atual",
  compacto,
}: {
  etapas: { id: string; nome: string }[];
  atual: number;
  rotuloAtual?: string;
  /** Muitas etapas: as feitas viram só o visto, para as próximas terem espaço. */
  compacto?: boolean;
}) {
  return (
    <ol className={`caminho${compacto ? " caminho-compacto" : ""}`} aria-label="Etapas">
      {etapas.map((e, i) => {
        const estado = i < atual ? "feita" : i === atual ? "atual" : "proxima";
        return (
          <li
            key={e.id}
            className={`caminho-passo ${estado}`}
            aria-current={i === atual ? "step" : undefined}
            title={e.nome}
          >
            <span className="caminho-marca" aria-hidden>
              {estado === "feita" ? <Check size={12} strokeWidth={3} /> : i + 1}
            </span>
            <span className="caminho-nome">
              {e.nome}
              {i === atual && <span className="sr-only"> ({rotuloAtual})</span>}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
