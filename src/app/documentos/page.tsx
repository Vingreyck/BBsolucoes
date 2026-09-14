import { asc } from "drizzle-orm";

import { exigirUsuario } from "@/auth/sessao";
import { db } from "@/db";
import { cliente as clienteTable } from "@/db/schema";

export const dynamic = "force-dynamic";

/**
 * O dossiê tem dois blocos, e falhar em cada um custa uma coisa diferente.
 *
 * O da **concessionária** não é opinião da BB: é a lista da NDU 013 da
 * Energisa, a norma que rege a conexão de geração distribuída em baixa tensão.
 * Documento que falta aqui trava a homologação — a usina fica pronta no telhado
 * e não pode ser ligada.
 *
 * O **comercial** é o que protege a empresa. Falta aqui não trava obra nenhuma;
 * aparece quando dá problema, meses depois, e aí não tem o que fazer.
 *
 * A primeira versão desta tela usava uma lista só, copiada da pasta mais
 * organizada do Drive. Estava errada nos dois sentidos: exigia o que a norma
 * não pede e ignorava metade do que ela pede.
 */
const CONCESSIONARIA = [
  "uc_geradora",
  "documento_pessoal",
  "projeto_eletrico",
  "memorial",
  "art",
  "foto_padrao",
] as const;

const COMERCIAL = ["contrato", "recibo"] as const;

/**
 * Exigidos só em alguns casos, então não contam como falta.
 *
 * Procuração só existe quando não é o titular que assina. UCs beneficiárias e
 * compensativo só em sistema de compensação com mais de uma unidade. Aparecem
 * na tela como "também na pasta", não como pendência.
 */
const CONDICIONAIS = ["procuracao", "uc_beneficiaria", "compensativo"] as const;

const ROTULO: Record<string, string> = {
  art: "ART",
  boleto_art: "Boleto ART",
  contrato: "Contrato",
  memorial: "Memorial",
  procuracao: "Procuração",
  recibo: "Recibo",
  documento_pessoal: "Documento do titular",
  uc_geradora: "Conta de luz",
  projeto_eletrico: "Projeto elétrico",
  simulacao: "Simulação",
  uc_beneficiaria: "UCs beneficiárias",
  compensativo: "Compensativo",
  nota_fiscal: "Nota fiscal",
  ficha_cadastral: "Ficha",
  datasheet: "Datasheet",
  comprovante: "Comprovante",
  declaracao: "Declaração",
  orcamento: "Orçamento",
  foto_padrao: "Foto do padrão",
  protocolo: "Protocolo Energisa",
  outro: "Outro",
};

/**
 * Ano da pasta no Drive: "CLIENTES 2026", "CLIENTES - 2024".
 *
 * É a informação que separa cobrança de arqueologia. A taxa de arquivamento
 * mudou muito de um ano para o outro — em 2025, 5 dos 57 clientes tinham o
 * projeto elétrico guardado; em 2026 são 56 de 105. Sem esse corte, a tela
 * mostra 154 de 169 clientes em falta e ninguém abre uma lista assim.
 */
function anoDaPasta(origem: string | null): string {
  const achado = origem?.match(/\d{4}/);
  return achado ? achado[0] : "sem ano";
}

