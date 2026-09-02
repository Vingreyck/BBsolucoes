import { asc, eq, sql } from "drizzle-orm";

import { exigirUsuario } from "@/auth/sessao";
import { db } from "@/db";
import { leitura as leituraTable, usina as usinaTable } from "@/db/schema";

import { kWh, kWp } from "../formatar";

export const dynamic = "force-dynamic";

/**
 * Acima disto a potência cadastrada é fisicamente impossível.
 *
 * `geração do dia ÷ potência` é quantas horas de sol pleno a usina teria
 * precisado. No Nordeste isso fica entre 4 e 6; acima de 8 não existe, e denuncia
 * potência errada no cadastro do portal — problema que atinge parte do parque e
 * que precisa ser corrigido na origem, não aqui.
 */
const HORAS_IMPOSSIVEIS = 8;

function normalizar(texto: string): string {
  return texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

/**
 * Nome de exibição de cada portal. A chave é o valor guardado no banco.
 *
 * `sem_portal` não é um fabricante: é a usina que não está em portal nenhum.
 * O cliente confirmou que essas existem, e elas são as mais perigosas — não
 * aparecem em lugar nenhum quando param de gerar.
 */
const PORTAL_ROTULO: Record<string, string> = {
  growatt: "Growatt",
  foxess: "FoxESS",
  solis: "Solis",
  hoymiles: "Hoymiles",
  huawei: "Huawei",
  solarportal_plus: "SolarPortal+",
  nep: "NEP",
  outro: "Outro",
};

export default async function Usinas({
  searchParams,
}: {
  searchParams: Promise<{ busca?: string; filtro?: string; portal?: string }>;
}) {
  await exigirUsuario();
  const { busca = "", filtro = "", portal = "" } = await searchParams;

  const usinas = await db.query.usina.findMany({
    with: {
      cliente: true,
      equipamentos: true,
      vinculosPortal: { with: { contaPortal: true } },
    },
    orderBy: asc(usinaTable.nome),
  });

  // Uma consulta agregada em vez de uma por usina.
  const series = await db
    .select({
      usinaId: leituraTable.usinaId,
      /**
       * Dias distintos, não linhas. Uma usina com quatro microinversores grava
       * quatro leituras por dia, e contar linhas faria um único dia aparecer
       * como quatro.
       */
      dias: sql<number>`count(distinct (${leituraTable.medidoEm} at time zone 'UTC')::date)`,
      ultima: sql<string>`max(${leituraTable.medidoEm})::date::text`,
      maiorDia: sql<number>`max(${leituraTable.energiaKwh})::float8`,
      total: sql<number>`sum(${leituraTable.energiaKwh})::float8`,
    })
    .from(leituraTable)
    .where(eq(leituraTable.granularidade, "dia"))
    .groupBy(leituraTable.usinaId);

  const porUsina = new Map(series.map((s) => [s.usinaId, s]));

  const linhas = usinas.map((u) => {
    const serie = porUsina.get(u.id);
    const potencia = u.potenciaKwp ? Number(u.potenciaKwp) : null;

    // Com série, a física decide. Sem série, sobra o absurdo evidente.
    const potenciaSuspeita =
      potencia !== null && potencia > 0
        ? serie?.maiorDia
          ? serie.maiorDia / potencia > HORAS_IMPOSSIVEIS
          : potencia < 1
        : false;

    return {
      usina: u,
      serie,
      potencia,
      potenciaSuspeita,
      semEquipamento: u.equipamentos.length === 0,
      semSerie: !serie,
      // Uma usina pode, em tese, estar em mais de um portal. Na prática é um só.
      // Tipado como string porque o filtro vem da URL, que não conhece o enum.
      portais: u.vinculosPortal.map((v) => v.contaPortal.fabricante as string),
    };
  });

  const alvo = normalizar(busca.trim());
  const filtradas = linhas.filter((l) => {
    if (alvo) {
      const campos = normalizar(
        `${l.usina.nome} ${l.usina.cliente.nome} ${l.usina.cidade ?? ""}`,
      );
      if (!campos.includes(alvo)) return false;
    }
    if (portal === "sem_portal" && l.portais.length > 0) return false;
    if (portal && portal !== "sem_portal" && !l.portais.includes(portal)) return false;
    if (filtro === "potencia") return l.potenciaSuspeita;
    if (filtro === "sem-equipamento") return l.semEquipamento;
    if (filtro === "sem-serie") return l.semSerie;
    return true;
  });

  // Contagem por portal, para os botões mostrarem quantas cada um tem.
  const porPortal = new Map<string, number>();
  for (const l of linhas) {
    if (l.portais.length === 0) {
      porPortal.set("sem_portal", (porPortal.get("sem_portal") ?? 0) + 1);
    }
    for (const p of new Set(l.portais)) {
      porPortal.set(p, (porPortal.get(p) ?? 0) + 1);
    }
  }
  const portaisOrdenados = [...porPortal].sort((a, b) => b[1] - a[1]);

  const suspeitas = linhas.filter((l) => l.potenciaSuspeita).length;
  const semEquipamento = linhas.filter((l) => l.semEquipamento).length;
  const semSerie = linhas.filter((l) => l.semSerie).length;
  const potenciaTotal = filtradas.reduce((s, l) => s + (l.potencia ?? 0), 0);

  return (
    <main>
      <header className="topo">
        <h1>Usinas</h1>
        <span className="sub">
          {filtradas.length === linhas.length
            ? `${linhas.length} cadastradas`
            : `${filtradas.length} de ${linhas.length}`}{" "}
          · {kWp(potenciaTotal)}
        </span>
      </header>

      <div className="barra-usinas">
        <form className="busca" action="/usinas">
          <input
            type="search"
            name="busca"
            placeholder="Cliente, usina ou cidade"
            defaultValue={busca}
            aria-label="Buscar usina"
          />
          {filtro && <input type="hidden" name="filtro" value={filtro} />}
          {portal && <input type="hidden" name="portal" value={portal} />}
          <button type="submit">Buscar</button>
        </form>
      </div>

      <div className="barra-usinas">
        <span className="rotulo-filtro">Portal</span>
        <nav className="filtros">
          <Filtro tipo="portal" atual={portal} valor="" busca={busca} filtro={filtro}>
            Todos ({linhas.length})
          </Filtro>
          {portaisOrdenados.map(([p, n]) => (
            <Filtro
              key={p}
              tipo="portal"
              atual={portal}
              valor={p}
              busca={busca}
              filtro={filtro}
              perigo={p === "sem_portal"}
            >
              {p === "sem_portal" ? "Sem portal" : (PORTAL_ROTULO[p] ?? p)} ({n})
            </Filtro>
          ))}
        </nav>
      </div>

      <div className="barra-usinas">
        <span className="rotulo-filtro">Cadastro</span>
        <nav className="filtros">
          <Filtro atual={filtro} valor="" busca={busca} portal={portal}>
            Tudo ({linhas.length})
          </Filtro>
          <Filtro atual={filtro} valor="potencia" busca={busca} portal={portal} perigo>
            Potência errada ({suspeitas})
          </Filtro>
          <Filtro atual={filtro} valor="sem-equipamento" busca={busca} portal={portal}>
            Sem equipamento ({semEquipamento})
          </Filtro>
          <Filtro atual={filtro} valor="sem-serie" busca={busca} portal={portal}>
            Sem geração ({semSerie})
          </Filtro>
        </nav>
      </div>

      {filtro === "potencia" && suspeitas > 0 && (
        <p className="aviso">
          A potência dessas usinas exigiria mais de {HORAS_IMPOSSIVEIS} horas de sol
          pleno num único dia para gerar o que elas geraram — o que não existe. É
          erro de cadastro <strong>no portal da Growatt</strong>, provavelmente kWp
          digitado em campo que espera watts, e precisa ser corrigido lá. Enquanto
          não for, o alerta de geração abaixo do esperado não funciona nessas usinas.
        </p>
      )}

      <div className="tabela-wrap">
        <table className="tabela">
          <thead>
            <tr>
              <th>Cliente</th>
              <th>Usina</th>
              <th>Portal</th>
              <th>Cidade</th>
              <th className="num">Potência</th>
              <th className="num">Instalada</th>
              <th className="num">Equip.</th>
              <th className="num">Geração no banco</th>
            </tr>
          </thead>
          <tbody>
            {filtradas.map(({ usina, serie, potenciaSuspeita, semEquipamento, portais }) => (
              <tr key={usina.id}>
                <td className="forte">{usina.cliente.nome}</td>
                <td>{usina.nome}</td>
                <td className={portais.length ? "" : "fraco"}>
                  {portais.length
                    ? [...new Set(portais)]
                        .map((p) => PORTAL_ROTULO[p] ?? p)
                        .join(", ")
                    : "nenhum"}
                </td>
                <td>{usina.cidade ?? "—"}</td>
                <td className={`num ${potenciaSuspeita ? "ruim" : ""}`}>
                  {kWp(usina.potenciaKwp) ?? "—"}
                  {potenciaSuspeita && <span className="marca" title="Potência impossível para a geração registrada">!</span>}
                </td>
                <td className="num">
                  {usina.dataInstalacao
                    ? usina.dataInstalacao.toLocaleDateString("pt-BR")
                    : "—"}
                </td>
                <td className={`num ${semEquipamento ? "fraco" : ""}`}>
                  {usina.equipamentos.length || "—"}
                </td>
                <td className="num">
                  {serie
                    ? `${serie.dias} ${serie.dias === 1 ? "dia" : "dias"} · ${kWh(serie.total)}`
                    : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {filtradas.length === 0 && (
        <div className="vazio">
          <p>Nenhuma usina bate com esse filtro.</p>
        </div>
      )}
    </main>
  );
}

/**
 * Um botão de filtro que preserva os outros filtros ativos.
 *
 * `tipo` diz qual parâmetro este botão controla; os demais vêm por props e são
 * mantidos na URL, para que escolher um portal não jogue fora a busca que a
 * pessoa já tinha digitado.
 */
function Filtro({
  tipo = "filtro",
  atual,
  valor,
  busca,
  filtro,
  portal,
  perigo,
  children,
}: {
  tipo?: "filtro" | "portal";
  atual: string;
  valor: string;
  busca: string;
  filtro?: string;
  portal?: string;
  perigo?: boolean;
  children: React.ReactNode;
}) {
  const parametros = new URLSearchParams();
  if (busca) parametros.set("busca", busca);
  if (tipo === "filtro") {
    if (valor) parametros.set("filtro", valor);
    if (portal) parametros.set("portal", portal);
  } else {
    if (filtro) parametros.set("filtro", filtro);
    if (valor) parametros.set("portal", valor);
  }
  const consulta = parametros.toString();
  const ativo = atual === valor;

  return (
    <a
      href={`/usinas${consulta ? `?${consulta}` : ""}`}
      className={`filtro${ativo ? " ativo" : ""}${perigo ? " perigo" : ""}`}
      aria-current={ativo ? "page" : undefined}
    >
      {children}
    </a>
  );
}
