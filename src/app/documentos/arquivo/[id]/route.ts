import { and, eq } from "drizzle-orm";

import { exigirAcessoDocumentos } from "@/auth/permissao";
import { db, schema } from "@/db";
import { baixarArquivo, driveConfigurado, idDoLink } from "@/documentos/drive";

/**
 * Entrega o arquivo pelo Selebi, sem o usuário passar pelo Google.
 *
 * Era a peça que faltava para a integração ser mesmo invisível: se a tela só
 * mostrasse o link do Drive, quem não tem conta Google — que é o caso de toda
 * a equipe, por decisão do dono — esbarraria na tela de login do Google. Aqui
 * o Selebi busca com a credencial da empresa e devolve.
 *
 * E é aqui que a trilha de auditoria ganha sentido: numa tabela com CNH, RG,
 * CPF e conta de luz de 169 pessoas, "quem baixou o documento de quem" é
 * exatamente o registro de operação que a LGPD espera.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const acesso = await exigirAcessoDocumentos();
  const usuario = acesso.usuario;
  const { id } = await params;

  const documento = await db.query.documento.findFirst({
    where: and(
      eq(schema.documento.id, id),
      // O `empresaId` no where não é decoração: sem ele, trocar o id na barra
      // de endereços daria acesso ao documento de outra empresa do sistema.
      eq(schema.documento.empresaId, usuario.empresaId),
    ),
    with: { cliente: { columns: { nome: true } } },
  });

  if (!documento) {
    return new Response("Documento não encontrado.", { status: 404 });
  }

  /**
   * A tela esconde o que não é deste papel; esta linha é a que impede.
   *
   * Sem ela, bastaria trocar o id no endereço para o técnico baixar a CNH do
   * cliente — e o link até apareceria numa tela antiga aberta noutra aba.
   */
  if (!acesso.pode(documento.tipo)) {
    return new Response(
      "Este documento é de uma etapa que não é do seu perfil.",
      { status: 403 },
    );
  }

  if (!driveConfigurado()) {
    return new Response(
      "O Drive não está conectado neste servidor. Rode `npm run drive:autorizar`.",
      { status: 503 },
    );
  }

  const fileId = idDoLink(documento.linkDrive);
  if (!fileId) {
    return new Response(
      "Este documento não tem link do Drive — veio da listagem sem endereço de arquivo.",
      { status: 409 },
    );
  }

  /**
   * Registra antes de entregar.
   *
   * Se o download falhar no meio, fica registrada uma tentativa a mais — que é
   * o erro seguro. Registrar depois perderia justamente o acesso que deu
   * problema, que é o que alguém investigando iria querer ver.
   */
  await db.insert(schema.documentoAcesso).values({
    empresaId: usuario.empresaId,
    documentoId: documento.id,
    descricao: `${documento.nomeArquivo} (${documento.cliente?.nome ?? "sem cliente"})`,
    usuarioId: usuario.id,
    acao: "baixou",
  });

  try {
    const { corpo, tipo, tamanho } = await baixarArquivo(fileId);

    const cabecalhos = new Headers({
      "content-type": tipo,
      // `attachment` e não `inline`: o nome no padrão da BB vai junto, e o
      // navegador salva com ele em vez de um id de Drive.
      "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(documento.nomeArquivo)}`,
      // Documento de cliente não entra em cache de proxy nem do navegador.
      "cache-control": "private, no-store",
    });
    if (tamanho) cabecalhos.set("content-length", tamanho);

    return new Response(corpo, { headers: cabecalhos });
  } catch (e) {
    return new Response(
      e instanceof Error ? e.message : "Falhou ao buscar o arquivo no Drive.",
      { status: 502 },
    );
  }
}
