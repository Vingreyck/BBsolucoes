"use client";

import { RotateCcw, TriangleAlert } from "lucide-react";

/**
 * O que aparece quando uma tela ou um envio de formulário quebra.
 *
 * Sem esta página, o Next mostrava só "Application error: a client-side
 * exception has occurred" numa tela preta — foi assim que o datasheet barrado
 * por tamanho (20/11) pareceu um defeito misterioso. Aqui a pessoa lê o que
 * pode ter acontecido e tenta de novo sem perder o resto da tela.
 */
export default function Erro({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main>
      <div className="pagina-corpo">
        <section className="erro-pagina" role="alert">
          <span className="erro-pagina-icone" aria-hidden>
            <TriangleAlert size={22} />
          </span>
          <h1>Não deu certo desta vez</h1>
          <p>
            Algo falhou ao carregar a tela ou ao salvar. Se você estava enviando um arquivo, ele pode ser grande demais;
            tente um PDF menor. Se o problema continuar, avise o administrador do sistema.
          </p>
          {error.digest && <p className="fraco">Código para o suporte: {error.digest}</p>}
          <div className="barra-enviar">
            <button type="button" className="botao" onClick={() => reset()}>
              <RotateCcw size={15} aria-hidden /> Tentar de novo
            </button>
            <a href="/" className="botao secundario">
              Voltar ao início
            </a>
          </div>
        </section>
      </div>
    </main>
  );
}
