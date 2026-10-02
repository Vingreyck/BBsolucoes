import { and, asc, eq } from "drizzle-orm";
import { ListChecks, Plus, Settings2 } from "lucide-react";
import { notFound, redirect } from "next/navigation";

import { exigirUsuario } from "@/auth/sessao";
import { db, schema } from "@/db";
import { garantirModelos } from "@/os/modelos";
import { TIPO_RESPOSTA_ROTULO, TIPO_ROTULO, TIPOS_RESPOSTA, type TipoOs, type TipoResposta } from "@/os/tipos";

import { Cabecalho, Cartao, Vazio } from "../../../_ui";
import { moverItem, removerItem, salvarItem, salvarModelo } from "../actions";

export const dynamic = "force-dynamic";

/** Os tipos de documento que fazem sentido para uma foto tirada em OS. */
const DOCUMENTO_DA_FOTO: Record<string, string> = {
  foto_padrao: "Foto do padrão (dossiê)",
  comprovante: "Comprovante",
  nota_fiscal: "Nota fiscal",
  datasheet: "Datasheet e Inmetro",
  declaracao: "Declaração",
  outro: "Outro",
};

type ItemModelo = typeof schema.modeloOsItem.$inferSelect;

function CamposItem({ item }: { item?: ItemModelo }) {
  return (
    <>
      <div className="dupla">
        <label>
          Descrição <span className="req">*</span>
          <input type="text" name="descricao" defaultValue={item?.descricao ?? ""} required maxLength={300} />
        </label>
        <label>
          Seção
          <input type="text" name="secao" defaultValue={item?.secao ?? ""} maxLength={80} placeholder="Ex.: Padrão de entrada" />
        </label>
      </div>
      <div className="dupla">
        <label>
          Como responde
          <select name="tipoResposta" defaultValue={item?.tipoResposta ?? "check"}>
            {TIPOS_RESPOSTA.map((t) => (
              <option key={t} value={t}>
                {TIPO_RESPOSTA_ROTULO[t]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Unidade (se número)
          <input type="text" name="unidade" defaultValue={item?.unidade ?? ""} maxLength={20} placeholder="A, mm², kWh…" />
        </label>
        <label>
          Fotos mínimas
          <input type="number" name="fotosMinimas" min={0} max={20} defaultValue={item?.fotosMinimas ?? 0} />
        </label>
      </div>
      <label>
        Opções (uma por linha — para “uma opção” ou “várias opções”)
        <textarea name="opcoes" rows={3} defaultValue={(item?.opcoes ?? []).join("\n")} />
      </label>
      <label>
        Ajuda para o técnico
        <input type="text" name="ajuda" defaultValue={item?.ajuda ?? ""} maxLength={600} placeholder="O que olhar, como fotografar" />
      </label>
      <div className="dupla">
        <label>
          A foto vira documento do dossiê
          <select name="tipoDocumento" defaultValue={item?.tipoDocumento ?? ""}>
            <option value="">Não</option>
            {Object.entries(DOCUMENTO_DA_FOTO).map(([v, r]) => (
              <option key={v} value={v}>
                {r}
              </option>
            ))}
          </select>
        </label>
        <label>
          Chave (para cruzar com o projeto)
          <input type="text" name="chave" defaultValue={item?.chave ?? ""} maxLength={60} placeholder="disjuntor_amperagem" />
        </label>
      </div>
      <div className="linha-radios">
        <label>
          <input type="checkbox" name="obrigatorio" value="sim" defaultChecked={item?.obrigatorio ?? false} /> Obrigatório
          (trava a conclusão)
        </label>
        <label>
          <input type="checkbox" name="apenasCamera" value="sim" defaultChecked={item?.apenasCamera ?? false} /> Só foto
          tirada na hora (no app)
        </label>
      </div>
    </>
  );
}

export default async function EditarModelo({
  params,
  searchParams,
}: {
  params: Promise<{ tipo: string }>;
  searchParams: Promise<{ ok?: string; erro?: string }>;
}) {
  const usuario = await exigirUsuario();
  if (usuario.papel !== "adm") redirect("/sem-acesso");
  const { tipo } = await params;
  const { ok, erro } = await searchParams;
  if (!(schema.tipoOs.enumValues as readonly string[]).includes(tipo)) notFound();
  await garantirModelos(usuario.empresaId);

  const [modelo, etapas] = await Promise.all([
    db.query.modeloOs.findFirst({
      where: and(eq(schema.modeloOs.empresaId, usuario.empresaId), eq(schema.modeloOs.tipo, tipo as TipoOs)),
      with: { itens: { orderBy: asc(schema.modeloOsItem.ordem) } },
    }),
    db.query.etapa.findMany({
      where: and(eq(schema.etapa.empresaId, usuario.empresaId), eq(schema.etapa.ativa, true)),
      columns: { slug: true, nome: true },
      orderBy: asc(schema.etapa.ordem),
    }),
  ]);
  if (!modelo) notFound();

  return (
    <main>
      <Cabecalho
        trilha={[{ href: "/administracao/modelos", rotulo: "Modelos de OS" }]}
        titulo={modelo.nome}
        meta={
          <>
            <span>Modelo de OS · {TIPO_ROTULO[modelo.tipo]}</span>
            <span>{modelo.itens.length} itens no checklist</span>
          </>
        }
      />
      {ok && <p className="aviso ok">{ok}</p>}
      {erro && (
        <p className="aviso erro" role="alert">
          {erro}
        </p>
      )}

      <div className="registro-grade">
        <div className="registro-principal">
          <Cartao titulo="Checklist" icone={<ListChecks size={16} />} contador={`${modelo.itens.length} itens`}>
            {modelo.itens.length === 0 ? (
              <Vazio icone={<ListChecks size={20} />} titulo="Nenhum item ainda">
                Acrescente o primeiro no cartão abaixo.
              </Vazio>
            ) : (
              <ol className="itens-modelo">
                {modelo.itens.map((item, i) => (
                  <li key={item.id} id={`item-${item.id}`}>
                    <div className="item-topo">
                      <span className="item-ordem">{i + 1}</span>
                      <span className="item-nome">{item.descricao}</span>
                      {item.secao && <span className="fraco">{item.secao}</span>}
                      <span className="pilula">
                        {TIPO_RESPOSTA_ROTULO[item.tipoResposta as TipoResposta] ?? item.tipoResposta}
                      </span>
                      {item.obrigatorio && <span className="obrigatorio">obrigatório</span>}
                      {item.fotosMinimas > 0 && <span className="fraco">{item.fotosMinimas} foto(s)</span>}
                      {item.tipoDocumento && <span className="fraco">→ dossiê</span>}
                      <span className="mover">
                        <form action={moverItem.bind(null, modelo.tipo, item.id, "subir")}>
                          <button type="submit" disabled={i === 0} aria-label="Subir">
                            ↑
                          </button>
                        </form>
                        <form action={moverItem.bind(null, modelo.tipo, item.id, "descer")}>
                          <button type="submit" disabled={i === modelo.itens.length - 1} aria-label="Descer">
                            ↓
                          </button>
                        </form>
                      </span>
                    </div>
                    <details className="dobra">
                      <summary>Editar</summary>
                      <form action={salvarItem.bind(null, modelo.tipo, item.id)} className="form-ficha compacto">
                        <CamposItem item={item} />
                        <div className="ficha-acoes">
                          <button type="submit">Salvar item</button>
                        </div>
                      </form>
                      <form action={removerItem.bind(null, modelo.tipo, item.id)} className="form-mini">
                        <button type="submit" className="link-perigo">
                          tirar este item do modelo
                        </button>
                      </form>
                    </details>
                  </li>
                ))}
              </ol>
            )}
          </Cartao>

          <Cartao titulo="Acrescentar item" icone={<Plus size={16} />} id="novo">
            <form action={salvarItem.bind(null, modelo.tipo, null)} className="form-ficha">
              <CamposItem />
              <div className="ficha-acoes">
                <button type="submit">Acrescentar</button>
              </div>
            </form>
          </Cartao>
        </div>

        <aside className="registro-lateral">
          <Cartao
            titulo="Regras do modelo"
            icone={<Settings2 size={16} />}
            ajuda="Com uma etapa escolhida: quando a OS é concluída como resolvida e o projeto dela está parado nessa etapa, o projeto anda para a próxima sozinho, e o histórico diz qual OS o moveu."
          >
            <form action={salvarModelo.bind(null, modelo.tipo)} className="form-ficha">
              <label>
                Nome
                <input type="text" name="nome" defaultValue={modelo.nome} required maxLength={120} />
              </label>
              <label>
                Prazo (horas desde a abertura)
                <input
                  type="number"
                  name="prazoHoras"
                  min={1}
                  max={8760}
                  defaultValue={modelo.prazoHoras ?? ""}
                  placeholder="sem prazo"
                />
              </label>
              <label>
                Concluir anda a esteira de
                <select name="etapaSlug" defaultValue={modelo.etapaSlug ?? ""}>
                  <option value="">Nenhuma etapa</option>
                  {etapas.map((e) => (
                    <option key={e.slug} value={e.slug}>
                      {e.nome}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Instruções para o técnico
                <textarea name="instrucoes" rows={3} defaultValue={modelo.instrucoes ?? ""} maxLength={2000} />
              </label>
              <label className="linha-check">
                <input type="checkbox" name="exigeAssinatura" value="sim" defaultChecked={modelo.exigeAssinatura} /> Exige a
                assinatura do cliente para concluir como resolvido
              </label>
              <div className="ficha-acoes">
                <button type="submit">Salvar regras</button>
              </div>
            </form>
          </Cartao>
        </aside>
      </div>
    </main>
  );
}
