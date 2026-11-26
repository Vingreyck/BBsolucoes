import { and, asc, eq } from "drizzle-orm";
import { ArrowLeftRight, Package, PackagePlus, PencilLine, Scale, Search, Settings2 } from "lucide-react";
import Link from "next/link";

import { db, schema } from "@/db";
import { exigirEstoque } from "@/estoque/acesso";
import { itensComSaldo } from "@/estoque/estoque";
import { chaveDoNome, quantidadeLegivel, situacaoDoSaldo, type SituacaoDoSaldo } from "@/estoque/regras";
import { formatarInstante } from "@/os/relogio";

import { Cabecalho, Vazio } from "../_ui";
import { BotaoDialogo } from "../_ui/dialogo";
import { endereco, paginar, Paginacao } from "../_ui/paginacao";
import { ajustarAction, salvarItemAction } from "./actions";

export const dynamic = "force-dynamic";

const UNIDADES = ["un", "m", "kg", "cx", "rolo", "par", "kit", "cj", "l"];

const SITUACAO: Record<SituacaoDoSaldo, { rotulo: string; classe: string } | null> = {
  negativo: { rotulo: "negativo", classe: "sev-critico" },
  zerado: { rotulo: "zerado", classe: "sev-atencao" },
  baixo: { rotulo: "acabando", classe: "sev-atencao" },
  ok: null,
};

/**
 * O estoque: o saldo de cada item (a soma do livro de movimentos), o que está
 * negativo ou acabando, e o ajuste de contagem.
 *
 * As entradas chegam pela nota fiscal, pelo pedido ou à mão (Nova entrada); as
 * saídas, pelo material que o técnico registra na OS.
 */
