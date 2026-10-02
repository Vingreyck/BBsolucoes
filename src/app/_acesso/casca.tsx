import { ClipboardCheck, KanbanSquare, ShieldCheck, Sun, SunMedium } from "lucide-react";

/**
 * A moldura das telas de quem ainda não entrou: login, pedido de acesso e troca
 * de senha.
 *
 * Duas metades, como nos grandes sistemas: à esquerda a marca e o que o sistema
 * faz, à direita só o formulário. No celular a metade da marca encolhe para uma
 * faixa no topo — quem está em campo quer o formulário, não a propaganda.
 */
export function CascaAcesso({
  titulo,
  subtitulo,
  children,
  rodape,
}: {
  titulo: string;
  subtitulo?: React.ReactNode;
  children: React.ReactNode;
  rodape?: React.ReactNode;
}) {
  return (
    <main className="acesso">
      <aside className="acesso-marca">
        <div className="acesso-marca-topo">
          <span className="marca-selo" aria-hidden>
            <SunMedium size={18} />
          </span>
          <span className="acesso-marca-nome">Selebi</span>
        </div>

        <div className="acesso-marca-meio">
          <h2>Da venda à usina gerando, num lugar só.</h2>
          <ul>
            <li>
              <KanbanSquare size={18} aria-hidden />
              <span>
                <strong>Esteira de projetos</strong>
                Cada venda com seus documentos, etapa e responsável.
              </span>
            </li>
            <li>
              <ClipboardCheck size={18} aria-hidden />
              <span>
                <strong>Ordens de serviço</strong>
                Vistoria, instalação e manutenção com checklist, fotos e assinatura.
              </span>
            </li>
            <li>
              <Sun size={18} aria-hidden />
              <span>
                <strong>Monitoramento</strong>
                As usinas de todos os portais num painel, com alerta quando uma para.
              </span>
            </li>
          </ul>
        </div>

        <p className="acesso-marca-rodape">
          <ShieldCheck size={14} aria-hidden /> Acesso só para a equipe, com conta nominal.
        </p>
      </aside>

      <section className="acesso-lado">
        <div className="acesso-cartao">
          <header className="acesso-cabecalho">
            <h1>{titulo}</h1>
            {subtitulo && <p>{subtitulo}</p>}
          </header>
          {children}
        </div>
        <footer className="acesso-rodape">
          {rodape}
          <a href="/privacidade">Política de privacidade</a>
        </footer>
      </section>
    </main>
  );
}
