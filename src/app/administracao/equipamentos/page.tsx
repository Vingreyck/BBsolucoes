import { and, asc, eq } from "drizzle-orm";
import { Check, Cpu, FileText, Plus, SunMedium } from "lucide-react";
import { redirect } from "next/navigation";

import { exigirUsuario } from "@/auth/sessao";
import { db, schema } from "@/db";
import { driveConfigurado } from "@/documentos/drive";
import { potenciaLegivel } from "@/projeto/kit";

import { Cabecalho, Cartao, Vazio } from "../../_ui";
import { alternarModelo, criarModelo, enviarArquivosDoModelo } from "./actions";

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
  searchParams: Promise<{ ok?: string; erro?: string }>;
}) {
  const usuario = await exigirUsuario();
  if (usuario.papel !== "adm" && usuario.papel !== "engenheiro") redirect("/sem-acesso");
  const { ok, erro } = await searchParams;
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
          titulo="Novo modelo"
          icone={<Plus size={16} />}
          ajuda="O datasheet e o certificado do Inmetro ficam no site do fabricante (área de downloads) e no site do Inmetro. Pode cadastrar agora e subir os PDFs depois."
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