export default async function Estoque({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; filtro?: string; pagina?: string; ok?: string; erro?: string }>;
}) {
  const usuario = await exigirEstoque();
  const sp = await searchParams;
  const q = sp.q?.trim() ?? "";
  const filtro = ["negativo", "baixo", "inativos"].includes(sp.filtro ?? "") ? (sp.filtro as string) : "";
  // A janelinha nasce fechada de novo depois de cada envio.
  const chave = `${sp.ok ?? ""}${sp.erro ?? ""}`;

  const [itens, modelos, [rascunhos]] = await Promise.all([
    itensComSaldo(usuario.empresaId),
    db.query.modeloEquipamento.findMany({
      where: eq(schema.modeloEquipamento.empresaId, usuario.empresaId),
      columns: { id: true, fabricante: true, modelo: true },
      orderBy: [asc(schema.modeloEquipamento.fabricante), asc(schema.modeloEquipamento.modelo)],
    }),
    db
      .$count(schema.entradaEstoque, and(eq(schema.entradaEstoque.empresaId, usuario.empresaId), eq(schema.entradaEstoque.situacao, "rascunho")))
      .then((n) => [n]),
  ]);
  const nomeDoModelo = new Map(modelos.map((m) => [m.id, `${m.fabricante} ${m.modelo}`]));

  const comSituacao = itens.map((i) => ({ ...i, situacao: situacaoDoSaldo(i.saldo, i.minimo) }));
  const ativos = comSituacao.filter((i) => i.ativo);
  const negativos = ativos.filter((i) => i.situacao === "negativo");
  const acabando = ativos.filter((i) => i.situacao === "baixo" || i.situacao === "zerado");
  const inativos = comSituacao.filter((i) => !i.ativo);

  const busca = chaveDoNome(q);
  const base = filtro === "negativo" ? negativos : filtro === "baixo" ? acabando : filtro === "inativos" ? inativos : ativos;
  const filtrados = base.filter(
    (i) => !busca || chaveDoNome(i.nome).includes(busca) || (i.codigo && chaveDoNome(i.codigo).includes(busca)),
  );
  const pagina = paginar(filtrados, sp.pagina);
  const atuais = { q: q || undefined, filtro: filtro || undefined };
  const aqui = endereco("/estoque", atuais, { pagina: pagina.pagina });

  const chip = (valor: string, rotulo: string, n: number, perigo = false) => (
    <Link
      href={endereco("/estoque", { q: q || undefined, filtro: valor || undefined })}
      className={`filtro${filtro === valor ? " ativo" : ""}${perigo && n > 0 ? " perigo" : ""}`}
      aria-current={filtro === valor ? "page" : undefined}
    >
      {rotulo} <span className="filtro-n">{n}</span>
    </Link>
  );

  return (
    <main>
      <Cabecalho
        titulo="Estoque"
        meta="O saldo de cada item. Entra pela nota fiscal, pelo pedido ou à mão; sai sozinho quando o técnico registra o material usado na OS."
        acoes={
          <>
            <Link href="/estoque/movimentos" className="botao secundario">
              <ArrowLeftRight size={15} aria-hidden /> Movimentos
            </Link>
            <Link href="/estoque/entradas/nova#a-mao" className="botao secundario">
              <PencilLine size={15} aria-hidden /> Adicionar à mão
            </Link>
            <Link href="/estoque/entradas/nova" className="botao">
              <PackagePlus size={15} aria-hidden /> Nova entrada
            </Link>
          </>
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

      {itens.length > 0 && (
        <section className="indicadores indicadores-pagina" aria-label="Resumo do estoque">
          <Link href="/estoque" className="indicador">
            <span className="indicador-rotulo">Itens no estoque</span>
            <span className="indicador-valor">{ativos.length}</span>
            <span className="indicador-detalhe">{ativos.filter((i) => i.saldo > 0).length} com saldo</span>
          </Link>
          <Link href="/estoque?filtro=negativo" className={`indicador${negativos.length ? " tom-perigo" : ""}`}>
            <span className="indicador-rotulo">Negativos</span>
            <span className="indicador-valor">{negativos.length}</span>
            <span className="indicador-detalhe">usado na OS antes da nota entrar</span>
          </Link>
          <Link href="/estoque?filtro=baixo" className={`indicador${acabando.length ? " tom-atencao" : ""}`}>
            <span className="indicador-rotulo">Acabando</span>
            <span className="indicador-valor">{acabando.length}</span>
            <span className="indicador-detalhe">zerados ou abaixo do mínimo</span>
          </Link>
          <Link href="/estoque/entradas" className={`indicador${rascunhos ? " tom-atencao" : ""}`}>
            <span className="indicador-rotulo">Entradas a conferir</span>
            <span className="indicador-valor">{rascunhos}</span>
            <span className="indicador-detalhe">notas lidas esperando você</span>
          </Link>
        </section>
      )}

      <div className="pagina-corpo pilha">
        {itens.length === 0 ? (
          <section className="lista">
            <Vazio
              icone={<Package size={22} />}
              titulo="O estoque ainda está vazio"
              acao={
                <div className="es-barra-botoes">
                  <Link href="/estoque/entradas/nova#a-mao" className="botao secundario">
                    <PencilLine size={15} aria-hidden /> Adicionar à mão
                  </Link>
                  <Link href="/estoque/entradas/nova" className="botao">
                    <PackagePlus size={15} aria-hidden /> Lançar a primeira nota
                  </Link>
                </div>
              }
            >
              Mande o XML, o PDF ou a foto da nota fiscal (ou do pedido): o Selebi lê os itens, você confere e eles entram. Ou
              digite os itens à mão.
            </Vazio>
          </section>
        ) : (
          <section className="lista" id="lista" aria-label="Saldo por item">
            <div className="lista-barra">
              <form method="get" action="/estoque" className="campo-busca">
                <Search size={15} aria-hidden />
                {filtro && <input type="hidden" name="filtro" value={filtro} />}
                <input type="search" name="q" defaultValue={q} placeholder="Procurar item ou código" aria-label="Procurar item" />
              </form>
              <nav className="filtros" aria-label="Filtrar itens">
                {chip("", "Todos", ativos.length)}
                {chip("negativo", "Negativos", negativos.length, true)}
                {chip("baixo", "Acabando", acabando.length)}
                {inativos.length > 0 && chip("inativos", "Fora da lista", inativos.length)}
              </nav>
            </div>

            {filtrados.length === 0 ? (
              <Vazio titulo={q ? `Nada com “${q}”` : "Nenhum item aqui"}>
                {q ? "Confira a grafia ou procure pelo código do fornecedor." : "Bom sinal: nada nesta situação."}
              </Vazio>
            ) : (
              <div className="tabela-rolagem">
                <table className="tabela es-tabela-saldo">
                  <thead>
                    <tr>
                      <th>Item</th>
                      <th className="num">Saldo</th>
                      <th>
                        <span className="sr-only">Ações</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {pagina.itens.map((i) => {
                      const sit = SITUACAO[i.situacao];
                      const medida = i.minimo
                        ? Math.max(0, Math.min(100, (i.saldo / (i.minimo * 2)) * 100))
                        : null;
                      return (
                        <tr key={i.id} className={i.ativo ? "" : "linha-apagada"}>
                          <td>
                            <div className="es-item">
                              <strong>{i.nome}</strong>
                              {(i.codigo || i.modeloEquipamentoId || i.minimo !== null || i.ultimo) && (
                                <span className="es-item-meta">
                                  {i.ultimo && (
                                    <span>
                                      <Link href={`/estoque/movimentos?item=${i.id}`} className="es-meta-link">
                                        mexeu em {formatarInstante(i.ultimo, false)}
                                      </Link>
                                    </span>
                                  )}
                                  {i.codigo && <span>cód. {i.codigo}</span>}
                                  {i.modeloEquipamentoId && nomeDoModelo.has(i.modeloEquipamentoId) && (
                                    <span>catálogo: {nomeDoModelo.get(i.modeloEquipamentoId)}</span>
                                  )}
                                  {i.minimo !== null && (
                                    <span>
                                      mínimo {quantidadeLegivel(i.minimo)} {i.unidade}
                                    </span>
                                  )}
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="num">
                            <div className={`es-saldo${i.saldo < 0 ? " negativo" : ""}`}>
                              <span className="es-saldo-linha">
                                {sit && <span className={`pilula ${sit.classe}`}>{sit.rotulo}</span>}
                                <span className="es-saldo-valor">{quantidadeLegivel(i.saldo)}</span>
                                <span className="es-saldo-un">{i.unidade}</span>
                              </span>
                              {medida !== null && (
                                <span
                                  className={`es-medidor${i.saldo <= 0 ? " vazio" : i.situacao === "baixo" ? " baixo" : ""}`}
                                  role="img"
                                  aria-label={`${quantidadeLegivel(i.saldo)} de um mínimo de ${quantidadeLegivel(i.minimo)}`}
                                >
                                  <span style={{ width: `${medida}%` }} />
                                </span>
                              )}
                            </div>
                          </td>
                          <td>
                            <div className="es-acoes-linha">
                              <BotaoDialogo
                                key={`ajustar-${i.id}-${chave}`}
                                rotulo="Ajustar"
                                icone={<Scale size={14} aria-hidden />}
                                titulo={`Ajustar o saldo · ${i.nome}`}
                                descricao={`Hoje o sistema diz ${quantidadeLegivel(i.saldo)} ${i.unidade}. Digite quanto tem na prateleira: a diferença fica no histórico.`}
                              >
                                <form action={ajustarAction.bind(null, i.id)} className="form-ficha">
                                  <input type="hidden" name="volta" value={aqui} />
                                  <label>
                                    Quanto tem na prateleira ({i.unidade})
                                    <input name="contado" inputMode="decimal" required autoFocus defaultValue={quantidadeLegivel(Math.max(0, i.saldo))} />
                                  </label>
                                  <label>
                                    Motivo
                                    <input name="observacao" maxLength={300} placeholder="Contagem do fim do mês, perda, devolução…" />
                                  </label>
                                  <div className="dialogo-acoes">
                                    <button type="submit" className="botao">
                                      Ajustar saldo
                                    </button>
                                  </div>
                                </form>
                              </BotaoDialogo>
                              <BotaoDialogo
                                key={`editar-${i.id}-${chave}`}
                                rotulo="Editar"
                                icone={<Settings2 size={14} aria-hidden />}
                                titulo={`Editar · ${i.nome}`}
                                descricao="Nome, unidade, aviso de estoque baixo e ligação com o catálogo de equipamentos."
                              >
                                <form action={salvarItemAction.bind(null, i.id)} className="form-ficha">
                                  <input type="hidden" name="volta" value={aqui} />
                                  <label>
                                    Nome
                                    <input name="nome" defaultValue={i.nome} required maxLength={200} />
                                  </label>
                                  <div className="dupla">
                                    <label>
                                      Unidade
                                      <select name="unidade" defaultValue={i.unidade}>
                                        {[...new Set([i.unidade, ...UNIDADES])].map((u) => (
                                          <option key={u} value={u}>
                                            {u}
                                          </option>
                                        ))}
                                      </select>
                                    </label>
                                    <label>
                                      Avisar abaixo de
                                      <input
                                        name="minimo"
                                        inputMode="decimal"
                                        defaultValue={i.minimo === null ? "" : quantidadeLegivel(i.minimo)}
                                        placeholder="sem aviso"
                                      />
                                    </label>
                                  </div>
                                  <label>
                                    Modelo do catálogo
                                    <select name="modelo" defaultValue={i.modeloEquipamentoId ?? ""}>
                                      <option value="">— nenhum —</option>
                                      {modelos.map((m) => (
                                        <option key={m.id} value={m.id}>
                                          {m.fabricante} {m.modelo}
                                        </option>
                                      ))}
                                    </select>
                                  </label>
                                  <label className="linha-check">
                                    <input type="checkbox" name="ativo" defaultChecked={i.ativo} /> Na lista (o técnico pode escolher)
                                  </label>
                                  <div className="dialogo-acoes">
                                    <button type="submit" className="botao">
                                      Salvar
                                    </button>
                                  </div>
                                </form>
                              </BotaoDialogo>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <Paginacao {...pagina} href={(n) => endereco("/estoque", atuais, { pagina: n })} rotulo="itens" />
          </section>
        )}
      </div>
    </main>
  );
}
