import { FileSignature, FileText } from "lucide-react";
import Link from "next/link";

import { linkWhatsapp } from "@/documentos/cobranca";
import {
  faltaDaEmpresa,
  faltaParaContrato,
  mensagemDoContrato,
  type EntradaContrato,
  type PagamentoCombinado,
} from "@/projeto/contrato";
import type { Representante } from "@/projeto/contrato-dados";

import { BotaoDialogo } from "../_ui/dialogo";
import { BotaoWhatsapp } from "../_ui/botao-whatsapp";
import { gerarContrato, marcarContratoEnviado } from "./actions";
import { PedirDadosDoCliente } from "./pedir-dados";

const PAPEL: Record<string, string> = { adm: "ADM", engenheiro: "Engenheiro" };

function data(d: Date): string {
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

/**
 * O contrato do projeto: gerar, ver o PDF e mandar ao cliente pelo WhatsApp.
 *
 * Usado no cartão da etapa Contrato e no guia da tela do projeto. Server
 * Component: a janelinha recebe pronto o formulário (ou a lista do que falta).
 *
 * O que falta é conferido **antes** de abrir o formulário. O kit e quem assina
 * ficam de fora dessa conferência porque são preenchidos ali mesmo.
 */
export function AcoesDoContrato({
  projetoId,
  entrada,
  equipamentos,
  contrato,
  representantes,
  whatsapp,
  origemSite,
  origem,
  ehAdm,
  chave,
}: {
  projetoId: string;
  entrada: EntradaContrato;
  equipamentos: string | null;
  contrato: {
    id: string;
    token: string;
    criadoEm: Date;
    enviadoEm: Date | null;
    representante: string | null;
    combinado: PagamentoCombinado | null;
  } | null;
  representantes: Representante[];
  whatsapp: string | null;
  origemSite: string;
  origem: "esteira" | "projeto";
  ehAdm: boolean;
  /** Muda depois de cada envio: a janelinha volta fechada. */
  chave: string;
}) {
  const nome = entrada.cliente.nome;
  const falta = faltaParaContrato({
    ...entrada,
    projeto: { ...entrada.projeto, equipamentos: "preenchido no formulário" },
    representante: { nome: "escolhido no formulário", cpf: null },
  });
  const daEmpresa = faltaDaEmpresa(falta);
  const linkPdf = contrato ? `${origemSite}/r/c/${contrato.token}` : null;
  const naCelula = origem === "esteira";
  const combinado = contrato?.combinado ?? null;
  const reais = (v: number) => v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <>
      {contrato && (
        <>
          <p className="cartao-projeto-falta">
            Contrato gerado em {data(contrato.criadoEm)}
            {contrato.representante ? ` · assina ${contrato.representante}` : ""}
            {contrato.enviadoEm ? ` · enviado em ${data(contrato.enviadoEm)}` : " · ainda não enviado"}
          </p>
          {whatsapp ? (
            <BotaoWhatsapp
              link={linkWhatsapp(whatsapp, mensagemDoContrato({ cliente: nome, empresa: entrada.empresa.nome, link: linkPdf! }))}
              rotulo={contrato.enviadoEm ? "Reenviar no WhatsApp" : "Enviar no WhatsApp"}
              classe={naCelula ? "botao botao-whatsapp botao-cartao" : "botao botao-whatsapp"}
              anotar={marcarContratoEnviado.bind(null, contrato.id)}
            />
          ) : (
            <p className="cartao-projeto-falta">
              Sem um telefone válido no cadastro: <Link href={`/projeto/${projetoId}`}>corrigir</Link>.
            </p>
          )}
          <a className="link-acao" href={linkPdf!} target="_blank" rel="noreferrer">
            <FileText size={13} aria-hidden /> Ver o contrato (PDF)
          </a>
        </>
      )}

      <BotaoDialogo
        key={chave}
        rotulo={contrato ? "Gerar de novo" : "Gerar contrato"}
        icone={<FileSignature size={14} aria-hidden />}
        classe={
          contrato
            ? `botao secundario${naCelula ? " botao-cartao" : ""}`
            : `botao${naCelula ? " botao-cartao" : ""}`
        }
        titulo="Gerar contrato"
        descricao={`${nome} · o contrato de prestação de serviços sai com os dados do cliente, do projeto e da empresa. Depois é só mandar pelo WhatsApp; quando a via assinada subir no dossiê, o projeto anda sozinho.`}
      >
        {falta.length > 0 ? (
          <div className="contrato-falta">
            <p className="aviso erro" role="alert">
              Não dá para gerar o contrato: faltam dados que vão escritos nele.
            </p>
            <ul>
              {falta.map((f) => (
                <li key={f}>{f.charAt(0).toUpperCase() + f.slice(1)}</li>
              ))}
            </ul>
            <div className="barra-enviar">
              <PedirDadosDoCliente cliente={{ ...entrada.cliente, telefone: whatsapp }} empresa={entrada.empresa.nome} />
              {falta.length > daEmpresa.length && (
                <Link href={`/projeto/${projetoId}`} className="botao">
                  Completar no projeto
                </Link>
              )}
              {daEmpresa.length > 0 &&
                (ehAdm ? (
                  <Link href="/administracao/empresa" className="botao secundario">
                    Completar os dados da empresa
                  </Link>
                ) : (
                  <span className="nota">Os dados da empresa quem completa é o adm.</span>
                ))}
            </div>
          </div>
        ) : (
          <form action={gerarContrato.bind(null, projetoId, origem)} className="form-agendar form-agendar-coluna">
            <label className="entrada">
              <span className="entrada-rotulo">Quem assina pela empresa</span>
              <select name="representanteId" required defaultValue="">
                <option value="" disabled>
                  {representantes.length ? "Escolha o adm ou o engenheiro…" : "Nenhum adm ou engenheiro com conta"}
                </option>
                {representantes.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.nome} ({PAPEL[r.papel] ?? r.papel})
                  </option>
                ))}
              </select>
              <small className="entrada-ajuda">
                Fica registrado aqui no sistema. No contrato sai a razão social e o CNPJ, como no modelo da empresa.
              </small>
            </label>
            <label className="entrada">
              <span className="entrada-rotulo">Equipamentos (objeto do contrato)</span>
              <textarea
                name="equipamentos"
                rows={3}
                required
                maxLength={1000}
                defaultValue={equipamentos ?? ""}
                placeholder="2 inversores Growatt on-grid 10K 220V, 40 módulos fotovoltaicos Jinko 625W / estrutura fibrocimento"
              />
              <small className="entrada-ajuda">
                Já vem sugerido com o kit do catálogo e o telhado da vistoria, quando existem. Confira e corrija. Fica
                salvo no projeto.
              </small>
            </label>
            <fieldset className="entrada contrato-pagamento">
              <legend className="entrada-rotulo">Entrada (se a venda teve entrada)</legend>
              <div className="dupla">
                <label>
                  Valor da entrada (R$)
                  <input
                    name="entrada"
                    inputMode="decimal"
                    placeholder="2.800,00"
                    defaultValue={combinado ? reais(combinado.entrada) : ""}
                  />
                </label>
                <label>
                  Saldo em quantas parcelas
                  <input
                    name="parcelas"
                    type="number"
                    min={1}
                    max={120}
                    placeholder="2"
                    defaultValue={combinado ? String(combinado.parcelas) : ""}
                  />
                </label>
              </div>
              <label>
                O saldo é pago
                <input
                  name="saldoQuando"
                  maxLength={200}
                  placeholder="após a finalização do projeto"
                  defaultValue={combinado?.quando ?? ""}
                />
              </label>
              <small className="entrada-ajuda">
                Em branco, a cláusula do pagamento sai com o valor total, a forma e as condições do projeto. Com
                entrada, sai como no modelo: entrada, valor total, saldo e o valor de cada parcela, por extenso.
              </small>
            </fieldset>
            <button type="submit" className="botao">
              <FileSignature size={15} aria-hidden /> Gerar o contrato
            </button>
          </form>
        )}
      </BotaoDialogo>
    </>
  );
}
