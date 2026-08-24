import { desc } from "drizzle-orm";

import { exigirUsuario } from "@/auth/sessao";
import { db } from "@/db";
import { ordemServico as osTable } from "@/db/schema";

export const dynamic = "force-dynamic";

export const STATUS_ROTULO: Record<string, string> = {
  aberta: "Aberta",
  agendada: "Agendada",
  em_andamento: "Em andamento",
  aguardando_peca: "Aguardando peça",
  concluida: "Concluída",
  cancelada: "Cancelada",
};

export const TIPO_ROTULO: Record<string, string> = {
  instalacao: "Instalação",
  preventiva: "Preventiva",
  corretiva: "Corretiva",
  limpeza: "Limpeza",
  garantia: "Garantia",
  vistoria: "Vistoria",
};

export const PRIORIDADE_ROTULO: Record<string, string> = {
  baixa: "Baixa",
  normal: "Normal",
  alta: "Alta",
  urgente: "Urgente",
};

export default async function ListaOs() {
  await exigirUsuario();

  const ordens = await db.query.ordemServico.findMany({
    with: { cliente: true, usina: true, responsavel: true, checklist: true },
    orderBy: desc(osTable.numero),
  });

  const abertas = ordens.filter(
    (o) => o.status !== "concluida" && o.status !== "cancelada",
  );

  if (ordens.length === 0) {
    return (
      <main>
        <header className="topo">
          <h1>Ordens de serviço</h1>
        </header>
        <div className="vazio">
          <p>
            Nenhuma ordem de serviço ainda. Elas nascem de duas formas: abertas à
            mão, ou a partir de um alerta — na tela de <a href="/alertas">alertas</a>{" "}
            há o botão <strong>Abrir OS</strong> em cada ocorrência.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main>
      <header className="topo">
        <h1>Ordens de serviço</h1>
        <span className="sub">
          {ordens.length} no total · {abertas.length} em aberto
        </span>
      </header>

      <div className="tabela-wrap">
        <table className="tabela">
          <thead>
            <tr>
              <th className="num">Nº</th>
              <th>Cliente</th>
              <th>Usina</th>
              <th>Tipo</th>
              <th>Situação</th>
              <th>Prioridade</th>
              <th>Responsável</th>
              <th className="num">Checklist</th>
              <th className="num">Aberta em</th>
            </tr>
          </thead>
          <tbody>
            {ordens.map((o) => {
              const feitos = o.checklist.filter((i) => i.concluido).length;
              return (
                <tr key={o.id}>
                  <td className="num forte">
                    <a href={`/os/${o.id}`}>#{o.numero}</a>
                  </td>
                  <td className="forte">{o.cliente.nome}</td>
                  <td>{o.usina?.nome ?? "—"}</td>
                  <td>{TIPO_ROTULO[o.tipo] ?? o.tipo}</td>
                  <td>
                    <span className={`pilula st-${o.status}`}>
                      {STATUS_ROTULO[o.status] ?? o.status}
                    </span>
                  </td>
                  <td>
                    <span className={`pilula pr-${o.prioridade}`}>
                      {PRIORIDADE_ROTULO[o.prioridade] ?? o.prioridade}
                    </span>
                  </td>
                  <td className={o.responsavel ? "" : "fraco"}>
                    {o.responsavel?.nome ?? "sem responsável"}
                  </td>
                  <td className="num">
                    {o.checklist.length ? `${feitos}/${o.checklist.length}` : "—"}
                  </td>
                  <td className="num">{o.criadoEm.toLocaleDateString("pt-BR")}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </main>
  );
}
