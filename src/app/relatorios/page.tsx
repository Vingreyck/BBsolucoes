import { eq } from "drizzle-orm";
import { CheckCircle2, FileText, Info, Sun } from "lucide-react";
import { headers } from "next/headers";
import Link from "next/link";

import { db, schema } from "@/db";
import { haQuantoTempo, linkWhatsapp, numeroWhatsapp } from "@/documentos/cobranca";
import { relatoriosDoMes } from "@/geracao/dados";
import {
  mesAnterior,
  mesLegivel,
  mesValido,
  mensagemDoRelatorio,
  numeroBr,
  ultimoMesFechado,
} from "@/geracao/relatorio-mensal";
import { exigirGestaoWeb } from "@/os/acesso";

import { Cabecalho, Vazio } from "../_ui";
import { BotaoEnviar } from "./botao-enviar";

export const dynamic = "force-dynamic";

/**
 * O relatório mensal de geração de cada usina, pronto para mandar ao cliente.
 *
 * Um PDF de uma página por usina (quanto gerou, se foi o esperado para
 * Sergipe, o gráfico do mês) e um botão que abre o WhatsApp com o resumo e o
 * link. Cada envio fica anotado: a lista diz quem já recebeu o deste mês.
 *
 * Usina abaixo do esperado aparece marcada antes de ir para o cliente — é a
 * chance de olhar o que houve antes de ele perguntar.
 */