export default async function Documentos({
  searchParams,
}: {
  searchParams: Promise<{ filtro?: string; busca?: string; ano?: string }>;
}) {
  await exigirUsuario();
  const { filtro = "", busca = "", ano = "" } = await searchParams;

  const clientes = await db.query.cliente.findMany({
    with: { documentos: true },
    orderBy: asc(clienteTable.nome),
  });

  // Só entra quem tem pasta. Cliente que veio do portal do fabricante e nunca
  // teve pasta não é "documentação incompleta" — é outra conversa.
  const comPasta = clientes.filter((c) => c.documentos.length > 0);

  const linhas = comPasta.map((c) => {
    const tipos = new Set(c.documentos.map((d) => d.tipo));
    const faltaConcessionaria = CONCESSIONARIA.filter((t) => !tipos.has(t));
    const faltaComercial = COMERCIAL.filter((t) => !tipos.has(t));
    const extras = [...tipos].filter(
      (t) =>
        !CONCESSIONARIA.includes(t as never) && !COMERCIAL.includes(t as never),
    );
    return {
      cliente: c,
      faltaConcessionaria,
      faltaComercial,
      extras,
      // A pasta mais recente manda: cliente que voltou em 2026 para aumentar a
      // usina tem pasta nos dois anos, e o que importa é o trabalho de agora.
      ano: c.documentos
        .map((d) => anoDaPasta(d.origem))
        .sort()
        .at(-1) as string,
      pasta: c.documentos.find((d) => d.linkDrive)?.linkDrive ?? null,
    };
  });

  /**
   * Quem está perto do fim vem primeiro.
   *
   * Em ordem alfabética a lista é um monte indistinto. Ordenada por quanto
   * falta, ela vira fila de trabalho: em 2026 são 27 clientes a **um** papel de
   * ficarem completos, quase todos a mesma foto do padrão, e esses somem no
   * meio dos 26 que estão faltando três ou mais.
   */
  linhas.sort((a, b) => {
    const fa = a.faltaConcessionaria.length + a.faltaComercial.length;
    const fb = b.faltaConcessionaria.length + b.faltaComercial.length;
    if (fa !== fb) return fa - fb;
    return a.cliente.nome.localeCompare(b.cliente.nome, "pt-BR");
  });

  const anos = [...new Set(linhas.map((l) => l.ano))].sort().reverse();
  const doAno = ano ? linhas.filter((l) => l.ano === ano) : linhas;

  const alvo = busca
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");

  const filtradas = doAno.filter((l) => {
    if (alvo) {
      const nome = l.cliente.nome
        .toLowerCase()
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "");
      if (!nome.includes(alvo)) return false;
    }
    if (filtro === "homologacao") return l.faltaConcessionaria.length > 0;
    if (filtro === "comercial") return l.faltaComercial.length > 0;
    if (filtro === "completos")
      return l.faltaConcessionaria.length === 0 && l.faltaComercial.length === 0;
    return true;
  });

  const travados = doAno.filter((l) => l.faltaConcessionaria.length > 0).length;
  const expostos = doAno.filter((l) => l.faltaComercial.length > 0).length;
  const completos = doAno.filter(
    (l) => l.faltaConcessionaria.length === 0 && l.faltaComercial.length === 0,
  ).length;

  if (linhas.length === 0) {
    return (
      <main>
        <header className="topo">
          <h1>Documentos</h1>
        </header>
        <div className="vazio">
          <p>
            Nenhum documento importado ainda. Rode{" "}
            <code>scripts/listar-drive.gs</code> no Apps Script da conta do
            Google, baixe o CSV para <code>dados/</code> e então{" "}
            <code>npm run import:drive -- &quot;dados/arquivo.csv&quot;</code>.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main>
      <header className="topo">
        <h1>Documentos</h1>
        <span className="sub">
          {filtradas.length === doAno.length
            ? `${doAno.length} clientes com pasta`
            : `${filtradas.length} de ${doAno.length}`}
        </span>
        {travados > 0 && (
          <span className="alerta">{travados} travam homologação</span>
        )}
      </header>

      <div className="barra-usinas">
        <form className="busca" action="/documentos">
          <input
            type="search"
            name="busca"
            placeholder="Nome do cliente"
            defaultValue={busca}
            aria-label="Buscar cliente"
          />
          {filtro && <input type="hidden" name="filtro" value={filtro} />}
          {ano && <input type="hidden" name="ano" value={ano} />}
          <button type="submit">Buscar</button>
        </form>
      </div>

      <div className="barra-usinas">
        <span className="rotulo-filtro">Pasta de</span>
        <nav className="filtros">
          <Filtro atual={ano} valor="" chave="ano" busca={busca} outro={filtro}>
            Todos os anos ({linhas.length})
          </Filtro>
          {anos.map((a) => (
            <Filtro
              key={a}
              atual={ano}
              valor={a}
              chave="ano"
              busca={busca}
              outro={filtro}
            >
              {a} ({linhas.filter((l) => l.ano === a).length})
            </Filtro>
          ))}
        </nav>
      </div>

      <div className="barra-usinas">
        <span className="rotulo-filtro">Falta</span>
        <nav className="filtros">
          <Filtro atual={filtro} valor="" busca={busca} outro={ano}>
            Todos ({doAno.length})
          </Filtro>
          <Filtro atual={filtro} valor="homologacao" busca={busca} outro={ano} perigo>
            Para a concessionária ({travados})
          </Filtro>
          <Filtro atual={filtro} valor="comercial" busca={busca} outro={ano} perigo>
            Para a empresa ({expostos})
          </Filtro>
          <Filtro atual={filtro} valor="completos" busca={busca} outro={ano}>
            Nada falta ({completos})
          </Filtro>
        </nav>
      </div>

      <p className="aviso">
        O bloco da <strong>concessionária</strong> é a lista da NDU 013 da
        Energisa — conta de luz, documento do titular, projeto elétrico,
        memorial, ART e fotos do padrão. Sem isso a homologação não anda e a
        usina fica pronta sem poder ligar. O bloco da <strong>empresa</strong> é
        contrato e recibo: não trava obra, aparece quando dá problema. Procuração,
        UCs beneficiárias e compensativo só valem em alguns casos, então não
        contam como falta.
      </p>

      <p className="aviso">
        <strong>Comece por 2026.</strong> Falta em pasta de 2024 e 2025 quase
        sempre é documento que nunca foi arquivado, não obra parada — em 2025
        só 5 dos 57 clientes tinham o projeto elétrico no Drive, contra 56 dos
        105 de 2026. A usina desses clientes já está ligada e girando; o que dá
        resultado é fechar o ano corrente e deixar o passado para quando sobrar
        tempo.
      </p>

      <div className="tabela-wrap">
        <table className="tabela">
          <thead>
            <tr>
              <th>Cliente</th>
              <th>Ano</th>
              <th>Falta para a concessionária</th>
              <th>Falta para a empresa</th>
              <th>Também na pasta</th>
              <th>Drive</th>
            </tr>
          </thead>
          <tbody>
            {filtradas.map(
              ({
                cliente,
                faltaConcessionaria,
                faltaComercial,
                extras,
                ano: anoCliente,
                pasta,
              }) => (
                <tr key={cliente.id}>
                  <td className="forte">{cliente.nome}</td>
                  <td className="fraco">{anoCliente}</td>
                  <td>
                    {faltaConcessionaria.length === 0 ? (
                      <span className="pilula sev-info">ok</span>
                    ) : (
                      faltaConcessionaria.map((t) => (
                        <span key={t} className="pilula sev-critico">
                          {ROTULO[t] ?? t}
                        </span>
                      ))
                    )}
                  </td>
                  <td>
                    {faltaComercial.length === 0 ? (
                      <span className="pilula sev-info">ok</span>
                    ) : (
                      faltaComercial.map((t) => (
                        <span key={t} className="pilula sev-atencao">
                          {ROTULO[t] ?? t}
                        </span>
                      ))
                    )}
                  </td>
                  <td className="fraco">
                    {extras.length
                      ? extras.map((t) => ROTULO[t] ?? t).join(", ")
                      : "—"}
                  </td>
                  <td>
                    {pasta ? (
                      <a href={pasta} target="_blank" rel="noreferrer">
                        abrir
                      </a>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ),
            )}
          </tbody>
        </table>
      </div>

      {filtradas.length === 0 && (
        <div className="vazio">
          <p>Nenhum cliente bate com esse filtro.</p>
        </div>
      )}
    </main>
  );
}

/**
 * `chave` é o parâmetro que este filtro controla, `outro` é o valor do outro
 * filtro — que precisa sobreviver ao clique. Sem isso, escolher o ano zera a
 * escolha de "falta o quê", e a combinação que interessa (2026 + trava
 * homologação) fica inalcançável.
 */
function Filtro({
  atual,
  valor,
  chave = "filtro",
  busca,
  outro,
  perigo,
  children,
}: {
  atual: string;
  valor: string;
  chave?: "filtro" | "ano";
  busca: string;
  outro?: string;
  perigo?: boolean;
  children: React.ReactNode;
}) {
  const parametros = new URLSearchParams();
  if (busca) parametros.set("busca", busca);
  if (valor) parametros.set(chave, valor);
  if (outro) parametros.set(chave === "ano" ? "filtro" : "ano", outro);
  const consulta = parametros.toString();
  const ativo = atual === valor;

  return (
    <a
      href={`/documentos${consulta ? `?${consulta}` : ""}`}
      className={`filtro${ativo ? " ativo" : ""}${perigo ? " perigo" : ""}`}
      aria-current={ativo ? "page" : undefined}
    >
      {children}
    </a>
  );
}
