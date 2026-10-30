import { eq } from "drizzle-orm";
import { CheckCircle2, Info, MessageCircle } from "lucide-react";
import Link from "next/link";

import { exigirAcessoDocumentos } from "@/auth/permissao";
import { db, schema } from "@/db";
import { diasEntre, haQuantoTempo, linkWhatsapp, mensagemDeCobranca, ROTULO_PEDIDO } from "@/documentos/cobranca";
import { filaDeCobranca, ordenarFila } from "@/documentos/fila-cobranca";

import { Cabecalho, Vazio } from "../../_ui";
import { salvarTelefone } from "../actions";
import { BotaoCobrar } from "./botao-cobrar";

export const dynamic = "force-dynamic";

/**
 * A fila de cobrança: quem deve documento, de quê, e um botão que abre o
 * WhatsApp com a mensagem pronta.
 *
 * A tela de dossiês mostra o gargalo ("a foto do padrão segura 70 vendas");
 * esta é a tarde de trabalho que resolve o gargalo. Cada mensagem pede tudo o
 * que aquele cliente deve de uma vez — ninguém quer receber três mensagens da
 * mesma empresa no mesmo dia —, e cada envio fica anotado com quem e quando,
 * para o próximo da equipe não cobrar de novo quem acabou de ser cobrado.
 */
export default async function Cobranca({ searchParams }: { searchParams: Promise<{ tipo?: string }> }) {
  const acesso = await exigirAcessoDocumentos();
  const { tipo = "" } = await searchParams;
  const empresaId = acesso.usuario.empresaId;

  const [fila, empresa] = await Promise.all([
    filaDeCobranca(empresaId, { pode: acesso.pode }),
    db.query.empresa.findFirst({ where: eq(schema.empresa.id, empresaId), columns: { nome: true } }),
  ]);

  const porTipo = new Map<string, number>();
  for (const l of fila) for (const t of l.tipos) porTipo.set(t, (porTipo.get(t) ?? 0) + 1);
  const tipos = [...porTipo].sort((a, b) => b[1] - a[1]);

  const linhas = ordenarFila(tipo ? fila.filter((l) => l.tipos.includes(tipo)) : fila);
  const semTelefone = fila.filter((l) => !l.whatsapp).length;
  const agora = new Date();

  return (
    <main>
      <Cabecalho
        trilha={[{ href: "/documentos", rotulo: "Dossiês" }]}
        titulo="Cobrar documentos"
        selos={fila.length > 0 ? <span className="pilula sev-atencao">{fila.length} clientes devendo</span> : undefined}
        meta={
          <span>
            Só o que é do cliente mandar. ART, memorial e projeto são da equipe e ficam na tela de dossiês.
          </span>
        }
      />

      {fila.length === 0 ? (
        <div className="pagina-corpo">
          <Vazio icone={<CheckCircle2 size={20} />} titulo="Nenhum cliente devendo documento">
            Todos os dossiês em andamento têm o que o cliente precisava mandar até a etapa em que estão.
          </Vazio>
        </div>
      ) : (
        <>
          <div className="caixa-filtros">
            <div className="linha-filtro">
              <span className="rotulo-filtro">Falta</span>
              <nav className="filtros">
                <Link href="/documentos/cobranca" className={`filtro${tipo ? "" : " ativo"}`}>
                  Tudo ({fila.length})
                </Link>
                {tipos.map(([t, n]) => (
                  <Link
                    key={t}
                    href={`/documentos/cobranca?tipo=${t}`}
                    className={`filtro${tipo === t ? " ativo" : ""}`}
                    aria-current={tipo === t ? "page" : undefined}
                  >
                    {ROTULO_PEDIDO[t] ?? t} ({n})
                  </Link>
                ))}
              </nav>
            </div>
          </div>

          <details className="como-ler">
            <summary>
              <Info size={15} aria-hidden /> Como a fila funciona
            </summary>
            <div>
              <p>
                <strong>Uma mensagem por cliente, com tudo o que ele deve.</strong> O botão abre o WhatsApp com o texto
                pronto — dá para mexer antes de enviar. Quem já foi cobrado recebe um &quot;passando para lembrar&quot;
                em vez da mesma mensagem de novo.
              </p>
              <p>
                <strong>A ordem é de propósito.</strong> Primeiro quem nunca foi cobrado, depois quem foi cobrado há
                mais tempo. Quem foi cobrado nos últimos dois dias vai para o fim: o cliente pode estar juntando os
                papéis. Quando o documento chega e é anexado ao dossiê, o cliente sai da fila sozinho.
              </p>
              {semTelefone > 0 && (
                <p>
                  <strong>{semTelefone} sem telefone válido no cadastro.</strong> Dá para preencher ali mesmo, na
                  linha do cliente.
                </p>
              )}
            </div>
          </details>

          <div className="tabela-wrap">
            <table className="tabela tabela-cobranca">
              <thead>
                <tr>
                  <th>Cliente</th>
                  <th>Falta mandar</th>
                  <th>Etapa</th>
                  <th>Última cobrança</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {linhas.map((l) => {
                  const recente =
                    l.ultimaCobranca && agora.getTime() - l.ultimaCobranca.quando.getTime() < 2 * 86_400_000;
                  const texto = mensagemDeCobranca({
                    cliente: l.cliente,
                    empresa: empresa?.nome ?? "nossa empresa",
                    tipos: l.tipos,
                    jaCobrado: l.vezes > 0,
                  });
                  return (
                    <tr key={l.projetoId} className={recente ? "linha-esmaecida" : undefined}>
                      <td className="forte">
                        <Link href={`/documentos/${l.projetoId}`}>{l.cliente}</Link>
                        <div className="fraco">{l.telefone ?? "sem telefone"}</div>
                      </td>
                      <td>
                        {l.tipos.map((t) => (
                          <span key={t} className="pilula sev-critico">
                            {ROTULO_PEDIDO[t] ?? t}
                          </span>
                        ))}
                      </td>
                      <td className="fraco">
                        {l.etapa}
                        {l.etapaDesde && <div>{naEtapa(diasEntre(l.etapaDesde, agora))}</div>}
                      </td>
                      <td className="fraco">
                        {l.ultimaCobranca ? (
                          <>
                            {haQuantoTempo(l.ultimaCobranca.quando, agora)}
                            {l.ultimaCobranca.por && ` · ${l.ultimaCobranca.por.split(" ")[0]}`}
                            {l.vezes > 1 && <div>{l.vezes}ª vez</div>}
                          </>
                        ) : (
                          "nunca"
                        )}
                      </td>
                      <td>
                        {l.whatsapp ? (
                          <BotaoCobrar
                            projetoId={l.projetoId}
                            link={linkWhatsapp(l.whatsapp, texto)}
                            rotulo={l.vezes > 0 ? "Lembrar" : "Cobrar"}
                          />
                        ) : (
                          <form action={salvarTelefone.bind(null, l.clienteId)} className="form-telefone">
                            <input
                              name="telefone"
                              inputMode="tel"
                              placeholder="(79) 99999-1234"
                              aria-label={`Telefone de ${l.cliente}`}
                              required
                              minLength={10}
                              maxLength={20}
                            />
                            <button type="submit" className="botao secundario">
                              Salvar
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

          {linhas.length === 0 && (
            <div className="pagina-corpo">
              <Vazio icone={<MessageCircle size={20} />} titulo="Ninguém deve esse documento" />
            </div>
          )}
        </>
      )}
    </main>
  );
}

function naEtapa(dias: number): string {
  if (dias === 0) return "entrou hoje";
  return dias === 1 ? "há 1 dia nela" : `há ${dias} dias nela`;
}
