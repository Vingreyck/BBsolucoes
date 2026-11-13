import { and, asc, eq, sql } from "drizzle-orm";
import { Check, FileText, UserRound, Wallet } from "lucide-react";

import { exigirUsuario } from "@/auth/sessao";
import { db, schema } from "@/db";
import { cliente as clienteTable, etapa as etapaTable } from "@/db/schema";
import { FORMAS_PAGAMENTO } from "@/projeto/pagamento";

import { Cabecalho, Cartao } from "../../_ui";
import { criarProjeto } from "../actions";
import { EscolherCliente, type Opcao } from "./escolher-cliente";

const PORTAL: Record<string, string> = {
  growatt: "Growatt",
  solis: "Solis",
  foxess: "FoxESS",
  hoymiles: "Hoymiles",
  huawei: "Huawei",
  solarportal_plus: "SolarPortal+",
  nep: "NEP",
  outro: "Outro",
};

export const dynamic = "force-dynamic";

const ERROS: Record<string, string> = {
  cliente: "Escreva o nome do cliente (ou escolha quem já é cliente).",
  cpf: "O CPF não confere (dígito errado?). Corrija ou deixe em branco: ele é opcional.",
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
  const [clientes, usinas, docsPorCliente, primeira, emAndamento] = await Promise.all([
    db.query.cliente.findMany({
      where: eq(clienteTable.empresaId, usuario.empresaId),
      columns: { id: true, nome: true, cidade: true },
      orderBy: asc(clienteTable.nome),
    }),
    // Cada usina com o portal de onde ela vem: é daqui que sai "Growatt", "Solis"…
    db.query.usina.findMany({
      where: eq(schema.usina.empresaId, usuario.empresaId),
      columns: { id: true, nome: true, cidade: true, clienteId: true, arquivadaEm: true, linkDrive: true },
      with: { vinculosPortal: { with: { contaPortal: { columns: { fabricante: true } } } } },
    }),
    db
      .select({ clienteId: schema.documento.clienteId, docs: sql<number>`count(*)::int` })
      .from(schema.documento)
      .where(eq(schema.documento.empresaId, usuario.empresaId))
      .groupBy(schema.documento.clienteId),
    db.query.etapa.findFirst({
      where: and(eq(etapaTable.empresaId, usuario.empresaId), eq(etapaTable.ativa, true)),
      orderBy: asc(etapaTable.ordem),
    }),
    // Quem já tem venda em andamento sai da lista: projeto novo para ele é engano.
    db
      .select({ clienteId: schema.projeto.clienteId })
      .from(schema.projeto)
      .where(and(eq(schema.projeto.empresaId, usuario.empresaId), eq(schema.projeto.situacao, "em_andamento"))),
  ]);

  const comVendaAberta = new Set(emAndamento.map((p) => p.clienteId));
  const docsPor = new Map(docsPorCliente.map((d) => [d.clienteId, d.docs]));
  const portaisDe = (u: (typeof usinas)[number]) => [
    ...new Set(u.vinculosPortal.map((v) => PORTAL[v.contaPortal?.fabricante ?? "outro"] ?? "Outro")),
  ];

  const opcoes: Opcao[] = [];
  for (const c of clientes) {
    if (comVendaAberta.has(c.id)) continue;
    const suas = usinas.filter((u) => u.clienteId === c.id);
    const docs = docsPor.get(c.id) ?? 0;
    const origens = [...new Set(suas.flatMap(portaisDe))];
    // Drive: tem documentos importados ou a usina dele tem pasta no Drive.
    // Só entra na busca quem está no Drive (os portais viram filtro, não entrada).
    if (docs === 0 && !suas.some((u) => u.linkDrive)) continue;
    opcoes.push({
      chave: `c:${c.id}`,
      nome: c.nome,
      cidade: c.cidade,
      origens,
      docs,
      // Só conta como arquivada se todas as usinas dele estão.
      arquivada: suas.length > 0 && suas.every((u) => u.arquivadaEm),
    });
  }
  opcoes.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));

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
          ajuda="Quem chegou agora: preencha os dados aqui. O endereço é o que o app do técnico usa para traçar a rota até a casa. Se a pessoa já comprou antes (aumento de usina, segunda casa), abra “Já é cliente?” e escolha o nome dela, para a venda nova ficar junto do histórico."
        >
          <div className="form-ficha">
            <div className="dupla">
              <label>
                Nome completo <span className="req">*</span>
                <input name="clienteNovo" placeholder="Nome completo" autoComplete="off" />
              </label>
              <label>
                CPF ou CNPJ <span className="fraco">(opcional)</span>
                <input name="cpf" inputMode="numeric" placeholder="000.000.000-00" autoComplete="off" />
              </label>
              <label>
                Telefone
                <input name="telefone" inputMode="tel" placeholder="(79) 90000-0000" />
              </label>
            </div>

            <div className="dupla">
              <label>
                Endereço
                <input name="logradouro" placeholder="Rua, avenida, povoado" />
              </label>
              <label>
                Número
                <input name="numero" placeholder="123 ou S/N" />
              </label>
              <label>
                Bairro
                <input name="bairro" placeholder="Centro" />
              </label>
            </div>

            <div className="dupla">
              <label>
                Cidade
                <input name="cidade" placeholder="Itabaiana" />
              </label>
              <label>
                UF
                <input name="uf" defaultValue="SE" maxLength={2} />
              </label>
            </div>

            <details className="dobra-limpa">
              <summary>Já é cliente? Escolher quem já comprou antes</summary>
              <p className="nota">
                Escolhido aqui, a venda entra no cadastro dessa pessoa. O que estiver preenchido acima só completa o
                que falta nele (o endereço, por exemplo). Quem já tem um projeto em andamento não aparece.
              </p>
              <EscolherCliente opcoes={opcoes} />
            </details>
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

        <Cartao
          titulo="Pagamento"
          icone={<Wallet size={16} />}
          ajuda="A forma de pagamento que o cliente aceitou na negociação. Pode ficar em branco agora e ser preenchida ou mudada depois, na tela do projeto."
        >
          <div className="form-ficha">
            <div className="dupla">
              <label>
                Forma de pagamento
                <select name="formaPagamento" defaultValue="">
                  <option value="">Ainda não definida</option>
                  {Object.entries(FORMAS_PAGAMENTO).map(([v, r]) => (
                    <option key={v} value={v}>
                      {r}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Valor total (R$)
                <input name="valor" inputMode="decimal" placeholder="18.500,00" />
              </label>
            </div>
            <label>
              Condições combinadas
              <textarea
                name="pagamentoCondicoes"
                rows={2}
                placeholder="Entrada, número de parcelas, banco do financiamento, data do primeiro vencimento"
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
