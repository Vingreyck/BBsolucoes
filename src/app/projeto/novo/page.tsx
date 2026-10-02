import { and, asc, eq } from "drizzle-orm";
import { Check, FileText, UserRound } from "lucide-react";

import { exigirUsuario } from "@/auth/sessao";
import { db } from "@/db";
import { cliente as clienteTable, etapa as etapaTable } from "@/db/schema";

import { Cabecalho, Cartao } from "../../_ui";
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
  const usuario = await exigirUsuario();
  const { erro } = await searchParams;

  // Da empresa de quem pede, como tudo: o sistema é multiempresa.
  const [clientes, primeira] = await Promise.all([
    db.query.cliente.findMany({
      where: eq(clienteTable.empresaId, usuario.empresaId),
      orderBy: asc(clienteTable.nome),
    }),
    db.query.etapa.findFirst({
      where: and(eq(etapaTable.empresaId, usuario.empresaId), eq(etapaTable.ativa, true)),
      orderBy: asc(etapaTable.ordem),
    }),
  ]);

  return (
    <main>
      <Cabecalho
        trilha={[{ href: "/esteira", rotulo: "Esteira de projetos" }]}
        titulo="Novo projeto"
        selos={primeira ? <span className="ui-selo ui-selo-marca">entra em {primeira.nome}</span> : undefined}
        meta="Uma venda nova na esteira. Os dados que ainda não existem podem ficar em branco."
      />

      {erro && (
        <p className="aviso erro" role="alert">
          {ERROS[erro] ?? "Não consegui criar o projeto."}
        </p>
      )}

      <form action={criarProjeto} className="pagina-estreita">
        <Cartao
          titulo="Cliente"
          icone={<UserRound size={16} />}
          ajuda="Quem já tem usina instalada provavelmente está na lista — o cadastro veio dos portais dos fabricantes. Quem chegou agora para orçamento ainda não está: escreva o nome no campo de baixo."
        >
          <div className="form-ficha">
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

            <p className="separador-ou">
              <span>ou um cliente novo</span>
            </p>

            <div className="dupla">
              <label>
                Nome completo
                <input name="clienteNovo" placeholder="Nome completo" />
              </label>
              <label>
                Cidade
                <input name="cidade" placeholder="Itabaiana" />
              </label>
              <label>
                Telefone
                <input name="telefone" inputMode="tel" placeholder="(79) 90000-0000" />
              </label>
            </div>
          </div>
        </Cartao>

        <Cartao
          titulo="O projeto"
          icone={<FileText size={16} />}
          ajuda="O consumo médio é a base do dimensionamento e sai da conta de luz — uma fatura da Energisa traz 13 meses de histórico numa página só. Pode ficar em branco agora e ser preenchido depois da vistoria."
        >
          <div className="form-ficha">
            <div className="dupla">
              <label>
                Título
                <input name="titulo" placeholder="Ex.: 8 kWp — Itabaiana" defaultValue="" />
              </label>
              <label>
                Consumo médio (kWh/mês)
                <input name="consumoMedioKwh" inputMode="decimal" placeholder="632" />
              </label>
            </div>

            <label>
              O que o cliente pediu
              <textarea
                name="observacoes"
                rows={3}
                placeholder="Como chegou até a empresa, o que quer resolver, aparelhos que pretende acrescentar"
              />
            </label>
          </div>
        </Cartao>

        <div className="barra-enviar">
          <a href="/esteira" className="botao secundario">
            Cancelar
          </a>
          <button type="submit" className="botao">
            <Check size={15} aria-hidden /> Criar projeto
          </button>
        </div>
      </form>
    </main>
  );
}
