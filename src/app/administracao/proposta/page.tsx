import { eq } from "drizzle-orm";
import { Calculator, Check, CreditCard, Gauge, Image as ImageIcon, Receipt, ShieldCheck, Truck, Wallet } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { exigirUsuario } from "@/auth/sessao";
import { db, schema } from "@/db";
import { OPCOES_DE_TELHADO } from "@/projeto/da-vistoria";
import { tarifaGuardada } from "@/proposta/assistente-servidor";
import { distribuidoraPorNome } from "@/proposta/municipios";
import { lerPremissas, SUGESTAO, temCamposNovos, type Premissas } from "@/proposta/premissas";
import { comImpostos } from "@/proposta/tarifas";

import { Cabecalho, Cartao } from "../../_ui";
import { salvarCapa, salvarPremissas } from "./actions";
import { EditorDeCustos, EditorDeFinanciamentos, EditorDePerfis } from "./listas";

export const dynamic = "force-dynamic";

/** Fração → texto de formulário: 0,75 vira "75"; 0,007 vira "0,7". */
const pct = (f: number) => String(+(f * 100).toFixed(3)).replace(".", ",");
const num = (n: number) => String(n).replace(".", ",");
const reais = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 4, maximumFractionDigits: 4 });

/**
 * Premissas da proposta comercial: o que o cálculo assume, como a empresa forma
 * o preço e as formas de pagamento.
 *
 * Só o adm mexe. Enquanto ninguém salvar, o sistema não gera proposta: os
 * números que aparecem aqui da primeira vez são só uma sugestão, e proposta com
 * número errado vira promessa ao cliente.
 */
