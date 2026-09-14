import { asc } from "drizzle-orm";

import { exigirUsuario } from "@/auth/sessao";
import { db } from "@/db";
import { cliente as clienteTable, etapa as etapaTable } from "@/db/schema";

import { criarProjeto } from "../actions";

export const dynamic = "force-dynamic";

const ERROS: Record<string, string> = {
  cliente: "Escolha um cliente da lista ou escreva o nome de um novo.",
  etapa:
    "Nenhuma etapa cadastrada na esteira. Rode `npm run db:seed` para criar o fluxo.",
};

export default async function NovoProjeto({
  searchParams,
}: {
  searchParams: Promise<{ erro?: string }>;
}) {
  await exigirUsuario();
  const { erro } = await searchParams;

  const clientes = await db.query.cliente.findMany({
    orderBy: asc(clienteTable.nome),
  });

  const primeira = await db.query.etapa.findFirst({
    orderBy: asc(etapaTable.ordem),
  });

  return (
    <main>
      <header className="topo">
        <h1>Novo projeto</h1>
        {primeira && <span className="pilula st-aberta">{primeira.nome}</span>}
        <span className="sub">entra na primeira etapa da esteira</span>
      </header>

      {erro && <p className="aviso">{ERROS[erro] ?? "Não consegui criar o projeto."}</p>}

      <div className="os-detalhe">
        <form action={criarProjeto} className="form-ficha">
          <section className="bloco">
            <h2>Cliente</h2>
            <p className="nota">
              Quem já tem usina instalada provavelmente está na lista — o cadastro
              veio dos portais dos fabricantes. Quem chegou agora para orçamento
              ainda não está: escreva o nome no campo de baixo.
            </p>

            <label>
              Cliente já cadastrado
              <select name="clienteId" defaultValue="">
                <option value="">— escolher da lista ({clientes.length}) —</option>
                {clientes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nome}
                    {c.cidade ? ` · ${c.cidade}` : ""}
                  </option>
                ))}
              </select>
            </label>

            <div className="dupla">
              <label>
                Ou um cliente novo
                <input name="clienteNovo" placeholder="Nome completo" />
              </label>
              <label>
                Cidade
                <input name="cidade" placeholder="Itabaiana" />
              </label>
            </div>

            <label className="curto">
              Telefone
              <input name="telefone" inputMode="tel" placeholder="(79) 90000-0000" />
            </label>
          </section>

          <section className="bloco">
            <h2>O projeto</h2>
            <label>
              Título
              <input
                name="titulo"
                placeholder="Ex.: 8 kWp — Itabaiana"
                defaultValue=""
              />
            </label>

            <p className="nota">
              O consumo médio é a base do dimensionamento e sai da conta de luz —
              uma fatura da Energisa traz 13 meses de histórico numa página só.
              Pode ficar em branco agora e ser preenchido depois da vistoria.
            </p>

            <label className="curto">
              Consumo médio (kWh/mês)
              <input name="consumoMedioKwh" inputMode="decimal" placeholder="632" />
            </label>

            <label>
              O que o cliente pediu
              <textarea
                name="observacoes"
                rows={3}
                placeholder="Como chegou até a empresa, o que quer resolver, aparelhos que pretende acrescentar"
              />
            </label>
          </section>

          <div className="ficha-acoes">
            <a href="/" className="filtro">
              Cancelar
            </a>
            <button type="submit" className="primario">
              Criar projeto
            </button>
          </div>
        </form>
      </div>
    </main>
  );
}
