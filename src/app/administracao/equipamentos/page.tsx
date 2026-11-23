import { and, asc, eq } from "drizzle-orm";
import { Check, Cpu, Database, FileSpreadsheet, FileText, Plus, Search, SunMedium } from "lucide-react";
import { redirect } from "next/navigation";

import { exigirUsuario } from "@/auth/sessao";
import { db, schema } from "@/db";
import { driveConfigurado } from "@/documentos/drive";
import { baseDeEquipamentos, procurarNaBase } from "@/equipamentos/base";
import type { TipoDeEquipamento } from "@/equipamentos/regras";
import { potenciaLegivel } from "@/projeto/kit";

import { Cabecalho, Cartao, Vazio } from "../../_ui";
import { adicionarDaBase, alternarModelo, criarModelo, enviarArquivosDoModelo, importarPlanilhaDePrecos, salvarPrecoDeCusto } from "./actions";

export const dynamic = "force-dynamic";

const TIPO_ROTULO: Record<string, string> = {
  inversor: "Inversor",
  microinversor: "Microinversor",
  modulo: "Módulo",
};

/**
 * O catálogo de equipamentos: cada inversor e módulo que a empresa vende, com
 * o datasheet e o certificado do Inmetro do fabricante.
 *
 * Sobe uma vez aqui e pronto: o projeto escolhe o inversor e o módulo do kit,
 * e o dossiê de cada cliente recebe os dois PDFs sozinho.
 */
