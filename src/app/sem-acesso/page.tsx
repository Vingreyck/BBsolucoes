import { exigirUsuario } from "@/auth/sessao";

export const dynamic = "force-dynamic";

/**
 * Tela de acesso negado.
 *
 * Diz o que falta e para quem pedir, em vez de só fechar a porta — quem chega
 * aqui é colega de trabalho tentando fazer o serviço, não invasor.
 */
export default async function SemAcesso() {
  const usuario = await exigirUsuario();

  return (
    <main>
      <header className="topo">
        <h1>Sem acesso</h1>
      </header>

      <div className="vazio">
        <p>
          Os documentos do cliente guardam CNH, RG, CPF e conta de luz. O acesso
          é limitado a quem precisa deles para trabalhar — administração, vendas
          e engenharia.
        </p>
        <p>
          Seu perfil hoje é <strong>{usuario.papel}</strong>. Se você precisa
          ver esta tela, peça à administração para ajustar o seu perfil.
        </p>
        <p>
          <a href="/">Voltar para a esteira</a>
        </p>
      </div>
    </main>
  );
}
