import { asc, eq, sql } from "drizzle-orm";
import { AlertTriangle, Info } from "lucide-react";

import { exigirUsuario } from "@/auth/sessao";
import { db, schema } from "@/db";

import { Cabecalho, Dados } from "../_ui";

export const dynamic = "force-dynamic";

/**
 * Saúde da coleta: um portal por linha, e a verdade sobre cada um.
 *
 * Existe por um motivo medido, não imaginado. Em 22/09/2026 o sistema estava
 * **onze dias sem coletar nada** e ninguém percebeu: os coletores funcionavam,
 * a tela de usinas mostrava números, e os números eram de 11 de setembro. Só
 * uma consulta SQL revelava isso.
 *
 * Dado velho é pior que dado ausente. Uma usina que parou de gerar há dez dias
 * aparece "gerando" na tela se ninguém olhar a data da última leitura — e o
 * alerta que deveria ter aberto não abriu, porque não houve leitura nova para
 * disparar a detecção.
 *
 * A pergunta que esta tela responde em três segundos: **está coletando?**
 */

/** Acima disto a coleta está claramente parada, não apenas atrasada. */
const HORAS_PARA_ALARME = 6;

const FABRICANTE_ROTULO: Record<string, string> = {
  growatt: "Growatt",
  huawei: "Huawei FusionSolar",
  solis: "SolisCloud",
  foxess: "FoxESS",
  hoymiles: "Hoymiles",
  solarportal_plus: "SolarPortal+ (GoodWe)",
  nep: "NEP",
  outro: "Outro",
};

function horasDesde(data: Date | null): number | null {
  if (!data) return null;
  return (Date.now() - data.getTime()) / 3_600_000;
}

function quandoFoi(horas: number | null): string {
  if (horas === null) return "nunca";
  if (horas < 1) return `há ${Math.round(horas * 60)} min`;
  if (horas < 48) return `há ${Math.round(horas)} h`;
  return `há ${Math.round(horas / 24)} dias`;
}