export default async function Relatorios({
  searchParams,
}: {
  searchParams: Promise<{ mes?: string; filtro?: string }>;
}) {
  const ator = await exigirGestaoWeb();
  const params = await searchParams;
  const mes = mesValido(params.mes) ? params.mes : ultimoMesFechado();
  const filtro = params.filtro ?? "";

  const [linhas, empresa, h] = await Promise.all([
    relatoriosDoMes(ator.empresaId, mes),
    db.query.empresa.findFirst({ where: eq(schema.empresa.id, ator.empresaId), columns: { nome: true } }),
    headers(),
  ]);
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "";
  const protocolo = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");

  const enviados = linhas.filter((l) => l.enviadoEm).length;
  const abaixo = linhas.filter((l) => l.resumo.faixa === "abaixo").length;
  const suspeitas = linhas.filter((l) => l.resumo.faixa === "suspeita").length;
  const visiveis = linhas
    .filter((l) =>
      filtro === "pendentes"
        ? !l.enviadoEm
        : filtro === "abaixo"
          ? l.resumo.faixa === "abaixo"
          : filtro === "potencia"
            ? l.resumo.faixa === "suspeita"
            : true,
    )
    // Abaixo do esperado primeiro (olhar antes de mandar), depois quem não recebeu.
    .sort(
      (a, b) =>
        Number(b.resumo.faixa === "abaixo") - Number(a.resumo.faixa === "abaixo") ||
        Number(b.resumo.faixa === "suspeita") - Number(a.resumo.faixa === "suspeita") ||
        Number(Boolean(a.enviadoEm)) - Number(Boolean(b.enviadoEm)) ||
        a.cliente.localeCompare(b.cliente),
    );

  const meses = [ultimoMesFechado()];
  for (let i = 0; i < 5; i++) meses.push(mesAnterior(meses[meses.length - 1]));
  const agora = new Date();
  const montar = (q: Record<string, string>) => {
    const p = new URLSearchParams(Object.entries(q).filter(([, v]) => v));
    return `/relatorios${p.size ? `?${p}` : ""}`;
  };

  return (
    <main>
      <Cabecalho
        titulo="Relatórios de geração"
        selos={<span className="ui-selo ui-selo-marca">{mesLegivel(mes)}</span>}
        meta={
          linhas.length ? (
            <span>
              {linhas.length} usinas com dados · {enviados} enviados
              {abaixo ? ` · ${abaixo} abaixo do esperado` : ""}
              {linhas[0]?.resumo.referencia
                ? ` · régua do mês: ${numeroBr(linhas[0].resumo.referencia, 1)} kWh/kWp/dia`
                : ""}
            </span>
          ) : undefined
        }
      />

      <div className="caixa-filtros">
        <div className="linha-filtro">
          <span className="rotulo-filtro">Mês</span>
          <nav className="filtros">
            {meses.map((m) => (
              <Link key={m} href={montar({ mes: m, filtro })} className={`filtro${m === mes ? " ativo" : ""}`}>
                {mesLegivel(m).replace(" de ", "/")}
              </Link>
            ))}
          </nav>
        </div>
        {linhas.length > 0 && (
          <div className="linha-filtro">
            <span className="rotulo-filtro">Mostrar</span>
            <nav className="filtros">
              <Link href={montar({ mes })} className={`filtro${filtro ? "" : " ativo"}`}>
                Todas ({linhas.length})
              </Link>
              <Link href={montar({ mes, filtro: "pendentes" })} className={`filtro${filtro === "pendentes" ? " ativo" : ""}`}>
                Não enviados ({linhas.length - enviados})
              </Link>
              {abaixo > 0 && (
                <Link
                  href={montar({ mes, filtro: "abaixo" })}
                  className={`filtro perigo${filtro === "abaixo" ? " ativo" : ""}`}
                >
                  Abaixo do esperado ({abaixo})
                </Link>
              )}
              {suspeitas > 0 && (
                <Link
                  href={montar({ mes, filtro: "potencia" })}
                  className={`filtro perigo${filtro === "potencia" ? " ativo" : ""}`}
                >
                  Potência a conferir ({suspeitas})
                </Link>
              )}
            </nav>
          </div>
        )}
      </div>

      <details className="como-ler">
        <summary>
          <Info size={15} aria-hidden /> Como o relatório avalia a usina
        </summary>
        <div>
          <p>
            <strong>Desempenho é kWh por kWp por dia, comparado com as outras usinas no mesmo mês.</strong> A régua é a
            mediana do parque: todas tiveram o mesmo sol. Abaixo de 75% dela, o relatório diz &quot;abaixo do
            esperado&quot; e a mensagem ao cliente avisa que a equipe vai verificar. Com menos de 7 dias de dado no mês,
            ele não avalia.
          </p>
          <p>
            <strong>Potência a conferir</strong> é usina que, pela potência cadastrada, teria gerado mais de 8 kWh por
            kWp por dia — impossível. É o cadastro que está errado (7 kWp gravado como 0,007). O relatório dela sai sem
            avaliação de desempenho até a potência ser corrigida.
          </p>
          <p>
            <strong>Dia sem dado não é dia sem geração.</strong> Quando o portal do fabricante não entrega um dia
            (geralmente a internet do inversor), o relatório conta à parte e calcula a média só com os dias que chegaram.
          </p>
          <p>
            <strong>O PDF é gerado na hora.</strong> Se o portal entregar um dia atrasado, o mesmo link já mostra o número
            novo. Só aparecem usinas ligadas a um cliente — as sem dono ficam em Monitoramento → Sem dono.
          </p>
        </div>
      </details>

      {linhas.length === 0 ? (
        <div className="pagina-corpo">
          <Vazio icone={<Sun size={20} />} titulo={`Nenhuma usina com dados em ${mesLegivel(mes)}`}>
            O relatório usa as leituras diárias que a coleta trouxe dos portais. Confira a tela de Coleta se o mês
            deveria ter dados.
          </Vazio>
        </div>
      ) : (
        <div className="tabela-wrap">
          <table className="tabela tabela-cobranca">
            <thead>
              <tr>
                <th>Cliente</th>
                <th>Gerado</th>
                <th>Desempenho</th>
                <th>Envio</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {visiveis.map((l) => {
                const r = l.resumo;
                const linkPdf = `${protocolo}://${host}/r/g/${l.token}`;
                const numero = numeroWhatsapp(l.telefone);
                const texto = mensagemDoRelatorio({
                  cliente: l.cliente,
                  empresa: empresa?.nome ?? "nossa empresa",
                  mes,
                  resumo: r,
                  link: linkPdf,
                });
                const variacao =
                  l.totalMesAnterior && l.totalMesAnterior > 0
                    ? ((r.totalKwh - l.totalMesAnterior) / l.totalMesAnterior) * 100
                    : null;
                return (
                  <tr key={l.usinaId}>
                    <td className="forte">
                      {l.cliente}
                      <div className="fraco">
                        {l.usina}
                        {l.potenciaKwp ? ` · ${numeroBr(l.potenciaKwp, 2)} kWp` : ""}
                      </div>
                    </td>
                    <td>
                      <strong>{numeroBr(r.totalKwh)} kWh</strong>
                      <div className="fraco">
                        {variacao !== null ? `${variacao >= 0 ? "+" : ""}${numeroBr(variacao, 0)}% no mês` : "sem mês anterior"}
                        {r.diasSemDado > 0 ? ` · ${r.diasSemDado} dias sem dado` : ""}
                      </div>
                    </td>
                    <td>
                      {r.faixa === "abaixo" ? (
                        <span className="pilula sev-critico">abaixo do esperado</span>
                      ) : r.faixa === "suspeita" ? (
                        <span className="pilula sev-atencao">potência a conferir</span>
                      ) : r.faixa ? (
                        <span className="pilula sev-info">normal</span>
                      ) : (
                        <span className="fraco">{l.potenciaKwp ? "poucos dias" : "sem potência"}</span>
                      )}
                      {r.kwhPorKwpDia !== null && <div className="fraco">{numeroBr(r.kwhPorKwpDia, 1)} kWh/kWp/dia</div>}
                      {l.alertas > 0 && <div className="fraco">{l.alertas} ocorrência{l.alertas > 1 ? "s" : ""}</div>}
                    </td>
                    <td className="fraco">
                      {l.enviadoEm ? (
                        <>
                          <CheckCircle2 size={13} aria-hidden /> {haQuantoTempo(l.enviadoEm, agora)}
                          {l.enviadoPor ? ` · ${l.enviadoPor.split(" ")[0]}` : ""}
                        </>
                      ) : (
                        "não enviado"
                      )}
                    </td>
                    <td>
                      <div className="botoes-linha">
                        <a href={linkPdf} target="_blank" rel="noreferrer" className="botao secundario">
                          <FileText size={15} aria-hidden /> PDF
                        </a>
                        {numero ? (
                          <BotaoEnviar
                            usinaId={l.usinaId}
                            mes={mes}
                            link={linkWhatsapp(numero, texto)}
                            jaEnviado={Boolean(l.enviadoEm)}
                          />
                        ) : (
                          <span className="fraco">sem telefone</span>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