export default async function PremissasDaProposta({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; erro?: string; capa?: string }>;
}) {
  const usuario = await exigirUsuario();
  if (usuario.papel !== "adm") redirect("/sem-acesso");
  const { ok, erro, capa } = await searchParams;

  const empresa = await db.query.empresa.findFirst({
    where: eq(schema.empresa.id, usuario.empresaId),
    columns: { propostaConfig: true, propostaCapa: true, logo: true },
  });
  const salvas = lerPremissas(empresa?.propostaConfig);
  const p: Premissas = salvas ?? SUGESTAO;
  const antigas = Boolean(salvas) && !temCamposNovos(empresa?.propostaConfig);

  // A tarifa que a ANEEL homologou, para comparar com a manual (só o que já foi buscado).
  const referencias = (
    await Promise.all(
      ["Energisa Sergipe", "Sulgipe"].map(async (nome) => {
        const d = distribuidoraPorNome(nome);
        const t = d ? await tarifaGuardada(d.cnpj, "B1") : null;
        return t ? { nome, t } : null;
      }),
    )
  ).filter((x): x is NonNullable<typeof x> => x !== null);

  return (
    <main>
      <Cabecalho
        titulo="Padrões da proposta"
        meta="O que vale para toda proposta da empresa: impostos da conta, perfis, custos e margem, pagamentos e garantias. Cada proposta é montada para um cliente, em Comercial → Propostas."
      />

      {ok && (
        <p className="aviso ok" role="status">
          Premissas salvas. As próximas propostas já saem com elas.
        </p>
      )}
      {capa === "ok" && (
        <p className="aviso ok" role="status">
          Capa salva. Vale para todas as propostas, inclusive as já enviadas.
        </p>
      )}
      {erro && (
        <p className="aviso erro" role="alert">
          {erro === "capa-grande"
            ? "A foto passou de 3 MB. Exporte uma versão menor (JPEG)."
            : erro === "capa-tipo"
              ? "A foto da capa precisa ser JPEG ou PNG."
              : "Algum campo está vazio ou fora do razoável. Confira os números e salve de novo."}
        </p>
      )}
      {!salvas && (
        <p className="aviso" role="status">
          <strong>Ainda não há premissas salvas, e o sistema não gera proposta sem elas.</strong> Os números abaixo são uma
          sugestão: confira cada um e clique em Salvar.
        </p>
      )}
      {antigas && (
        <p className="aviso" role="status">
          <strong>A proposta ganhou campos novos (impostos da conta, perfis, custos e margem, financiamentos).</strong> Até salvar,
          valem as sugestões abaixo: confira e salve.
        </p>
      )}

      <form action={salvarPremissas} className="pagina-estreita">
        <Cartao
          titulo="Impostos da conta"
          icone={<Receipt size={16} />}
          ajuda="A tarifa e o Fio B de cada distribuidora vêm sozinhos da ANEEL, sem impostos. Os impostos daqui são somados por dentro, como na conta de luz."
        >
          <div className="form-ficha">
            <div className="faixa-info" style={{ display: "block" }}>
              <strong style={{ display: "block", marginBottom: "0.3rem" }}>Automático, não precisa mexer</strong>
              {referencias.map(({ nome, t }) => (
                <span key={nome} style={{ display: "block" }}>
                  {nome}: tarifa {reais(comImpostos(t.te + t.tusd, p.tributos))}/kWh
                  {t.fioB ? ` · Fio B ${reais(comImpostos(t.fioB, p.tributos))}/kWh` : ""} (ANEEL, desde {t.vigenciaInicio.split("-").reverse().join("/")}, com os impostos abaixo)
                </span>
              ))}
              <span style={{ display: "block" }}>
                Quanto do Fio B se paga em cada ano (60% em 2026, 75% em 2027, 90% em 2028) segue a lei sozinho. O sol de cada mês vem do Atlas do INPE pela cidade do cliente.
              </span>
            </div>
            <div className="dupla">
              <label>
                ICMS na conta (%)
                <input name="icms" inputMode="decimal" required defaultValue={pct(p.tributos.icms)} />
                <small className="entrada-ajuda">Sergipe cobra 20% sobre a energia (confira na conta: base de cálculo × alíquota).</small>
              </label>
              <label>
                PIS + COFINS na conta (%)
                <input name="pisCofins" inputMode="decimal" required defaultValue={pct(p.tributos.pisCofins)} />
                <small className="entrada-ajuda">Muda todo mês; a conta traz a alíquota. Uma média de 4% a 6% serve.</small>
              </label>
            </div>
            <details className="dobra-limpa">
              <summary>Avançado: valores de reserva</summary>
              <p className="nota">Só valem se a ANEEL e a tabela guardada no sistema não tiverem a distribuidora, ou se a cidade não estiver no Atlas do INPE.</p>
              <div className="dupla">
                <label>
                  Tarifa de reserva, com impostos (R$/kWh)
                  <input name="tarifaKwh" inputMode="decimal" required defaultValue={num(p.tarifaKwh)} />
                  <small className="entrada-ajuda">Total da conta ÷ kWh consumidos.</small>
                </label>
                <label>
                  Fio B de reserva, com impostos (R$/kWh)
                  <input name="fioBKwh" inputMode="decimal" required defaultValue={num(p.fioBKwh)} />
                </label>
                <label>
                  Sol de reserva (kWh/m² por dia)
                  <input name="irradiacaoDia" inputMode="decimal" required defaultValue={num(p.irradiacaoDia)} />
                </label>
              </div>
            </details>
          </div>
        </Cartao>

        <Cartao
          titulo="Cálculo da economia"
          icone={<Calculator size={16} />}
          ajuda="Propostas já geradas não mudam: guardam os números do dia em que foram feitas."
        >
          <div className="form-ficha">
            <div className="dupla">
              <label>
                Reajuste anual da tarifa (%)
                <input name="reajusteAnual" inputMode="decimal" required defaultValue={pct(p.reajusteAnual)} />
              </label>
              <label>
                Perda anual dos módulos (%)
                <input name="degradacaoAnual" inputMode="decimal" required defaultValue={pct(p.degradacaoAnual)} />
              </label>
              <label>
                Taxa de desconto, TMA (% ao ano)
                <input name="tma" inputMode="decimal" required defaultValue={pct(p.tma)} />
                <small className="entrada-ajuda">Para o valor presente (VPL) e o retorno descontado. Perto da Selic/CDI.</small>
              </label>
              <label>
                Validade da proposta (dias)
                <input name="validadeDias" inputMode="numeric" required defaultValue={p.validadeDias} />
                <small className="entrada-ajuda">Sem prazo dito, o CDC (art. 40) vale 10 dias.</small>
              </label>
              <label>
                Número da primeira proposta
                <input name="numeroInicial" inputMode="numeric" defaultValue={p.numeroInicial ?? ""} placeholder="em branco: 1" />
                <small className="entrada-ajuda">Para continuar a numeração que a empresa já tem.</small>
              </label>
            </div>
            <fieldset>
              <legend>Perfis de desempenho</legend>
              <EditorDePerfis nome="perfisDesempenho" nomeDoPadrao="desempenho" inicial={p.perfisDesempenho} rotuloValor="Desempenho (%)" />
            </fieldset>
            <fieldset>
              <legend>Perfis de simultaneidade</legend>
              <EditorDePerfis nome="perfisSimultaneidade" nomeDoPadrao="simultaneidade" inicial={p.perfisSimultaneidade} rotuloValor="Consumo na hora (%)" />
            </fieldset>
          </div>
        </Cartao>

        <Cartao
          titulo="Dimensionamento"
          icone={<Gauge size={16} />}
          ajuda="Potência de módulos ÷ potência do inversor (CC/CA). O kit sugerido busca o alvo e não passa do máximo; acima disso o inversor corta a geração do meio-dia (clipping). Confira o limite no datasheet do inversor."
        >
          <div className="form-ficha">
            <div className="dupla">
              <label>
                Relação CC/CA alvo (%)
                <input name="sobreAlvo" inputMode="decimal" required defaultValue={pct(p.sobredimensionamento.alvo)} />
                <small className="entrada-ajuda">115 = 15% a mais de módulo que de inversor.</small>
              </label>
              <label>
                Relação CC/CA máxima (%)
                <input name="sobreMaximo" inputMode="decimal" required defaultValue={pct(p.sobredimensionamento.maximo)} />
              </label>
            </div>
          </div>
        </Cartao>

        <Cartao
          titulo="Custos e margem"
          icone={<Wallet size={16} />}
          ajuda="O preço sugerido é o kit mais estes custos, com a margem e o imposto. No assistente dá para desligar um custo ou mudar o valor numa proposta só."
        >
          <div className="form-ficha">
            <EditorDeCustos inicial={p.precificacao.itens} telhados={OPCOES_DE_TELHADO} />
            <div className="dupla">
              <label>
                Margem de lucro (%)
                <input name="margem" inputMode="decimal" required defaultValue={pct(p.precificacao.margem)} />
              </label>
              <label>
                Imposto sobre a venda (%)
                <input name="imposto" inputMode="decimal" required defaultValue={pct(p.precificacao.imposto)} />
                <small className="entrada-ajuda">A alíquota efetiva do regime da empresa (Simples, por exemplo). Pergunte ao contador.</small>
              </label>
              <label>
                Margem
                <select name="margemPorDentro" defaultValue={p.precificacao.margemPorDentro ? "dentro" : "fora"}>
                  <option value="dentro">Por dentro: preço = custo ÷ (1 − margem − imposto)</option>
                  <option value="fora">Por fora: custo × (1 + margem), e o imposto por dentro</option>
                </select>
              </label>
              <label>
                Arredondar o preço para cima, de (R$)
                <input name="arredondar" inputMode="decimal" defaultValue={num(p.precificacao.arredondar)} />
                <small className="entrada-ajuda">10 → R$ 18.043,58 vira R$ 18.050. Zero: não arredonda.</small>
              </label>
            </div>
          </div>
        </Cartao>

        <Cartao titulo="Deslocamento" icone={<Truck size={16} />} ajuda="Até o raio, o deslocamento já está nos custos. Além dele, cobra-se o km rodado (ida e volta), medido da cidade da base até a cidade do cliente.">
          <div className="form-ficha">
            <div className="dupla">
              <label>
                Cidade da base
                <input name="logisticaCidade" defaultValue={p.logistica.cidade} />
              </label>
              <label>
                UF
                <input name="logisticaUf" maxLength={2} defaultValue={p.logistica.uf} />
              </label>
              <label>
                Raio sem cobrança (km)
                <input name="raioKm" inputMode="decimal" defaultValue={num(p.logistica.raioKm)} />
              </label>
              <label>
                R$ por km além do raio
                <input name="valorKm" inputMode="decimal" defaultValue={num(p.logistica.valorKm)} />
              </label>
            </div>
          </div>
        </Cartao>

        <Cartao titulo="Garantias (anos)" icone={<ShieldCheck size={16} />} ajuda="Saem na página do sistema e no contrato. A garantia do equipamento é do fabricante.">
          <div className="form-ficha">
            <div className="dupla">
              <label>
                Inversor
                <input name="garantiaInversor" inputMode="numeric" required defaultValue={p.garantias.inversor} />
              </label>
              <label>
                Placas
                <input name="garantiaPlacas" inputMode="numeric" required defaultValue={p.garantias.placas} />
              </label>
              <label>
                Estrutura
                <input name="garantiaEstrutura" inputMode="numeric" required defaultValue={p.garantias.estrutura} />
              </label>
              <label>
                Eficiência dos módulos
                <input name="garantiaEficiencia" inputMode="numeric" required defaultValue={p.garantias.eficiencia} />
              </label>
            </div>
          </div>
        </Cartao>

        <Cartao titulo="Formas de pagamento" icone={<CreditCard size={16} />} ajuda="A página do investimento mostra as parcelas já calculadas (tabela Price), avisando que o banco confirma.">
          <div className="form-ficha">
            <div className="dupla">
              <label>
                Desconto à vista (%)
                <input name="aVistaDesconto" inputMode="decimal" defaultValue={pct(p.pagamento.aVistaDesconto)} />
              </label>
              <label>
                Cartão: parcelas, no máximo
                <input name="cartaoParcelas" inputMode="numeric" required defaultValue={p.cartao.parcelas} />
              </label>
              <label>
                Cartão: juros (% ao mês)
                <input name="cartaoTaxa" inputMode="decimal" required defaultValue={pct(p.cartao.taxaMes)} />
              </label>
              <label>
                Financiamento: dias até a primeira parcela (padrão)
                <input name="carencia" inputMode="numeric" required defaultValue={p.carenciaFinanciamentoDias} />
              </label>
            </div>
            <fieldset>
              <legend>Financiamentos</legend>
              <EditorDeFinanciamentos inicial={p.pagamento.financiamentos} />
            </fieldset>
          </div>
        </Cartao>

        <div className="barra-enviar">
          <button type="submit" className="botao">
            <Check size={15} aria-hidden /> Salvar
          </button>
        </div>
      </form>

      <form action={salvarCapa} className="pagina-estreita">
        <Cartao
          titulo="Capa da proposta"
          icone={<ImageIcon size={16} />}
          ajuda="A foto de fundo da primeira página, como a dos módulos ao pôr do sol da proposta que vocês usam hoje. Sem foto, a capa sai com um desenho nesse mesmo estilo. O logo vem de Dados da empresa."
        >
          <div className="form-ficha">
            {empresa?.propostaCapa ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={empresa.propostaCapa} alt="Foto da capa atual" className="capa-proposta" />
            ) : (
              <p className="nota">Sem foto: a capa sai com o desenho dos módulos.</p>
            )}
            {!empresa?.logo && (
              <p className="nota">
                Ainda sem logo: a capa leva o nome da empresa. <Link href="/administracao/empresa">Enviar o logo</Link>.
              </p>
            )}
            <label>
              {empresa?.propostaCapa ? "Trocar a foto" : "Enviar a foto"} <span className="fraco">(JPEG ou PNG, até 3 MB, em pé)</span>
              <input name="capa" type="file" accept="image/jpeg,image/png" />
            </label>
            {empresa?.propostaCapa && (
              <label className="marcar">
                <input type="checkbox" name="tirarCapa" value="sim" /> Tirar a foto e voltar ao desenho
              </label>
            )}
          </div>
        </Cartao>
        <div className="barra-enviar">
          <button type="submit" className="botao secundario">
            <Check size={15} aria-hidden /> Salvar a capa
          </button>
        </div>
      </form>
    </main>
  );
}