export default async function Coleta() {
  const usuario = await exigirUsuario();

  const contas = await db.query.contaPortal.findMany({
    where: eq(schema.contaPortal.empresaId, usuario.empresaId),
    orderBy: asc(schema.contaPortal.fabricante),
  });

  /**
   * Cobertura por conta: quantas usinas dela têm leitura recente.
   *
   * É o número que separa "coletou" de "coletou tudo". A Growatt varre em
   * lotes de 40 por rodada, então logo depois de ligar ela mostra 5 de 143 — e
   * isso é normal, não defeito. Sem a coluna, a única leitura possível seria
   * "rodou sem erro", que não diz nada sobre o parque.
   */
  const cobertura = await db
    .select({
      contaId: schema.vinculoPortal.contaPortalId,
      usinas: sql<number>`count(distinct ${schema.vinculoPortal.usinaId})::int`,
      frescas: sql<number>`count(distinct ${schema.vinculoPortal.usinaId}) filter (
        where ${schema.leitura.medidoEm} > now() - interval '2 days'
      )::int`,
    })
    .from(schema.vinculoPortal)
    .leftJoin(
      schema.leitura,
      sql`${schema.leitura.usinaId} = ${schema.vinculoPortal.usinaId}
          and ${schema.leitura.granularidade} = 'dia'`,
    )
    .where(eq(schema.vinculoPortal.empresaId, usuario.empresaId))
    .groupBy(schema.vinculoPortal.contaPortalId);

  const porConta = new Map(cobertura.map((c) => [c.contaId, c]));

  const linhas = contas.map((c) => {
    const horas = horasDesde(c.ultimaColetaEm);
    const cadencia = c.cadenciaMinutos ?? 60;
    const dados = porConta.get(c.id);
    const usinas = dados?.usinas ?? 0;
    const frescas = dados?.frescas ?? 0;

    /**
     * Atrasado é passar de **duas vezes** a cadência, não de uma.
     *
     * Uma rodada perdida acontece: a máquina estava desligada, a internet caiu,
     * o portal recusou por frequência. Acusar na primeira encheria a tela de
     * vermelho que não exige ação — e tela sempre vermelha é tela que ninguém
     * olha.
     */
    const estado =
      horas === null
        ? "nunca"
        : horas > HORAS_PARA_ALARME
          ? "parado"
          : horas * 60 > cadencia * 2
            ? "atrasado"
            : "ok";

    return { conta: c, horas, cadencia, usinas, frescas, estado };
  });

  const parados = linhas.filter((l) => l.estado === "parado" || l.estado === "nunca");
  const totalUsinas = linhas.reduce((n, l) => n + l.usinas, 0);
  const totalFrescas = linhas.reduce((n, l) => n + l.frescas, 0);

  const ESTADO_ROTULO: Record<string, string> = {
    ok: "Em dia",
    atrasado: "Atrasada",
    parado: "Parada",
    nunca: "Nunca coletou",
  };

  return (
    <main>
      <Cabecalho
        trilha={[{ href: "/usinas", rotulo: "Usinas" }]}
        titulo="Coleta dos portais"
        selos={
          parados.length > 0 ? (
            <span className="pilula sev-critico">
              {parados.length} {parados.length === 1 ? "portal parado" : "portais parados"}
            </span>
          ) : (
            <span className="pilula sev-info">todos em dia</span>
          )
        }
        meta={
          <span>
            {totalFrescas} de {totalUsinas} usinas com dado dos últimos 2 dias
          </span>
        }
      />

      {parados.length > 0 && (
        <p className="aviso erro">
          <strong>Dado velho é pior que dado ausente.</strong> Uma usina que parou de gerar há dez dias continua
          aparecendo como &quot;gerando&quot; se ninguém olhar a data da última leitura, e o alerta não abre porque não houve
          leitura nova para disparar a detecção. Na VM, confira o coletor com <code>docker compose logs --tail=50 coletor</code>.
        </p>
      )}

      <div className="grade-portais">
        {linhas.map(({ conta, horas, cadencia, usinas, frescas, estado }) => {
          const cobertura = usinas ? Math.round((frescas / usinas) * 100) : 0;
          return (
            <section key={conta.id} className={`portal-status estado-${estado}`}>
              <header>
                <span className="portal-luz" aria-hidden />
                <div>
                  <h2>{FABRICANTE_ROTULO[conta.fabricante] ?? conta.fabricante}</h2>
                  {conta.apelido && conta.apelido !== conta.fabricante && <small>{conta.apelido}</small>}
                </div>
                <span className="portal-estado">{ESTADO_ROTULO[estado] ?? estado}</span>
              </header>

              <Dados
                itens={[
                  ["Última coleta", quandoFoi(horas)],
                  ["Cadência", `a cada ${cadencia} min`],
                  ["Usinas", String(usinas)],
                ]}
              />

              <div className="portal-cobertura">
                <span>
                  Com dado recente <strong>{frescas} de {usinas}</strong>
                </span>
                <span className="progresso progresso-largo">
                  <span style={{ width: `${cobertura}%` }} />
                </span>
              </div>

              {conta.ultimoErro && (
                <p className="portal-erro" title={conta.ultimoErro}>
                  <AlertTriangle size={13} aria-hidden /> {conta.ultimoErro.slice(0, 120)}
                </p>
              )}
            </section>
          );
        })}
      </div>

      <details className="como-ler">
        <summary>
          <Info size={15} aria-hidden /> Como a coleta funciona
        </summary>
        <div>
          <p>
            <strong>Os portais não coletam à noite.</strong> Entre 20h e 4h nenhuma usina gera, e o total do dia já fechou
            na rodada das 19h — consultar nessas horas gastaria quase 40% do orçamento de chamadas para reler o mesmo
            número. O orçamento é a parte escassa: a Growatt bloqueia IP por frequência, e a Northbound da Huawei tem teto
            diário.
          </p>
          <p>
            <strong>Cobertura parcial nem sempre é defeito.</strong> A Growatt tem 143 usinas e é varrida em lotes de 40
            por rodada, para não estourar o limite — logo depois de ligar ela aparece com poucas, e completa o parque em
            cerca de quatro horas.
          </p>
          <p>
            <strong>Atrasada</strong> é passar de duas vezes a cadência; <strong>parada</strong> é ficar mais de{" "}
            {HORAS_PARA_ALARME} h sem coletar.
          </p>
        </div>
      </details>
    </main>
  );
}
