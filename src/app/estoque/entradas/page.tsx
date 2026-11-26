import { FileText, PackagePlus, Receipt } from "lucide-react";
import Link from "next/link";

import { dataBr } from "@/datas";
import { exigirEstoque } from "@/estoque/acesso";
import { listarEntradas } from "@/estoque/estoque";
import { formatarInstante } from "@/os/relogio";

import { Cabecalho, Vazio } from "../../_ui";
import { endereco, paginar, Paginacao } from "../../_ui/paginacao";
import { LEITURA_ROTULO, SITUACAO_ENTRADA } from "./rotulos";

export const dynamic = "force-dynamic";

/** As compras que entraram (ou esperam conferência), mais recentes primeiro; as a conferir no topo. */
export default async function Entradas({ searchParams }: { searchParams: Promise<{ pagina?: string; ok?: string; erro?: string }> }) {
  const usuario = await exigirEstoque();
  const sp = await searchParams;
  const todas = await listarEntradas(usuario.empresaId);
  const ordenadas = [...todas.filter((e) => e.situacao === "rascunho"), ...todas.filter((e) => e.situacao !== "rascunho")];
  const pagina = paginar(ordenadas, sp.pagina);
  const rascunhos = todas.filter((e) => e.situacao === "rascunho").length;

  return (
    <main>
      <Cabecalho
        trilha={[{ href: "/estoque", rotulo: "Estoque" }]}
        titulo="Entradas"
        selos={rascunhos > 0 ? <span className="pilula sev-atencao">{rascunhos} para conferir</span> : undefined}
        meta="Cada compra que chegou: pela nota fiscal, pelo pedido ou à mão. A nota lida só mexe no saldo depois de conferida."
        acoes={
          <Link href="/estoque/entradas/nova" className="botao">
            <PackagePlus size={15} aria-hidden /> Nova entrada
          </Link>
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
      <div className="pagina-corpo pilha">
        <section className="lista" id="lista" aria-label="Notas e pedidos">
          {todas.length === 0 ? (
            <Vazio
              icone={<Receipt size={22} />}
              titulo="Nenhuma entrada ainda"
              acao={
                <Link href="/estoque/entradas/nova" className="botao">
                  <PackagePlus size={15} aria-hidden /> Nova entrada
                </Link>
              }
            >
              Mande a nota fiscal (XML, PDF ou foto), o pedido do fornecedor, ou adicione à mão.
            </Vazio>
          ) : (
            <div className="tabela-rolagem">
              <table className="tabela">
                <thead>
                  <tr>
                    <th>Documento</th>
                    <th>Emissão</th>
                    <th className="num">Itens</th>
                    <th>Situação</th>
                  </tr>
                </thead>
                <tbody>
                  {pagina.itens.map((e) => {
                    const sit = SITUACAO_ENTRADA[e.situacao] ?? { rotulo: e.situacao, classe: "" };
                    const entram = e.itensLidos.filter((l) => l.entra).length;
                    return (
                      <tr key={e.id}>
                        <td>
                          <div className="es-item">
                            <Link href={`/estoque/entradas/${e.id}`} className="es-item-link">
                              {e.numero ? `Nº ${e.numero}` : e.leitura === "manual" ? "Entrada à mão" : "Sem número"}
                              {e.fornecedor ? ` · ${e.fornecedor}` : ""}
                            </Link>
                            <span className="es-item-meta">
                              <span>{LEITURA_ROTULO[e.leitura ?? ""] ?? "—"}</span>
                              <span>
                                {e.criador ? `${e.criador.nome}, ` : ""}
                                {formatarInstante(e.criadoEm, false)}
                              </span>
                              {e.arquivos.map((a) => (
                                <a key={a.id} href={`/estoque/entradas/${e.id}/arquivo/${a.id}`} target="_blank" rel="noreferrer">
                                  <FileText size={11} aria-hidden /> {a.papel === "nota" ? "nota" : "pedido"}
                                </a>
                              ))}
                            </span>
                          </div>
                        </td>
                        <td className="fraco">{e.emitidaEm ? dataBr(e.emitidaEm) : "—"}</td>
                        <td className="num">{entram}</td>
                        <td>
                          <span className={`pilula ${sit.classe}`}>{sit.rotulo}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <Paginacao {...pagina} href={(n) => endereco("/estoque/entradas", {}, { pagina: n })} rotulo="entradas" />
        </section>
      </div>
    </main>
  );
}
