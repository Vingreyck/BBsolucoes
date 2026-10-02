import { Lock } from "lucide-react";

import { exigirUsuario } from "@/auth/sessao";

import { Cabecalho, Vazio } from "../_ui";

export const dynamic = "force-dynamic";

const PAPEL_ROTULO: Record<string, string> = {
  adm: "Administrador",
  vendedor: "Vendedor",
  engenheiro: "Engenheiro",
  tecnico: "Técnico",
  estoque: "Estoque",
};

/**
 * Tela de acesso negado.
 *
 * Diz o que falta e para quem pedir, em vez de só fechar a porta — quem chega
 * aqui é colega de trabalho tentando fazer o serviço, não invasor.
 *
 * Serve a mais de uma porta (documentos, administração, gestão das OS), então
 * explica a regra geral em vez de falar só de uma delas.
 */
export default async function SemAcesso() {
  const usuario = await exigirUsuario();

  return (
    <main>
      <Cabecalho titulo="Sem acesso" />
      <div className="pagina-corpo">
        <Vazio
          icone={<Lock size={20} />}
          titulo="Esta tela não está liberada para o seu perfil"
          acao={
            <a href="/" className="botao secundario">
              Voltar para o início
            </a>
          }
        >
          Cada parte do Selebi é liberada conforme o papel na equipe: os documentos do cliente (CNH, CPF, conta de luz)
          só para quem trabalha com eles, a administração só para o administrador, e abrir ou distribuir OS para a
          gestão. Seu perfil hoje é <strong>{PAPEL_ROTULO[usuario.papel] ?? usuario.papel}</strong>. Se você precisa
          desta tela, peça à administração para ajustar o seu perfil.
        </Vazio>
      </div>
    </main>
  );
}
