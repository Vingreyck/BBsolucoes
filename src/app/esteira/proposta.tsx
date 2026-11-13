import { FilePlus2, FileText } from "lucide-react";
import Link from "next/link";

import { linkWhatsapp } from "@/documentos/cobranca";
import { DISPONIBILIDADE_KWH, ROTULO_LIGACAO, type Ligacao } from "@/proposta/calculo";
import { telefoneBonito, type PropostaDoProjeto, type ResponsavelDaProposta } from "@/proposta/proposta-dados";
import { kwpDoProjeto, mensagemDaProposta, type EntradaProposta } from "@/proposta/proposta";

import { BotaoDialogo } from "../_ui/dialogo";
import { BotaoWhatsapp } from "../_ui/botao-whatsapp";
import { gerarProposta, marcarPropostaEnviada } from "./actions";

function data(d: Date): string {
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

const numeroBr = (n: number | null, casas: number) =>
  n === null ? "" : n.toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: casas });

const dinheiroBr = (v: string | number | null) => {
  const n = Number(v);
  return v === null || !Number.isFinite(n) || n <= 0 ? "" : n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

/**
 * A proposta comercial do projeto: gerar, ver o PDF e mandar ao cliente pelo
 * WhatsApp. Usado no cartão do Lead e no guia da tela do projeto.
 *
 * Valor, consumo e potência ficam num formulário (vêm preenchidos do projeto, e
 * o que mudar volta para ele). O que não se resolve ali, o kit e a cidade,
 * aparece como lista do que falta, **antes** do formulário.
 */
export function AcoesDaProposta({
  projetoId,
  entrada,
  ehAdm,
  proposta,
  whatsapp,
  origemSite,
  origem,
  chave,
  responsaveis,
  responsavelPadrao,
}: {
  projetoId: string;
  entrada: EntradaProposta;
  ehAdm: boolean;
  proposta: PropostaDoProjeto | null;
  whatsapp: string | null;
  origemSite: string;
  origem: "esteira" | "projeto";
  /** Quem pode assinar a proposta como Responsável Comercial. */
  responsaveis: ResponsavelDaProposta[];
  /** O id que vem marcado (ver `responsavelPadrao`). */
  responsavelPadrao: string;
  /** Muda depois de cada envio: a janelinha volta fechada. */
  chave: string;
}) {
  const nome = entrada.cliente.nome;
  const naCelula = origem === "esteira";
  const link = proposta ? `${origemSite}/r/p/${proposta.token}` : null;

  // Valor, consumo e potência se preenchem no formulário; só o resto barra antes.
  const falta = [
    !entrada.premissas ? "as premissas do cálculo (Administração → Proposta comercial)" : null,
    !entrada.cliente.cidade?.trim() ? "a cidade do cliente" : null,
    !entrada.modulo && !entrada.inversor && !entrada.projeto.equipamentos?.trim() ? "o kit de equipamentos (módulo e inversor)" : null,
    responsaveis.length === 0 ? "alguém ativo (administrador ou vendedor) para assinar como responsável" : null,
  ].filter((f): f is string => Boolean(f));
  const faltaPremissas = !entrada.premissas;

  return (
    <>
      {proposta && (
        <>
          <p className="cartao-projeto-falta">
            Proposta {proposta.numero} gerada em {data(proposta.criadoEm)}
            {proposta.validaAte ? ` · válida até ${proposta.validaAte.slice(0, 5)}` : ""}
            {proposta.enviadoEm ? ` · enviada em ${data(proposta.enviadoEm)}` : " · ainda não enviada"}
          </p>
          {whatsapp ? (
            <BotaoWhatsapp
              link={linkWhatsapp(
                whatsapp,
                mensagemDaProposta({ cliente: nome, empresa: entrada.empresa.nome, link: link!, validaAte: proposta.validaAte ?? "" }),
              )}
              rotulo={proposta.enviadoEm ? "Reenviar no WhatsApp" : "Enviar no WhatsApp"}
              classe={naCelula ? "botao botao-whatsapp botao-cartao" : "botao botao-whatsapp"}
              anotar={marcarPropostaEnviada.bind(null, proposta.id)}
            />
          ) : (
            <p className="cartao-projeto-falta">
              Sem um telefone válido no cadastro: <Link href={`/projeto/${projetoId}`}>corrigir</Link>.
            </p>
          )}
          <a className="link-acao" href={link!} target="_blank" rel="noreferrer">
            <FileText size={13} aria-hidden /> Ver a proposta (PDF)
          </a>
        </>
      )}

      <BotaoDialogo
        key={chave}
        rotulo={proposta ? "Gerar de novo" : "Gerar proposta"}
        icone={<FilePlus2 size={14} aria-hidden />}
        classe={proposta ? `botao secundario${naCelula ? " botao-cartao" : ""}` : `botao${naCelula ? " botao-cartao" : ""}`}
        titulo="Gerar proposta comercial"
        descricao={`${nome} · a proposta sai no modelo da empresa, com o kit, a geração estimada, a economia e as formas de pagamento. Depois é só mandar pelo WhatsApp; quando o cliente aceitar, clique em Aprovada.`}
      >
        {falta.length > 0 ? (
          <div className="contrato-falta">
            <p className="aviso erro" role="alert">
              Não dá para gerar a proposta: faltam dados que vão escritos nela.
            </p>
            <ul>
              {falta.map((f) => (
                <li key={f}>{f.charAt(0).toUpperCase() + f.slice(1)}</li>
              ))}
            </ul>
            <div className="barra-enviar">
              {falta.length > (faltaPremissas ? 1 : 0) && (
                <Link href={`/projeto/${projetoId}`} className="botao">
                  Completar no projeto
                </Link>
              )}
              {faltaPremissas &&
                (ehAdm ? (
                  <Link href="/administracao/proposta" className="botao secundario">
                    Conferir as premissas
                  </Link>
                ) : (
                  <span className="nota">As premissas do cálculo quem confere é o adm.</span>
                ))}
            </div>
          </div>
        ) : (
          <form action={gerarProposta.bind(null, projetoId, origem)} className="form-agendar form-agendar-coluna">
            <label className="entrada">
              <span className="entrada-rotulo">Responsável pela proposta</span>
              <select name="responsavelId" required defaultValue={responsavelPadrao}>
                {responsaveis.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.nome}
                    {telefoneBonito(r.telefone) ? ` · ${telefoneBonito(r.telefone)}` : " · sem telefone"}
                  </option>
                ))}
              </select>
              <small className="entrada-ajuda">
                O nome e o telefone saem na capa e na última página, para o cliente saber com quem falar.
              </small>
            </label>
            <label className="entrada">
              <span className="entrada-rotulo">Valor do investimento (R$)</span>
              <input name="valor" inputMode="decimal" required defaultValue={dinheiroBr(entrada.projeto.valor)} placeholder="10.431,95" />
              <small className="entrada-ajuda">O mesmo valor do contrato: fica salvo no projeto.</small>
            </label>
            <label className="entrada">
              <span className="entrada-rotulo">Consumo médio mensal (kWh)</span>
              <input
                name="consumoMedioKwh"
                inputMode="decimal"
                required
                defaultValue={numeroBr(Number(entrada.projeto.consumoMedioKwh) || null, 2)}
                placeholder="445"
              />
              <small className="entrada-ajuda">A média dos meses da conta de luz.</small>
            </label>
            <label className="entrada">
              <span className="entrada-rotulo">Potência do sistema (kWp)</span>
              <input name="potenciaKwp" inputMode="decimal" required defaultValue={numeroBr(kwpDoProjeto(entrada), 3)} placeholder="3,72" />
              <small className="entrada-ajuda">Já vem dos módulos do kit, quando eles estão no catálogo.</small>
            </label>
            <label className="entrada">
              <span className="entrada-rotulo">Ligação do cliente</span>
              <select name="ligacao" defaultValue={entrada.ligacao}>
                {(Object.keys(DISPONIBILIDADE_KWH) as Ligacao[]).map((l) => (
                  <option key={l} value={l}>
                    {ROTULO_LIGACAO[l]}
                  </option>
                ))}
              </select>
              <small className="entrada-ajuda">Define o mínimo que a distribuidora cobra mesmo com a usina. Está na conta de luz.</small>
            </label>
            <button type="submit" className="botao">
              <FilePlus2 size={15} aria-hidden /> Gerar a proposta
            </button>
          </form>
        )}
      </BotaoDialogo>
    </>
  );
}
