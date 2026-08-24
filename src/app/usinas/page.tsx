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

export default async function Usinas({
  searchParams,
}: {
  searchParams: Promise<{ busca?: string; filtro?: string }>;
}) {
  await exigirUsuario();
  const { busca = "", filtro = "" } = await searchParams;

  const usinas = await db.query.usina.findMany({
    with: { cliente: true, equipamentos: true },
    orderBy: asc(usinaTable.nome),
  });

  // Uma consulta agregada em vez de uma por usina.
  const series = await db
    .select({
      usinaId: leituraTable.usinaId,
      dias: sql<number>`count(*)`,
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
    if (filtro === "potencia") return l.potenciaSuspeita;
    if (filtro === "sem-equipamento") return l.semEquipamento;
    if (filtro === "sem-serie") return l.semSerie;
    return true;
  });

  const suspeitas = linhas.filter((l) => l.potenciaSuspeita).length;
  const semEquipamento = linhas.filter((l) => l.semEquipamento).length;
  const semSerie = linhas.filter((l) => l.semSerie).length;
  const potenciaTotal = linhas.reduce((s, l) => s + (l.potencia ?? 0), 0);

  return (
    <main>
      <header className="topo">
        <h1>Usinas</h1>
        <span className="sub">
          {linhas.length} cadastradas · {kWp(potenciaTotal)} somados
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
          <button type="submit">Buscar</button>
        </form>

        <nav className="filtros">
          <Filtro atual={filtro} valor="" busca={busca}>
            Todas ({linhas.length})
          </Filtro>
          <Filtro atual={filtro} valor="potencia" busca={busca} perigo>
            Potência errada ({suspeitas})
          </Filtro>
          <Filtro atual={filtro} valor="sem-equipamento" busca={busca}>
            Sem equipamento ({semEquipamento})
          </Filtro>
          <Filtro atual={filtro} valor="sem-serie" busca={busca}>
            Sem geração importada ({semSerie})
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
              <th>Cidade</th>
              <th className="num">Potência</th>
              <th className="num">Instalada</th>
              <th className="num">Equip.</th>
              <th className="num">Geração no banco</th>
            </tr>
          </thead>
          <tbody>
            {filtradas.map(({ usina, serie, potenciaSuspeita, semEquipamento }) => (
              <tr key={usina.id}>
                <td className="forte">{usina.cliente.nome}</td>
                <td>{usina.nome}</td>
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
                  {serie ? `${serie.dias} dias · ${kWh(serie.total)}` : "—"}
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

function Filtro({
  atual,
  valor,
  busca,
  perigo,
  children,
}: {
  atual: string;
  valor: string;
  busca: string;
  perigo?: boolean;
  children: React.ReactNode;
}) {
  const parametros = new URLSearchParams();
  if (busca) parametros.set("busca", busca);
  if (valor) parametros.set("filtro", valor);
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
