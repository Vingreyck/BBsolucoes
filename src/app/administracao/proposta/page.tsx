import { eq } from "drizzle-orm";
import { Calculator, Check, CreditCard, Image as ImageIcon, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { exigirUsuario } from "@/auth/sessao";
import { db, schema } from "@/db";
import { lerPremissas, SUGESTAO, type Premissas } from "@/proposta/premissas";

import { Cabecalho, Cartao } from "../../_ui";
import { salvarCapa, salvarPremissas } from "./actions";

export const dynamic = "force-dynamic";

/** Fração → texto de formulário: 0,75 vira "75"; 0,007 vira "0,7". */
const pct = (f: number) => String(+(f * 100).toFixed(3)).replace(".", ",");
const num = (n: number) => String(n).replace(".", ",");

/**
 * Premissas da proposta comercial: o que o cálculo de economia assume e os
 * textos de garantia e pagamento.
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

  return (
    <main>
      <Cabecalho
        titulo="Proposta comercial"
        meta="O que o cálculo da proposta assume (tarifa, Fio B, irradiação, desempenho) e os textos de garantia e pagamento."
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
          sugestão: confira cada um (principalmente tarifa e Fio B, que vêm da conta de luz e da distribuidora) e clique
          em Salvar.
        </p>
      )}

      <form action={salvarPremissas} className="pagina-estreita">
        <Cartao
          titulo="Cálculo da economia"
          icone={<Calculator size={16} />}
          ajuda="Propostas já geradas não mudam: guardam os números do dia em que foram feitas. O cálculo é uma estimativa e o PDF diz isso, com estas premissas no rodapé."
        >
          <div className="form-ficha">
            <div className="dupla">
              <label>
                Tarifa (R$ por kWh, com impostos)
                <input name="tarifaKwh" inputMode="decimal" required defaultValue={num(p.tarifaKwh)} />
                <small className="entrada-ajuda">Valor total por kWh que a conta de luz cobra (energia + fio + impostos).</small>
              </label>
              <label>
                Fio B (R$ por kWh)
                <input name="fioBKwh" inputMode="decimal" required defaultValue={num(p.fioBKwh)} />
                <small className="entrada-ajuda">TUSD Fio B cheia da distribuidora. A lei cobra 60% em 2026, 75% em 2027 e 90% em 2028.</small>
              </label>
              <label>
                Irradiação local (kWh/m² por dia)
                <input name="irradiacaoDia" inputMode="decimal" required defaultValue={num(p.irradiacaoDia)} />
                <small className="entrada-ajuda">Média anual da região. Confira no CRESESB (SunData) pela cidade.</small>
              </label>
              <label>
                Desempenho do sistema (%)
                <input name="desempenho" inputMode="decimal" required defaultValue={pct(p.desempenho)} />
                <small className="entrada-ajuda">Perdas de inversor, cabos, temperatura e sujeira. O mercado usa de 75 a 80.</small>
              </label>
              <label>
                Consumo atendido na hora (%)
                <input name="simultaneidade" inputMode="decimal" required defaultValue={pct(p.simultaneidade)} />
                <small className="entrada-ajuda">O que se gasta durante o dia, sem passar pela rede, não paga Fio B.</small>
              </label>
              <label>
                Reajuste anual da tarifa (%)
                <input name="reajusteAnual" inputMode="decimal" required defaultValue={pct(p.reajusteAnual)} />
              </label>
              <label>
                Perda anual dos módulos (%)
                <input name="degradacaoAnual" inputMode="decimal" required defaultValue={pct(p.degradacaoAnual)} />
              </label>
              <label>
                Validade da proposta (dias)
                <input name="validadeDias" inputMode="numeric" required defaultValue={p.validadeDias} />
                <small className="entrada-ajuda">Sem prazo dito, o CDC (art. 40) vale 10 dias.</small>
              </label>
              <label>
                Número da primeira proposta
                <input name="numeroInicial" inputMode="numeric" defaultValue={p.numeroInicial ?? ""} placeholder="em branco: 1" />
                <small className="entrada-ajuda">Para continuar a numeração que a empresa já tem. Só vale se for maior que a última.</small>
              </label>
            </div>
          </div>
        </Cartao>

        <Cartao titulo="Garantias (anos)" icone={<ShieldCheck size={16} />} ajuda="Saem na página do sistema. A garantia do equipamento é do fabricante.">
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

        <Cartao titulo="Formas de pagamento" icone={<CreditCard size={16} />} ajuda="Saem na página do investimento.">
          <div className="form-ficha">
            <div className="dupla">
              <label>
                Cartão: parcelas, no máximo
                <input name="cartaoParcelas" inputMode="numeric" required defaultValue={p.cartao.parcelas} />
              </label>
              <label>
                Cartão: taxa a partir de (% ao mês)
                <input name="cartaoTaxa" inputMode="decimal" required defaultValue={pct(p.cartao.taxaMes)} />
              </label>
              <label>
                Financiamento: dias até a primeira parcela
                <input name="carencia" inputMode="numeric" required defaultValue={p.carenciaFinanciamentoDias} />
              </label>
            </div>
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
