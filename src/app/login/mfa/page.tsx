import { redirect } from "next/navigation";

import { lerDesafio } from "@/auth/mfa";
import { desafioGuardado } from "@/auth/mfa-web";

import { CascaAcesso } from "../../_acesso/casca";
import { cancelarCodigo, confirmarCodigo } from "./actions";
import { CodigoQr } from "./qr";

export const dynamic = "force-dynamic";

const MENSAGENS: Record<string, string> = {
  codigo: "Esse código não confere. Confira o número no aplicativo — ele muda a cada 30 segundos — e tente de novo.",
  tentativas: "Muitas tentativas seguidas. Espere alguns minutos e tente de novo.",
};

/** "JBSWY3DPEHPK3PXP…" em blocos de 4, que é como se lê e digita. */
const emBlocos = (s: string) => s.replace(/(.{4})/g, "$1 ").trim();

/**
 * A segunda etapa do login: o código do aplicativo autenticador.
 *
 * Quem ainda não cadastrou o aplicativo vê o QR para ler com o Google
 * Authenticator (ou outro) e, logo abaixo, a chave para digitar à mão — para
 * quando a câmera não lê. Quem já cadastrou só digita o código.
 */
export default async function CodigoDeEntrada({ searchParams }: { searchParams: Promise<{ erro?: string }> }) {
  const desafio = await lerDesafio(await desafioGuardado(), "web");
  if (!desafio) redirect("/login?erro=mfa_expirou");

  const { erro } = await searchParams;
  const mensagem = erro ? MENSAGENS[erro] : null;
  const cadastro = desafio.cadastro;

  return (
    <CascaAcesso
      titulo={cadastro ? "Proteja a sua conta" : "Confirme que é você"}
      subtitulo={
        cadastro
          ? "Antes de entrar, ligue o aplicativo autenticador. É feito uma vez só."
          : "Digite o código de 6 dígitos do aplicativo autenticador."
      }
      rodape={
        <form action={cancelarCodigo}>
          <button type="submit" className="link-botao">
            ← Voltar e entrar com outra conta
          </button>
        </form>
      }
    >
      {mensagem && (
        <p className="acesso-mensagem erro" role="alert">
          {mensagem}
        </p>
      )}

      {cadastro && (
        <ol className="mfa-passos">
          <li>
            Instale o <strong>Google Authenticator</strong> no celular (ou o Microsoft Authenticator, o Authy…).
          </li>
          <li>
            No aplicativo, toque em <strong>+</strong> e <strong>Ler código QR</strong>, e aponte para este:
            <div className="mfa-qr-caixa">
              <CodigoQr conteudo={cadastro.uri} rotulo={`QR para cadastrar a conta ${desafio.conta} no aplicativo autenticador`} />
            </div>
            <details className="mfa-manual">
              <summary>A câmera não lê? Digite a chave</summary>
              <p>
                No aplicativo escolha <strong>Inserir chave de configuração</strong>, e digite{" "}
                <code>{emBlocos(cadastro.segredo)}</code> (tipo: baseada em tempo).
              </p>
            </details>
          </li>
          <li>Digite abaixo o código de 6 dígitos que o aplicativo mostrar.</li>
        </ol>
      )}

      <form action={confirmarCodigo} className="acesso-form">
        <label className="entrada">
          <span className="entrada-rotulo">Código de 6 dígitos</span>
          <input
            type="text"
            name="codigo"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9 ]{6,7}"
            maxLength={7}
            placeholder="000 000"
            required
            autoFocus
            aria-invalid={erro === "codigo" || undefined}
          />
        </label>

        <label className="mfa-confiar">
          <input type="checkbox" name="confiar" value="sim" defaultChecked />
          <span>
            <strong>Confiar neste aparelho por 30 dias.</strong> Não marque em computador de uso comum.
          </span>
        </label>

        <button type="submit" className="botao-grande">
          {cadastro ? "Ligar e entrar" : "Entrar"}
        </button>
      </form>
    </CascaAcesso>
  );
}
