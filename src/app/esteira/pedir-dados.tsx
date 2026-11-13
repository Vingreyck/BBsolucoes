import { linkWhatsapp, numeroWhatsapp } from "@/documentos/cobranca";
import { dadosDoClienteQueFaltam, mensagemDeDadosDoCliente, rotuloDoPedidoDeDados } from "@/projeto/contrato";

import { BotaoWhatsapp } from "../_ui/botao-whatsapp";

/**
 * "Cobrar CPF no WhatsApp": pede ao cliente o que falta do cadastro dele (CPF,
 * CEP e endereço), com a mensagem pronta. Só aparece se falta alguma coisa e o
 * cadastro tem um telefone válido; sem telefone, diz isso em vez de sumir.
 *
 * O CPF é opcional na criação do projeto, mas o contrato não sai sem ele. Este
 * botão é o caminho de volta: o comercial pede por aqui, o cliente manda, e o
 * dado entra no cartão "Cliente e endereço".
 */
export function PedirDadosDoCliente({
  cliente,
  empresa,
  classe = "botao botao-whatsapp",
}: {
  cliente: {
    nome: string;
    telefone: string | null;
    tipo: "pf" | "pj";
    cpfCnpj: string | null;
    logradouro: string | null;
    numero: string | null;
    bairro: string | null;
    cep: string | null;
  };
  empresa: string;
  classe?: string;
}) {
  const faltam = dadosDoClienteQueFaltam(cliente);
  if (!faltam.length) return null;
  const whatsapp = numeroWhatsapp(cliente.telefone);
  if (!whatsapp) return <p className="cartao-projeto-falta">Sem telefone válido no cadastro: não dá para pedir o CPF.</p>;
  const pj = cliente.tipo === "pj";
  return (
    <BotaoWhatsapp
      link={linkWhatsapp(whatsapp, mensagemDeDadosDoCliente({ cliente: cliente.nome, empresa, faltam, pj }))}
      rotulo={rotuloDoPedidoDeDados(faltam, pj)}
      classe={classe}
    />
  );
}
