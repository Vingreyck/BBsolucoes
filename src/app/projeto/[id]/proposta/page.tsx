import { and, eq } from "drizzle-orm";
import { FileSpreadsheet } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { db, schema } from "@/db";
import { exigirGestaoWeb } from "@/os/acesso";
import { OPCOES_DE_TELHADO } from "@/projeto/da-vistoria";
import { dadosTecnicosDosProjetos } from "@/projeto/aproveitar-vistoria";
import { lerEstado } from "@/proposta/assistente";
import {
  candidatosDeInversor,
  catalogoDaEmpresa,
  contextoDoAssistente,
  estadoInicialDoProjeto,
  procurarEquipamentos,
} from "@/proposta/assistente-servidor";
import { ligacaoDosPolos } from "@/proposta/calculo";
import { distribuidoras } from "@/proposta/municipios";
import { premissasDaEmpresa, responsaveisPossiveis, ultimasPropostas } from "@/proposta/proposta-dados";

import { Cabecalho, Cartao } from "../../../_ui";
import { AssistenteDaProposta } from "./assistente";

export const dynamic = "force-dynamic";

/**
 * O assistente da proposta comercial, em sete etapas (as do Solarz, e o que ele
 * não tem): cliente, unidades consumidoras, dimensionamento, kit, custos,
 * resumo e gerar. O que se preenche fica guardado no projeto a cada etapa.
 */
export default async function PaginaDoAssistente({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ de?: string }>;
}) {
  const ator = await exigirGestaoWeb();
  const { id } = await params;
  const { de } = await searchParams;
  const origem = de === "esteira" ? "esteira" : "projeto";

  const projeto = await db.query.projeto.findFirst({
    where: and(eq(schema.projeto.id, id), eq(schema.projeto.empresaId, ator.empresaId)),
    with: { cliente: { columns: { id: true, nome: true, cidade: true, uf: true, tipo: true } } },
  });
  if (!projeto) notFound();

  const premissas = await premissasDaEmpresa(ator.empresaId);
  const trilha = [
    { href: origem === "esteira" ? "/esteira" : `/projeto/${projeto.id}`, rotulo: origem === "esteira" ? "Esteira" : projeto.titulo },
  ];
  if (!premissas) {
    return (
      <main>
        <Cabecalho trilha={trilha} titulo="Proposta comercial" meta={projeto.cliente.nome} />
        <div className="pagina-corpo">
          <Cartao titulo="Faltam as premissas" icone={<FileSpreadsheet size={16} />}>
            <p className="nota">
              A proposta precisa das premissas da empresa (impostos da conta, perfis, custos, margem, pagamentos), conferidas
              pelo adm.
            </p>
            {ator.papel === "adm" && (
              <Link href="/administracao/proposta" className="botao">
                Conferir as premissas
              </Link>
            )}
          </Cartao>
        </div>
      </main>
    );
  }

  const [catalogo, responsaveis, ucsDoCliente, vistoria, propostas] = await Promise.all([
    catalogoDaEmpresa(ator.empresaId),
    responsaveisPossiveis(ator.empresaId),
    db.query.unidadeConsumidora.findMany({
      where: and(eq(schema.unidadeConsumidora.empresaId, ator.empresaId), eq(schema.unidadeConsumidora.clienteId, projeto.cliente.id)),
      columns: { numeroInstalacao: true, concessionaria: true },
    }),
    dadosTecnicosDosProjetos(ator.empresaId, [projeto.id]),
    ultimasPropostas(ator.empresaId, [projeto.id]),
  ]);

  const doRascunho = lerEstado(projeto.propostaRascunho);
  const estado =
    doRascunho ??
    estadoInicialDoProjeto({
      cliente: projeto.cliente,
      projeto,
      ucsDoCliente,
      catalogo,
      premissas,
      ligacaoDaVistoria: ligacaoDosPolos(vistoria.get(projeto.id)?.dados.polos),
      responsavelId: responsaveis.some((r) => r.id === ator.id) ? ator.id : (projeto.responsavelId ?? responsaveis[0]?.id ?? null),
    });
  const contexto = await contextoDoAssistente(estado, premissas, "cache");
  const ultima = propostas.get(projeto.id) ?? null;

  return (
    <main>
      <Cabecalho
        trilha={trilha}
        titulo="Proposta comercial"
        meta={`${projeto.cliente.nome}${ultima ? ` · última gerada: nº ${ultima.numero}` : ""}${doRascunho ? " · continuando de onde parou" : ""}`}
      />
      <AssistenteDaProposta
        projetoId={projeto.id}
        origem={origem}
        cliente={projeto.cliente.nome}
        estadoInicial={estado}
        contextoInicial={contexto}
        distribuidoras={distribuidoras().map((d) => ({ cnpj: d.cnpj, nome: d.nome, sigla: d.sigla }))}
        responsaveis={responsaveis.map((r) => ({ id: r.id, nome: r.nome }))}
        candidatos={candidatosDeInversor(catalogo)}
        modulosSugeridos={procurarEquipamentos(catalogo, "", ["modulo"], 12)}
        telhados={OPCOES_DE_TELHADO}
        ehAdm={ator.papel === "adm"}
      />
    </main>
  );
}
