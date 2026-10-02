import { SunMedium } from "lucide-react";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Excluir conta — BBSolution",
};

/**
 * Página pública, sem login: a Play Store exige uma URL onde a pessoa peça a
 * exclusão da conta e dos dados sem precisar reinstalar o app.
 */
const CONTATO = process.env.CONTATO_PRIVACIDADE ?? "";

export default function ExcluirConta() {
  return (
    <main className="pagina-publica">
      <header className="publica-topo">
        <span className="marca-selo" aria-hidden>
          <SunMedium size={16} />
        </span>
        BBSolution
      </header>
      <article className="documento-publico">
        <h1>Excluir conta e dados</h1>
        <p className="dica">Aplicativo BBSolution · BB Soluções</p>

        <p>
          Quem usa o BBSolution tem uma conta criada pela empresa (nome, CPF e senha). Você pode pedir
          a exclusão dela e dos dados pessoais ligados a ela a qualquer momento, sem precisar
          reinstalar o aplicativo.
        </p>

        <h2>Como pedir</h2>
        <ol>
          <li>
            Envie um e-mail
            {CONTATO ? (
              <>
                {" "}
                para <a href={`mailto:${CONTATO}`}>{CONTATO}</a>
              </>
            ) : (
              " ao responsável pela sua empresa"
            )}{" "}
            com o assunto <strong>Excluir conta BBSolution</strong>.
          </li>
          <li>Informe o seu nome completo e o seu CPF, para confirmarmos que a conta é sua.</li>
          <li>
            Respondemos em até 15 dias e avisamos quando a exclusão estiver concluída. Se preferir,
            você também pode pedir ao administrador da sua empresa.
          </li>
        </ol>

        <h2>O que é apagado</h2>
        <ul>
          <li>O seu acesso (login e senha) ao aplicativo e ao sistema.</li>
          <li>Os dados do seu cadastro: nome, CPF e e-mail.</li>
          <li>O histórico de posições de GPS gravado nas suas ordens de serviço.</li>
        </ul>

        <h2>O que pode ser mantido</h2>
        <p>
          Os registros do serviço prestado ao cliente (ordem de serviço, fotos, checklist e relatório)
          fazem parte da prova do atendimento e podem ser mantidos pelo prazo necessário para cumprir
          obrigações legais e comprovar o serviço. Desativar uma conta sem apagar os dados não conta
          como exclusão; aqui o pedido é de exclusão.
        </p>

        <p>
          Mais detalhes sobre o que coletamos estão na <a href="/privacidade">política de privacidade</a>.
        </p>
      </article>
    </main>
  );
}
