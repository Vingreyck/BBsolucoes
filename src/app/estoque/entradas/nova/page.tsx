import { Check, PencilLine, ScanLine } from "lucide-react";

import { driveConfigurado } from "@/documentos/drive";
import { exigirEstoque } from "@/estoque/acesso";
import { itensComSaldo } from "@/estoque/estoque";
import { leituraLigada } from "@/estoque/ler-documento";

import { Cabecalho } from "../../../_ui";
import { AdicionarAMao } from "../../a-mao";
import { EnvioDeDocumentos } from "../../envio";

export const dynamic = "force-dynamic";

/**
 * Nova entrada, por dois caminhos lado a lado:
 *
 * - **Ler da nota ou do pedido**: o Selebi lê os itens e abre a conferência;
 *   nada entra no saldo antes de alguém conferir e lançar.
 * - **Adicionar à mão**: digitar os itens e dar entrada direto.
 */
export default async function NovaEntrada({ searchParams }: { searchParams: Promise<{ erro?: string }> }) {
  const usuario = await exigirEstoque();
  const { erro } = await searchParams;
  const groq = leituraLigada();
  const drive = driveConfigurado();
  const itens = (await itensComSaldo(usuario.empresaId)).filter((i) => i.ativo);

  return (
    <main>
      <Cabecalho
        trilha={[
          { href: "/estoque", rotulo: "Estoque" },
          { href: "/estoque/entradas", rotulo: "Entradas" },
        ]}
        titulo="Nova entrada"
        meta="Mande a nota fiscal ou o pedido do fornecedor para o Selebi ler os itens, ou adicione à mão."
      />
      {erro && (
        <p className="aviso erro" role="alert">
          {erro}
        </p>
      )}

      <div className="pagina-corpo pilha">
        <div className="es-caminhos">
          <section className="es-caminho" aria-labelledby="ler-titulo">
            <header className="es-caminho-topo">
              <span className="es-caminho-icone" aria-hidden>
                <ScanLine size={19} />
              </span>
              <div>
                <h2 id="ler-titulo">Ler da nota ou do pedido</h2>
                <p>O Selebi tira os itens do arquivo e mostra para você conferir antes de entrar no estoque.</p>
              </div>
            </header>

            <EnvioDeDocumentos groq={groq} />

            <ul className="es-dicas">
              <li>
                <Check size={14} aria-hidden /> O XML da NF-e é o mais exato: os itens saem sem leitura por IA.
              </li>
              <li>
                <Check size={14} aria-hidden /> Nota do kit (um item só e os componentes na observação): os componentes entram e o
                kit fica fora, para não contar duas vezes.
              </li>
              <li>
                <Check size={14} aria-hidden /> Nota e pedido juntos: o que se repete começa desmarcado.
              </li>
            </ul>

            {!groq && (
              <p className="es-desligado">
                A leitura de foto e PDF está desligada (falta GROQ_API_KEY no servidor). O XML é lido normalmente; foto e PDF abrem a
                conferência em branco.
              </p>
            )}
            {!drive && <p className="es-desligado">O Drive não está conectado: a entrada vale, mas o arquivo não fica guardado.</p>}
          </section>

          <section className="es-caminho" id="a-mao" aria-labelledby="mao-titulo">
            <header className="es-caminho-topo">
              <span className="es-caminho-icone" aria-hidden>
                <PencilLine size={19} />
              </span>
              <div>
                <h2 id="mao-titulo">Adicionar à mão</h2>
                <p>Sem arquivo: digite o item e a quantidade. Nome que já existe soma no mesmo item.</p>
              </div>
            </header>
            <AdicionarAMao itens={itens.map((i) => ({ nome: i.nome, unidade: i.unidade, saldo: i.saldo }))} />
          </section>
        </div>
      </div>
    </main>
  );
}
