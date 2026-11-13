"use server";

import { and, eq, ne, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { exigirAcessoDocumentos } from "@/auth/permissao";
import { db, schema } from "@/db";
import { driveConfigurado, enviarArquivo } from "@/documentos/drive";
import { limparNome, pastaDoCliente } from "@/documentos/pastas";
import { ehDoCliente, numeroWhatsapp } from "@/documentos/cobranca";
import { tipoDoDocumento } from "@/documentos/conteudo";
import { filaDeCobranca } from "@/documentos/fila-cobranca";
import { lerNumeroDoPortal } from "@/energisa/envio";
import { vincularPendentes } from "@/energisa/sincronizar";
import { numeroDoProjeto } from "@/energisa/situacoes";
import { avancarPorDocumentos } from "@/projeto/automatico";
import { moverNaEsteira } from "@/projeto/esteira";

/**
 * Sobe um documento pelo Selebi.
 *
 * Este é o ponto em que a adivinhação por nome de arquivo deixa de existir. A
 * importação precisou adivinhar o tipo pelo nome porque os 2.788 arquivos já
 * estavam lá; daqui para a frente o tipo vem do **slot** em que a pessoa
 * clicou, e não há o que errar.
 *
 * O arquivo vai para o Drive da empresa, na pasta do cliente, com o nome no
 * padrão `TIPO - CLIENTE.pdf`. **Sem comprimir** — decisão explícita do dono, e
 * a certa: comprimir PDF escaneado é degradar um papel que pode virar prova.
 */

/** 60 MB. O maior memorial escaneado do Drive da BB tem 30. */
const TAMANHO_MAXIMO = 60 * 1024 * 1024;

const ROTULO_ARQUIVO: Record<string, string> = {
  art: "ART",
  boleto_art: "BOLETO ART",
  contrato: "CONTRATO",
  memorial: "MEMORIAL",
  procuracao: "PROCURACAO",
  recibo: "RECIBO",
  documento_pessoal: "DOCUMENTO",
  uc_geradora: "UC GERADORA",
  projeto_eletrico: "PROJETO ELETRICO",
  simulacao: "SIMULACAO",
  uc_beneficiaria: "UCS",
  compensativo: "COMPENSATIVO",
  nota_fiscal: "NOTA FISCAL",
  ficha_cadastral: "FICHA",
  datasheet: "DATASHEET",
  comprovante: "COMPROVANTE",
  declaracao: "DECLARACAO",
  orcamento: "ORCAMENTO",
  foto_padrao: "PADRAO",
  protocolo: "PROTOCOLO",
  outro: "OUTRO",
};

export interface ResultadoEnvio {
  erro?: string;
  ok?: string;
}

export async function enviarDocumento(
  _anterior: ResultadoEnvio,
  form: FormData,
): Promise<ResultadoEnvio> {
  const acesso = await exigirAcessoDocumentos();
  const usuario = acesso.usuario;

  if (!driveConfigurado()) {
    return {
      erro:
        "O Drive ainda não está conectado. Rode `npm run drive:autorizar` e " +
        "coloque GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET e GOOGLE_REFRESH_TOKEN no .env.",
    };
  }

  const projetoId = String(form.get("projetoId") ?? "");
  const tipo = String(form.get("tipo") ?? "") as
    (typeof schema.tipoDocumento.enumValues)[number];
  const assinado = form.get("assinado") === "sim";
  const arquivo = form.get("arquivo");

  if (!(arquivo instanceof File) || arquivo.size === 0) {
    return { erro: "Escolha um arquivo." };
  }
  if (arquivo.size > TAMANHO_MAXIMO) {
    const mb = Math.round(arquivo.size / 1024 / 1024);
    return { erro: `O arquivo tem ${mb} MB e o limite é 60 MB.` };
  }
  /**
   * O tipo vale pelo conteúdo. O `arquivo.type` é o que o navegador declarou, e
   * quem declara é quem envia: é o conteúdo que diz se isto é um PDF ou uma
   * página disfarçada (ver `@/documentos/conteudo`).
   */
  const conteudo = new Uint8Array(await arquivo.arrayBuffer());
  const real = tipoDoDocumento(conteudo, `${arquivo.type} ${arquivo.name}`);
  if (!real) {
    return {
      erro: "Este arquivo não é um PDF, uma imagem (JPEG, PNG, HEIC, WebP) nem um documento do Word ou do Excel. Confira o arquivo e envie de novo.",
    };
  }
  if (!schema.tipoDocumento.enumValues.includes(tipo)) {
    return { erro: "Tipo de documento inválido." };
  }
  /**
   * O `tipo` vem de um campo escondido do formulário, e campo escondido é
   * palpite do navegador, não fato. Sem esta linha, trocar o valor no
   * inspetor deixaria o técnico gravar um "contrato" no dossiê.
   */
  if (!acesso.pode(tipo)) {
    return { erro: "Este tipo de documento não é das suas etapas." };
  }

  const projeto = await db.query.projeto.findFirst({
    where: and(
      eq(schema.projeto.id, projetoId),
      eq(schema.projeto.empresaId, usuario.empresaId),
    ),
    with: { cliente: true },
  });
  if (!projeto) return { erro: "Dossiê não encontrado." };

  try {
    // A pasta que o cliente já tem no Drive, ou uma nova sob CLIENTES <ano>.
    const pastaId = await pastaDoCliente(usuario.empresaId, projeto.cliente);

    // A extensão sai do tipo reconhecido, e não do nome que veio do computador
    // de quem enviou: `contrato.pdf.html` não vira um `.html` no Drive.
    const nomeFinal = `${ROTULO_ARQUIVO[tipo] ?? tipo.toUpperCase()} - ${limparNome(
      projeto.cliente.nome,
    ).toUpperCase()}${assinado ? " ASSINADO" : ""}${real.extensao}`;

    const enviado = await enviarArquivo({
      nome: nomeFinal,
      mimeType: real.mime,
      pastaId,
      conteudo,
    });

    /**
     * Versão: um a mais que a maior que já existe deste tipo no dossiê.
     *
     * Substituir o arquivo antigo seria perder o histórico — e no Drive da BB
     * "Memorial Descritivo Assinado" e "Memorial Descritivo Assinado V2"
     * convivem justamente porque alguém precisou do anterior.
     */
    const existentes = await db.query.documento.findMany({
      where: and(
        eq(schema.documento.projetoId, projeto.id),
        eq(schema.documento.tipo, tipo),
      ),
      columns: { versao: true },
    });
    const versao = Math.max(0, ...existentes.map((d) => d.versao)) + 1;

    const [gravado] = await db
      .insert(schema.documento)
      .values({
        empresaId: usuario.empresaId,
        clienteId: projeto.clienteId,
        projetoId: projeto.id,
        tipo,
        status: assinado ? "assinado" : "indefinido",
        versao,
        nomeArquivo: nomeFinal,
        caminho: "",
        linkDrive: enviado.webViewLink ?? `https://drive.google.com/file/d/${enviado.id}/view`,
        pastaExterna: pastaId.slice(0, 80),
        origem: `CLIENTES ${new Date().getFullYear()}`,
        tamanhoBytes: arquivo.size,
        modificadoEm: new Date(),
        criadoPor: usuario.id,
      })
      .returning({ id: schema.documento.id });

    await db.insert(schema.documentoAcesso).values({
      empresaId: usuario.empresaId,
      documentoId: gravado.id,
      descricao: `${nomeFinal} (${projeto.titulo})`,
      usuarioId: usuario.id,
      acao: "enviou",
    });

    // O contrato assinado marca o dia em que o cliente assinou (a métrica de dias
    // desde a assinatura parte daqui). Só o primeiro vale: versão nova não zera.
    if (tipo === "contrato") {
      await db
        .update(schema.projeto)
        .set({ contratoAssinadoEm: sql`coalesce(${schema.projeto.contratoAssinadoEm}, now())` })
        .where(eq(schema.projeto.id, projeto.id));
    }

    // Com este documento a etapa pode ter ficado completa: a esteira anda sozinha.
    const andou = await avancarPorDocumentos(usuario.empresaId, projeto.id, usuario.id).catch((e) => {
      console.error("[documentos] avanço por documentos falhou:", e);
      return null;
    });

    revalidatePath(`/documentos/${projeto.id}`);
    revalidatePath("/documentos");
    revalidatePath("/esteira");
    return { ok: `${nomeFinal} enviado.${andou ? ` O projeto foi para "${andou}".` : ""}` };
  } catch (e) {
    return { erro: e instanceof Error ? e.message : "Falhou ao enviar." };
  }
}

/**
 * Anota que o cliente foi cobrado. O botão abre o WhatsApp no navegador e chama
 * isto em seguida — o que vale é o que o servidor calcula agora, e não a lista
 * de tipos que o navegador mandaria: cobrança registrada é cobrança do que de
 * fato falta.
 */
export async function registrarCobranca(projetoId: string, tipo?: string): Promise<{ ok: boolean }> {
  const acesso = await exigirAcessoDocumentos();

  // Cobrança de um documento só, pelo botão do cartão no dossiê.
  if (tipo) {
    if (!ehDoCliente(tipo) || !acesso.pode(tipo)) return { ok: false };
    const projeto = await db.query.projeto.findFirst({
      where: and(eq(schema.projeto.id, projetoId), eq(schema.projeto.empresaId, acesso.usuario.empresaId)),
      columns: { id: true, clienteId: true },
    });
    if (!projeto) return { ok: false };
    await db.insert(schema.cobrancaDocumento).values({
      empresaId: acesso.usuario.empresaId,
      projetoId: projeto.id,
      clienteId: projeto.clienteId,
      tipos: [tipo],
      canal: "whatsapp",
      usuarioId: acesso.usuario.id,
    });
    revalidatePath("/documentos/cobranca");
    revalidatePath(`/documentos/${projetoId}`);
    return { ok: true };
  }

  const [linha] = await filaDeCobranca(acesso.usuario.empresaId, { pode: acesso.pode, projetoId });
  if (!linha) return { ok: false };
  await db.insert(schema.cobrancaDocumento).values({
    empresaId: acesso.usuario.empresaId,
    projetoId: linha.projetoId,
    clienteId: linha.clienteId,
    tipos: linha.tipos,
    canal: "whatsapp",
    usuarioId: acesso.usuario.id,
  });
  revalidatePath("/documentos/cobranca");
  revalidatePath(`/documentos/${projetoId}`);
  return { ok: true };
}

/**
 * "Já enviei à Energisa": o engenheiro mandou o pedido no portal e digita o
 * número que o portal deu. O número liga o projeto à linha que a extensão lê
 * (por ele, e não pelo nome do cliente, que pode dar dúvida), e o projeto sai da
 * etapa Projeto para a Aprovação da concessionária.
 *
 * Fora da etapa Projeto só corrige o número, sem mexer na esteira nem na data.
 */
export async function registrarEnvioEnergisa(
  projetoId: string,
  _anterior: ResultadoEnvio,
  form: FormData,
): Promise<ResultadoEnvio> {
  const acesso = await exigirAcessoDocumentos();
  const usuario = acesso.usuario;
  if (!acesso.pode("protocolo")) return { erro: "Quem registra o envio à Energisa é o engenheiro." };

  const numero = lerNumeroDoPortal(form.get("numero"));
  if (!numero) return { erro: "Digite o número que o portal deu ao pedido (só os dígitos)." };

  const projeto = await db.query.projeto.findFirst({
    where: and(eq(schema.projeto.id, projetoId), eq(schema.projeto.empresaId, usuario.empresaId)),
    columns: { id: true, situacao: true },
    with: { etapa: { columns: { slug: true } } },
  });
  if (!projeto) return { erro: "Projeto não encontrado." };

  // O mesmo número em dois projetos ligaria a linha da Energisa ao errado.
  const outros = await db.query.projeto.findMany({
    where: and(eq(schema.projeto.empresaId, usuario.empresaId), ne(schema.projeto.id, projeto.id)),
    columns: { protocoloConcessionaria: true },
    with: { cliente: { columns: { nome: true } } },
  });
  const dono = outros.find((o) => numeroDoProjeto(o.protocoloConcessionaria) === numero);
  if (dono) return { erro: `O número ${numero} já está no projeto de ${dono.cliente.nome}. Confira o número.` };

  const naEtapa = projeto.etapa.slug === "projeto" && projeto.situacao === "em_andamento";
  await db
    .update(schema.projeto)
    .set({
      protocoloConcessionaria: numero,
      ...(naEtapa ? { energisaEnviadoEm: new Date() } : {}),
      atualizadoEm: new Date(),
    })
    .where(eq(schema.projeto.id, projeto.id));

  const nova = naEtapa
    ? await moverNaEsteira({
        empresaId: usuario.empresaId,
        projetoId: projeto.id,
        direcao: "avancar",
        usuarioId: usuario.id,
        observacao: `Enviado à Energisa pelo portal: projeto ${numero}.`,
      })
    : null;

  // Se a extensão já leu esse número, a ligação sai agora, sem esperar a próxima leitura.
  await vincularPendentes(usuario.empresaId).catch((e) => console.error("[energisa] ligar pelo número falhou:", e));

  revalidatePath(`/documentos/${projeto.id}`);
  revalidatePath(`/projeto/${projeto.id}`);
  revalidatePath("/esteira");
  revalidatePath("/energisa");
  return {
    ok: nova
      ? `Envio registrado com o número ${numero}. O projeto foi para "${nova.nome}".`
      : `Número da Energisa atualizado para ${numero}.`,
  };
}

/** O telefone que faltava no cadastro, direto da fila de cobrança. */
export async function salvarTelefone(clienteId: string, form: FormData): Promise<void> {
  const acesso = await exigirAcessoDocumentos();
  const telefone = String(form.get("telefone") ?? "").trim().slice(0, 20);
  if (!numeroWhatsapp(telefone)) return;
  await db
    .update(schema.cliente)
    .set({ telefone, atualizadoEm: new Date() })
    .where(and(eq(schema.cliente.id, clienteId), eq(schema.cliente.empresaId, acesso.usuario.empresaId)));
  revalidatePath("/documentos/cobranca");
}
