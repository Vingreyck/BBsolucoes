import { Eye, FilePlus2, FileText, Pencil } from "lucide-react";
import Link from "next/link";

import { linkWhatsapp } from "@/documentos/cobranca";
import type { PropostaDoProjeto, ResponsavelDaProposta } from "@/proposta/proposta-dados";
import { mensagemDaProposta, type EntradaProposta } from "@/proposta/proposta";

import { BotaoWhatsapp } from "../_ui/botao-whatsapp";
import { marcarPropostaEnviada } from "./actions";

function data(d: Date): string {
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "America/Sao_Paulo" });
}

/**
 * A proposta comercial do projeto no cartão do Lead e no guia da tela do
 * projeto: a última gerada (quando, se foi enviada, quantas vezes o cliente
 * abriu), o WhatsApp, o PDF e o botão do assistente.
 *
 * Desde 23/11 a proposta se monta no assistente (`/projeto/<id>/proposta`), com
 * as unidades consumidoras, o kit da base da ANEEL, os custos e as parcelas. A
 * janelinha antiga, que só pedia valor e consumo, saiu: duas contas diferentes
 * para a mesma proposta confundiriam.
 */
export function AcoesDaProposta({
  projetoId,
  entrada,
  ehAdm,
  proposta,
  whatsapp,
  origemSite,
  origem,
  temRascunho = false,
}: {
  projetoId: string;
  entrada: EntradaProposta;
  ehAdm: boolean;
  proposta: PropostaDoProjeto | null;
  whatsapp: string | null;
  origemSite: string;
  origem: "esteira" | "projeto";
  /** Há um assistente começado e ainda não gerado. */
  temRascunho?: boolean;
  /** Não usado desde 23/11 (o responsável se escolhe no assistente). */
  responsaveis?: ResponsavelDaProposta[];
  responsavelPadrao?: string;
  chave?: string;
}) {
  const nome = entrada.cliente.nome;
  const naCelula = origem === "esteira";
  const link = proposta ? `${origemSite}/r/p/${proposta.token}` : null;
  const assistente = `/projeto/${projetoId}/proposta?de=${origem}`;

  return (
    <>
      {proposta && (
        <>
          <p className="cartao-projeto-falta">
            Proposta {proposta.numero} gerada em {data(proposta.criadoEm)}
            {proposta.validaAte ? ` · válida até ${proposta.validaAte.slice(0, 5)}` : ""}
            {proposta.enviadoEm ? ` · enviada em ${data(proposta.enviadoEm)}` : " · ainda não enviada"}
          </p>
          {proposta.enviadoEm && (
            <p className={`cartao-projeto-falta${proposta.visualizacoes > 0 ? " proposta-aberta" : ""}`}>
              <Eye size={12} aria-hidden />{" "}
              {proposta.visualizacoes > 0
                ? `O cliente abriu ${proposta.visualizacoes === 1 ? "1 vez" : `${proposta.visualizacoes} vezes`}${proposta.ultimaVisualizacaoEm ? `, a última em ${data(proposta.ultimaVisualizacaoEm)}` : ""}`
                : "O cliente ainda não abriu"}
            </p>
          )}
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
          <a className="link-acao" href={`${link!}?v=equipe`} target="_blank" rel="noreferrer">
            <FileText size={13} aria-hidden /> Ver a proposta (PDF)
          </a>
        </>
      )}

      {!entrada.premissas ? (
        ehAdm ? (
          <Link href="/administracao/proposta" className={`botao secundario${naCelula ? " botao-cartao" : ""}`}>
            Conferir as premissas da proposta
          </Link>
        ) : (
          <span className="nota">A proposta precisa das premissas, que o adm confere.</span>
        )
      ) : (
        <Link href={assistente} className={`${proposta ? "botao secundario" : "botao"}${naCelula ? " botao-cartao" : ""}`}>
          {proposta ? <Pencil size={14} aria-hidden /> : <FilePlus2 size={14} aria-hidden />}{" "}
          {temRascunho && !proposta ? "Continuar a proposta" : proposta ? "Refazer a proposta" : "Montar a proposta"}
        </Link>
      )}
    </>
  );
}
