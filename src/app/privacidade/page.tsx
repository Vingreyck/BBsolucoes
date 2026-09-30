import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Política de privacidade — BBSolution",
};

/**
 * Página pública, sem login: a Play Store exige uma URL aberta para o app que
 * coleta localização. O e-mail de contato vem do ambiente porque é da empresa,
 * não do código.
 */
const CONTATO = process.env.CONTATO_PRIVACIDADE ?? "";

export default function Privacidade() {
  return (
    <main className="login" style={{ alignItems: "flex-start" }}>
      <article className="cartao-login" style={{ maxWidth: 720, lineHeight: 1.6 }}>
        <h1>Política de privacidade</h1>
        <p className="dica">Aplicativo BBSolution · atualizada em 30/09/2026</p>

        <p>
          O BBSolution é o aplicativo de trabalho da equipe da BB Soluções (energia solar, Sergipe).
          Ele serve para receber ordens de serviço, registrar o atendimento em campo e enviar o
          relatório ao escritório. Só usa quem foi cadastrado e aprovado pela empresa.
        </p>

        <h2>O que coletamos</h2>
        <ul>
          <li>
            <strong>Cadastro:</strong> nome, CPF (usado como login), e-mail (opcional) e senha. A
            senha é guardada de forma irreversível (hash).
          </li>
          <li>
            <strong>Localização:</strong> somente entre o toque em “Estou a caminho” e o fim da OS
            (concluir, pausar ou “não consegui atender”). Fora desse período o aplicativo não lê a
            sua posição. Enquanto o GPS está ligado, uma notificação fixa avisa você.
          </li>
          <li>
            <strong>Registro do atendimento:</strong> respostas do checklist, fotos, assinatura do
            cliente, observações e horários.
          </li>
        </ul>

        <h2>Para que usamos</h2>
        <p>
          Para que o escritório saiba onde a equipe está durante um atendimento, acompanhe o
          trajeto, comprove o serviço prestado e gere o relatório da OS. Não usamos esses dados para
          publicidade e não os vendemos.
        </p>

        <h2>Com quem compartilhamos</h2>
        <p>
          Os dados ficam no servidor da BB Soluções. Fotos e documentos da venda são guardados no
          Google Drive da empresa. O trajeto pode ser desenhado sobre ruas usando um serviço público
          de mapas (OpenStreetMap/OSRM), que recebe apenas coordenadas, sem o seu nome. O relatório
          da OS pode ser enviado ao cliente do atendimento por link.
        </p>

        <h2>Por quanto tempo</h2>
        <p>
          Os dados do atendimento ficam enquanto a empresa precisar deles para comprovar o serviço e
          cumprir obrigações legais. Ao deixar a empresa, o seu acesso é desativado.
        </p>

        <h2>Seus direitos (LGPD)</h2>
        <p>
          Você pode pedir acesso, correção ou exclusão dos seus dados, e a exclusão da conta, à
          empresa
          {CONTATO ? (
            <>
              {" "}
              pelo e-mail <a href={`mailto:${CONTATO}`}>{CONTATO}</a>
            </>
          ) : (
            " pelo canal informado pela sua coordenação"
          )}
          .
        </p>
      </article>
    </main>
  );
}
