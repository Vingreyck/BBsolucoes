import { asc, eq } from "drizzle-orm";
import { FileText, ListChecks, Receipt, Undo2 } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ehUuid } from "@/app-movel/http";
import { dataBr } from "@/datas";
import { db, schema } from "@/db";
import type { LinhaDaEntrada } from "@/db/schema/estoque";
import { exigirEstoque } from "@/estoque/acesso";
import { entradaDaEmpresa } from "@/estoque/estoque";
import { quantidadeLegivel, sugerirItem } from "@/estoque/regras";
import { formatarInstante } from "@/os/relogio";

import { Cabecalho, Cartao, Dados } from "../../../_ui";
import { descartarEntradaAction, desfazerEntradaAction, lancarEntradaAction } from "../../actions";
import { LEITURA_ROTULO, ORIGEM_ROTULO, SITUACAO_ENTRADA } from "../rotulos";
import { Conferencia } from "./conferencia";

export const dynamic = "force-dynamic";

/**
 * A conferência de uma entrada: o que a leitura achou, linha por linha, para
 * quem recebeu a mercadoria corrigir quantidade, ligar ao item do estoque (ou
 * criar um) e ao modelo do catálogo, e lançar. Depois de lançada, fica só
 * para consulta — e o administrador pode desfazer.
 */