export default async function Equipamentos({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; erro?: string; q?: string; tipo?: string }>;
}) {
  const usuario = await exigirUsuario();
  if (usuario.papel !== "adm" && usuario.papel !== "engenheiro") redirect("/sem-acesso");
  const { ok, erro, q, tipo: tipoBusca } = await searchParams;
  const tiposDaBusca: TipoDeEquipamento[] =
    tipoBusca === "modulo" || tipoBusca === "inversor" || tipoBusca === "microinversor" ? [tipoBusca] : ["modulo", "inversor", "microinversor"];
  const achados = procurarNaBase(q ?? "", tiposDaBusca, 25);
  const base = baseDeEquipamentos();
  const semDrive = !driveConfigurado();

  const modelos = await db
    .select()
    .from(schema.modeloEquipamento)
    .where(and(eq(schema.modeloEquipamento.empresaId, usuario.empresaId)))
    .orderBy(asc(schema.modeloEquipamento.fabricante), asc(schema.modeloEquipamento.modelo));

  const inversores = modelos.filter((m) => m.tipo !== "modulo");
  const modulos = modelos.filter((m) => m.tipo === "modulo");
  const semArquivo = modelos.filter((m) => m.ativo && (!m.datasheetLink || !m.inmetroLink)).length;

  const tabela = (lista: typeof modelos) => (
    <div className="tabela-wrap tabela-no-cartao">
      <table className="tabela">
        <thead>
          <tr>
            <th>Modelo</th>
            <th>Custo (R$)</th>
            <th>Datasheet</th>
            <th>Inmetro</th>
            <th></th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {lista.map((m) => {
            const pot = potenciaLegivel(m.potenciaW, m.tipo);
            return (
              <tr key={m.id} className={m.ativo ? "" : "linha-apagada"}>
                <td>
                  <strong>
                    {m.fabricante} {m.modelo}
                  </strong>
                  <small className="fraco">
                    {" "}
                    · {TIPO_ROTULO[m.tipo] ?? m.tipo}
                    {pot ? ` · ${pot}` : ""}
                    {m.ativo ? "" : " · fora da lista"}
                  </small>
                </td>
                <td>
                  <form action={salvarPrecoDeCusto.bind(null, m.id)} className="grupo-botoes">
                    <input
                      name="precoCusto"
                      inputMode="decimal"
                      aria-label={`Custo de ${m.fabricante} ${m.modelo}`}
                      defaultValue={m.precoCusto ? Number(m.precoCusto).toLocaleString("pt-BR", { minimumFractionDigits: 2 }) : ""}
                      placeholder="—"
                      style={{ width: 100 }}
                    />
                    <button type="submit" className="link-acao" aria-label="Guardar o custo">
                      <Check size={13} aria-hidden />
                    </button>
                  </form>
                </td>
                <td>
                  {m.datasheetLink ? (
                    <a className="link-acao" href={`/administracao/equipamentos/arquivo/${m.id}?qual=datasheet`} target="_blank" rel="noreferrer">
                      <FileText size={13} aria-hidden /> abrir
                    </a>
                  ) : (
                    <span className="pilula sev-atencao">falta</span>
                  )}
                </td>
                <td>
                  {m.inmetroLink ? (
                    <a className="link-acao" href={`/administracao/equipamentos/arquivo/${m.id}?qual=inmetro`} target="_blank" rel="noreferrer">
                      <FileText size={13} aria-hidden /> abrir
                    </a>
                  ) : (
                    <span className="pilula sev-atencao">falta</span>
                  )}
                </td>
                <td>
                  <details className="dobra-limpa">
                    <summary>{m.datasheetLink && m.inmetroLink ? "Trocar PDF" : "Enviar PDF"}</summary>
                    <form action={enviarArquivosDoModelo.bind(null, m.id)} className="form-ficha">
                      <label>
                        Datasheet
                        <input type="file" name="datasheet" accept="application/pdf" disabled={semDrive} />
                      </label>
                      <label>
                        Certificado do Inmetro
                        <input type="file" name="inmetro" accept="application/pdf" disabled={semDrive} />
                      </label>
                      <button type="submit" className="botao" disabled={semDrive}>
                        <Check size={14} aria-hidden /> Enviar
                      </button>
                    </form>
                  </details>
                </td>
                <td>
                  <form action={alternarModelo.bind(null, m.id)}>
                    <button type="submit" className="link-acao">
                      {m.ativo ? "Tirar da lista" : "Voltar à lista"}
                    </button>
                  </form>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );

  return (
    <main>
      <Cabecalho
        titulo="Equipamentos"
        selos={semArquivo > 0 ? <span className="pilula sev-atencao">{semArquivo} sem datasheet ou Inmetro</span> : undefined}
        meta="Cada inversor e módulo que a empresa vende, com o datasheet e o Inmetro do fabricante. O dossiê de cada projeto recebe os dois sozinho, pelo kit escolhido."
      />

      {ok && (
        <p className="aviso ok" role="status">
          {ok}
        </p>
      )}
      {erro && (
        <p className="aviso erro" role="alert">
          {erro}
        </p>
      )}
      {semDrive && (
        <p className="aviso">
          <strong>O Drive não está conectado neste servidor.</strong> Dá para cadastrar os modelos, mas os PDFs só
          sobem depois de conectar o Drive.
        </p>
      )}

      <div className="pagina-corpo pilha">
        <Cartao
          titulo="Base de equipamentos"
          icone={<Database size={16} />}
          contador={base.itens.length.toLocaleString("pt-BR")}
          ajuda={`Os módulos, inversores e microinversores instalados no Brasil, dos cadastros públicos da ANEEL (licença ODbL), com a potência, as fases, quantos módulos cada micro recebe e quantas usinas usam cada um (desde 2023). Gerada em ${base.geradoEm.split("-").reverse().join("/")}. O assistente da proposta busca aqui sozinho; adicionar ao catálogo serve para guardar o preço de custo, o datasheet e o Inmetro.`}
        >
          <form className="form-ficha" method="get">
            <div className="dupla">
              <label>
                Procurar
                <input name="q" defaultValue={q ?? ""} placeholder="jinko 585, min 5000, hms 2000, deye…" />
              </label>
              <label>
                Tipo
                <select name="tipo" defaultValue={tipoBusca ?? ""}>
                  <option value="">Todos</option>
                  <option value="modulo">Módulo</option>
                  <option value="inversor">Inversor</option>
                  <option value="microinversor">Microinversor</option>
                </select>
              </label>
            </div>
            <div className="ficha-acoes">
              <button type="submit" className="botao secundario">
                <Search size={15} aria-hidden /> Procurar
              </button>
            </div>
          </form>
          <div className="tabela-wrap tabela-no-cartao">
            <table className="tabela">
              <thead>
                <tr>
                  <th>Modelo</th>
                  <th>Usinas desde 2023</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {achados.map((i) => {
                  const noCatalogo = modelos.some((m) => m.baseId === i.id);
                  return (
                    <tr key={i.id}>
                      <td>
                        <strong>
                          {i.fabricante} {i.modelo}
                        </strong>
                        <small className="fraco">
                          {" "}
                          · {TIPO_ROTULO[i.tipo] ?? i.tipo} · {potenciaLegivel(i.potenciaW, i.tipo)}
                          {i.fases ? ` · ${i.fases === 1 ? "monofásico" : "trifásico"}` : ""}
                          {i.modulosPorUnidade ? ` · ${i.modulosPorUnidade} módulos por micro` : ""}
                          {i.eletrico ? ` · Voc ${i.eletrico.vocV.toLocaleString("pt-BR")} V, Isc ${i.eletrico.iscA.toLocaleString("pt-BR")} A` : ""}
                        </small>
                      </td>
                      <td>
                        {i.uso.brasil.toLocaleString("pt-BR")} no Brasil{i.uso.sergipe ? ` · ${i.uso.sergipe.toLocaleString("pt-BR")} em SE` : ""}
                      </td>
                      <td>
                        {noCatalogo ? (
                          <span className="ap-selo ap-selo-catalogo">no catálogo</span>
                        ) : (
                          <form action={adicionarDaBase.bind(null, i.id)}>
                            <button type="submit" className="link-acao">
                              <Plus size={13} aria-hidden /> Adicionar
                            </button>
                          </form>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Cartao>

        <Cartao
          titulo="Importar preços do distribuidor"
          icone={<FileSpreadsheet size={16} />}
          ajuda="A planilha (XLSX ou CSV) com uma coluna de modelo e uma de preço no cabeçalho; fabricante, tipo e potência ajudam. O preço de cada modelo do catálogo é atualizado; o que está na base da ANEEL e ainda não está no catálogo entra nele. É o custo que o assistente usa para montar o preço."
        >
          <form action={importarPlanilhaDePrecos} className="form-ficha">
            <label>
              Planilha
              <input type="file" name="planilha" accept=".xlsx,.csv,text/csv" required />
            </label>
            <div className="ficha-acoes">
              <button type="submit" className="botao secundario">
                <FileSpreadsheet size={15} aria-hidden /> Importar
              </button>
            </div>
          </form>
        </Cartao>

        <Cartao
          titulo="Novo modelo"
          icone={<Plus size={16} />}
          ajuda="Para o que não está na base da ANEEL (lançamento recente). O datasheet e o certificado do Inmetro ficam no site do fabricante (área de downloads) e no site do Inmetro. Pode cadastrar agora e subir os PDFs depois."
        >
          <form action={criarModelo} className="form-ficha">
            <div className="dupla">
              <label>
                Tipo <span className="req">*</span>
                <select name="tipo" required defaultValue="inversor">
                  <option value="inversor">Inversor</option>
                  <option value="microinversor">Microinversor</option>
                  <option value="modulo">Módulo</option>
                </select>
              </label>
              <label>
                Fabricante <span className="req">*</span>
                <input name="fabricante" required placeholder="Growatt, Jinko, Canadian…" />
              </label>
              <label>
                Modelo <span className="req">*</span>
                <input name="modelo" required placeholder="MIN 10000TL-X, Tiger Neo 625W…" />
              </label>
              <label>
                Potência (W)
                <input name="potenciaW" inputMode="decimal" placeholder="10000 ou 625" />
              </label>
            </div>
            <div className="dupla">
              <label>
                Datasheet <span className="fraco">(PDF)</span>
                <input type="file" name="datasheet" accept="application/pdf" disabled={semDrive} />
              </label>
              <label>
                Certificado do Inmetro <span className="fraco">(PDF)</span>
                <input type="file" name="inmetro" accept="application/pdf" disabled={semDrive} />
              </label>
            </div>
            <div className="ficha-acoes">
              <button type="submit" className="botao">
                <Plus size={15} aria-hidden /> Cadastrar
              </button>
            </div>
          </form>
        </Cartao>

        <Cartao titulo="Inversores" icone={<Cpu size={16} />} contador={inversores.length}>
          {inversores.length ? tabela(inversores) : <Vazio icone={<Cpu size={20} />} titulo="Nenhum inversor cadastrado" />}
        </Cartao>

        <Cartao titulo="Módulos" icone={<SunMedium size={16} />} contador={modulos.length}>
          {modulos.length ? tabela(modulos) : <Vazio icone={<SunMedium size={20} />} titulo="Nenhum módulo cadastrado" />}
        </Cartao>
      </div>
    </main>
  );
}
