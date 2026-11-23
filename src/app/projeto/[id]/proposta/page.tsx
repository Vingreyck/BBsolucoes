import { and, desc, eq, inArray, isNotNull } from "drizzle-orm";
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
  moduloPadrao,
  procurarEquipamentos,
} from "@/proposta/assistente-servidor";
import { ligacaoDosPolos } from "@/proposta/calculo";
import { leituraDeContaLigada } from "@/proposta/ler-conta";
import { distribuidoras } from "@/proposta/municipios";
import { premissasDaEmpresa, responsaveisPossiveis, telefoneBonito, ultimasPropostas } from "@/proposta/proposta-dados";

import { Cabecalho, Cartao } from "../../../_ui";
import { AssistenteDaProposta } from "./assistente";

export const dynamic = "force-dynamic";

/**
 * A proposta comercial de um cliente, numa tela só (23/11): o que o Solarz
 * pede em sete etapas, aqui sai sozinho — o consumo da conta de luz (lida pelo
 * Claude, do dossiê ou de uma foto), a área e a sombra da vistoria, a
 * distribuidora pela cidade, a tarifa da ANEEL, o sol do INPE, o kit (módulo
 * padrão, quantidade e inversor) e o preço pelos custos do catálogo. Os blocos
 * abrem só para ajustar. O que se preenche fica guardado no projeto.
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
    with: {
      cliente: { columns: { id: true, nome: true, cidade: true, uf: true, tipo: true, telefone: true } },
      etapa: { columns: { nome: true } },
      responsavel: { columns: { nome: true } },
    },
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

  const [catalogo, responsaveis, ucsDoCliente, vistoria, propostas, contas] = await Promise.all([
    catalogoDaEmpresa(ator.empresaId),
    responsaveisPossiveis(ator.empresaId),
    db.query.unidadeConsumidora.findMany({
      where: and(eq(schema.unidadeConsumidora.empresaId, ator.empresaId), eq(schema.unidadeConsumidora.clienteId, projeto.cliente.id)),
      columns: { numeroInstalacao: true, concessionaria: true },
    }),
    dadosTecnicosDosProjetos(ator.empresaId, [projeto.id]),
    ultimasPropostas(ator.empresaId, [projeto.id]),
    // A conta de luz que já está no dossiê: dá para ler sem pedir de novo ao cliente.
    db
      .select({ tipo: schema.documento.tipo, nome: schema.documento.nomeArquivo, criadoEm: schema.documento.criadoEm })
      .from(schema.documento)
      .where(
        and(
          eq(schema.documento.empresaId, ator.empresaId),
          eq(schema.documento.clienteId, projeto.cliente.id),
          inArray(schema.documento.tipo, ["uc_geradora", "uc_beneficiaria"]),
          isNotNull(schema.documento.linkDrive),
        ),
      )
      .orderBy(desc(schema.documento.criadoEm))
      .limit(10),
  ]);
  const daVistoria = vistoria.get(projeto.id) ?? null;
  const contaGeradora = contas.find((c) => c.tipo === "uc_geradora") ?? null;

  const doRascunho = lerEstado(projeto.propostaRascunho);
  const estado =
    doRascunho ??
    estadoInicialDoProjeto({
      cliente: projeto.cliente,
      projeto,
      ucsDoCliente,
      catalogo,
      premissas,
      ligacaoDaVistoria: ligacaoDosPolos(daVistoria?.dados.polos),
      sombraDaVistoria: daVistoria?.dados.sombra ?? null,
      responsavelId: responsaveis.some((r) => r.id === ator.id) ? ator.id : (projeto.responsavelId ?? responsaveis[0]?.id ?? null),
    });
  const contexto = await contextoDoAssistente(estado, premissas, "cache");
  const ultima = propostas.get(projeto.id) ?? null;

  return (
    <main className="pc-pagina">
      <AssistenteDaProposta
        projetoId={projeto.id}
        origem={origem}
        cliente={{
          nome: projeto.cliente.nome,
          tipo: projeto.cliente.tipo,
          cidade: projeto.cliente.cidade,
          uf: projeto.cliente.uf,
          telefone: telefoneBonito(projeto.cliente.telefone),
          etapa: projeto.etapa?.nome ?? null,
          responsavel: projeto.responsavel?.nome ?? null,
          projeto: projeto.titulo,
        }}
        ultima={ultima ? { numero: ultima.numero, visualizacoes: ultima.visualizacoes, enviada: Boolean(ultima.enviadoEm) } : null}
        continuando={Boolean(doRascunho)}
        vistoria={
          daVistoria
            ? {
                areaUtilM2: daVistoria.dados.areaUtilM2,
                sombra: daVistoria.dados.sombra,
                osNumero: daVistoria.osNumero,
                concluida: daVistoria.concluida,
                ligacao: ligacaoDosPolos(daVistoria.dados.polos),
              }
            : null
        }
        leituraLigada={leituraDeContaLigada()}
        contaNoDossie={
          contaGeradora
            ? { nome: contaGeradora.nome, em: contaGeradora.criadoEm.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "America/Sao_Paulo" }) }
            : null
        }
        temContaDeBeneficiaria={contas.some((c) => c.tipo === "uc_beneficiaria")}
        estadoInicial={estado}
        contextoInicial={contexto}
        distribuidoras={distribuidoras().map((d) => ({ cnpj: d.cnpj, nome: d.nome, sigla: d.sigla }))}
        responsaveis={responsaveis.map((r) => ({ id: r.id, nome: r.nome }))}
        candidatos={candidatosDeInversor(catalogo)}
        modulosSugeridos={procurarEquipamentos(catalogo, "", ["modulo"], 12)}
        moduloPadrao={moduloPadrao(catalogo)}
        telhados={OPCOES_DE_TELHADO}
        ehAdm={ator.papel === "adm"}
      />
    </main>
  );
}