export default async function ConferirEntrada({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ok?: string; erro?: string }>;
}) {
  const usuario = await exigirEstoque();
  const { id } = await params;
  const sp = await searchParams;
  if (!ehUuid(id)) notFound();
  const entrada = await entradaDaEmpresa(usuario.empresaId, id);
  if (!entrada) notFound();

  const [itens, modelos] = await Promise.all([
    db.query.itemEstoque.findMany({
      where: eq(schema.itemEstoque.empresaId, usuario.empresaId),
      columns: { id: true, nome: true, unidade: true, ativo: true, codigo: true, modeloEquipamentoId: true },
      orderBy: asc(schema.itemEstoque.nome),
    }),
    db.query.modeloEquipamento.findMany({
      where: eq(schema.modeloEquipamento.empresaId, usuario.empresaId),
      columns: { id: true, fabricante: true, modelo: true },
      orderBy: [asc(schema.modeloEquipamento.fabricante), asc(schema.modeloEquipamento.modelo)],
    }),
  ]);
  const nomeDoItem = new Map(itens.map((i) => [i.id, i.nome]));

  const rascunho = entrada.situacao === "rascunho";
  const sit = SITUACAO_ENTRADA[entrada.situacao] ?? { rotulo: entrada.situacao, classe: "" };
  const linhas: LinhaDaEntrada[] = entrada.itensLidos;
  const marcadas = entrada.itensLidos.filter((l) => l.entra).length;

  return (
    <main>
      <Cabecalho
        trilha={[
          { href: "/estoque", rotulo: "Estoque" },
          { href: "/estoque/entradas", rotulo: "Entradas" },
        ]}
        titulo={entrada.numero ? `Entrada nº ${entrada.numero}` : "Entrada sem número"}
        selos={<span className={`pilula ${sit.classe}`}>{sit.rotulo}</span>}
        meta={
          rascunho
            ? "Confira cada linha: quantidade, unidade e qual item do estoque ela é. Só as marcadas entram no saldo."
            : `Lançada${entrada.lancadaEm ? ` em ${formatarInstante(entrada.lancadaEm, false)}` : ""}. ${
                entrada.situacao === "desfeita" ? "Depois desfeita: o que ela somou já saiu do saldo." : ""
              }`
        }
      />
      {sp.ok && (
        <p className="aviso ok" role="status">
          {sp.ok}
        </p>
      )}
      {sp.erro && (
        <p className="aviso erro" role="alert">
          {sp.erro}
        </p>
      )}
      {entrada.aviso && (
        <div className="aviso">
          {entrada.aviso.split("\n").map((a, i) => (
            <p key={i}>{a}</p>
          ))}
        </div>
      )}

      <div className="pagina-corpo pilha">

        {rascunho ? (
          <Cartao
            titulo="Conferir os itens"
            icone={<ListChecks size={16} />}
            ajuda="Desmarque o que não deve entrar no saldo. “Criar item novo” cadastra o item com a descrição da linha; escolher um item existente soma nele."
          >
            <Conferencia
              linhasLidas={entrada.itensLidos.map((l) =>
                // Linha ainda sem item: sugere de novo (pode ter nascido item depois do envio).
                l.itemId ? l : { ...l, ...sugerirItem(l, itens, modelos), modeloId: l.modeloId ?? sugerirItem(l, itens, modelos).modeloId },
              )}
              itens={itens.map(({ id, nome, unidade, ativo }) => ({ id, nome, unidade, ativo }))}
              modelos={modelos.map((m) => ({ id: m.id, nome: `${m.fabricante} ${m.modelo}` }))}
              cabecalho={{ numero: entrada.numero, fornecedor: entrada.fornecedor, emitidaEm: entrada.emitidaEm }}
              lancar={lancarEntradaAction.bind(null, entrada.id)}
              descartar={descartarEntradaAction.bind(null, entrada.id)}
            />
          </Cartao>
        ) : (
          <Cartao titulo="Itens" icone={<ListChecks size={16} />} contador={marcadas || undefined}>
            <div className="tabela-wrap tabela-no-cartao">
              <table className="tabela">
                <thead>
                  <tr>
                    <th>Descrição na nota</th>
                    <th className="num">Qtd.</th>
                    <th>Entrou como</th>
                    <th>De onde veio</th>
                  </tr>
                </thead>
                <tbody>
                  {linhas.map((l, n) => (
                    <tr key={n} className={l.entra ? "" : "linha-apagada"}>
                      <td>{l.descricao}</td>
                      <td className="num">
                        {quantidadeLegivel(l.quantidade)} {l.unidade}
                      </td>
                      <td>
                        {l.entra && l.itemId ? (
                          <Link href={`/estoque/movimentos?item=${l.itemId}`}>{nomeDoItem.get(l.itemId) ?? "item"}</Link>
                        ) : (
                          <span className="fraco">não entrou</span>
                        )}
                      </td>
                      <td className="fraco">{ORIGEM_ROTULO[l.origem] ?? l.origem}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {entrada.situacao === "lancada" && usuario.papel === "adm" && (
              <form action={desfazerEntradaAction.bind(null, entrada.id)} className="es-rodape" style={{ marginTop: "0.85rem" }}>
                <button type="submit" className="botao secundario">
                  <Undo2 size={15} aria-hidden /> Desfazer entrada
                </button>
                <span className="nota">Tira do saldo o que esta entrada somou, com estorno no histórico.</span>
              </form>
            )}
          </Cartao>
        )}

        <Cartao titulo="Documento" icone={<Receipt size={16} />}>
          <Dados
            itens={[
              ["Fornecedor", entrada.fornecedor],
              ["CNPJ", entrada.cnpjFornecedor ? entrada.cnpjFornecedor.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5") : null],
              ["Emissão", entrada.emitidaEm ? dataBr(entrada.emitidaEm) : null],
              ["Valor", entrada.valorTotal ? Number(entrada.valorTotal).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) : null],
              ["Chave de acesso", entrada.chaveAcesso ? <code key="c">{entrada.chaveAcesso}</code> : null],
              ["Leitura", LEITURA_ROTULO[entrada.leitura ?? ""] ?? null],
              ["Enviada por", entrada.criador ? `${entrada.criador.nome} · ${formatarInstante(entrada.criadoEm, false)}` : null],
              [
                "Arquivos",
                entrada.arquivos.length
                  ? entrada.arquivos.map((a) =>
                      a.driveId ? (
                        <a key={a.id} className="link-acao" href={`/estoque/entradas/${entrada.id}/arquivo/${a.id}`} target="_blank" rel="noreferrer">
                          <FileText size={13} aria-hidden /> {a.papel === "nota" ? "Nota" : "Pedido"}{" "}
                        </a>
                      ) : (
                        <span key={a.id} className="fraco">
                          {a.papel === "nota" ? "Nota" : "Pedido"} (não guardado){" "}
                        </span>
                      ),
                    )
                  : null,
              ],
            ]}
          />
        </Cartao>
      </div>
    </main>
  );
}
