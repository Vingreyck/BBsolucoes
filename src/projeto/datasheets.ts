import { and, eq, inArray, isNotNull, or } from "drizzle-orm";

import { db, schema } from "@/db";
import { limparNome } from "@/documentos/pastas";

/**
 * O datasheet e o Inmetro que entram sozinhos no dossiê, pelo kit do projeto.
 *
 * O arquivo é do catálogo (`modelo_equipamento`) e fica uma vez só no Drive. O
 * dossiê de cada projeto ganha um `documento` que aponta para ele, marcado com
 * `modelo_equipamento_id`. O download do dossiê já busca pelo link do Drive,
 * então não precisa copiar nada.
 *
 * Só mexe no que entrou pelo catálogo: datasheet que alguém subiu à mão fica.
 */

type Arquivo = "datasheet" | "inmetro";

function nomeDoArquivo(qual: Arquivo, m: { fabricante: string; modelo: string }): string {
  return `${qual === "datasheet" ? "DATASHEET" : "INMETRO"} - ${limparNome(`${m.fabricante} ${m.modelo}`).toUpperCase()}.pdf`;
}

/** Deixa os anexos do catálogo do projeto iguais ao kit escolhido nele. */
export async function sincronizarDatasheets(
  empresaId: string,
  projetoId: string,
  usuarioId: string | null = null,
): Promise<void> {
  const projeto = await db.query.projeto.findFirst({
    where: and(eq(schema.projeto.id, projetoId), eq(schema.projeto.empresaId, empresaId)),
    columns: { id: true, clienteId: true, inversorModeloId: true, moduloModeloId: true },
  });
  if (!projeto) return;

  const ids = [projeto.inversorModeloId, projeto.moduloModeloId].filter((x): x is string => Boolean(x));
  const modelos = ids.length
    ? await db
        .select()
        .from(schema.modeloEquipamento)
        .where(and(eq(schema.modeloEquipamento.empresaId, empresaId), inArray(schema.modeloEquipamento.id, ids)))
    : [];

  // O caminho leva o projeto: o mesmo cliente pode ter duas vendas com o mesmo
  // modelo, e (cliente, caminho, nome) é único na tabela de documentos.
  const desejados = new Map<string, { modeloId: string; link: string; nome: string }>();
  for (const m of modelos) {
    for (const qual of ["datasheet", "inmetro"] as const) {
      const link = qual === "datasheet" ? m.datasheetLink : m.inmetroLink;
      if (link) desejados.set(`catalogo/${projeto.id}/${m.id}/${qual}`, { modeloId: m.id, link, nome: nomeDoArquivo(qual, m) });
    }
  }

  const atuais = await db
    .select({ id: schema.documento.id, caminho: schema.documento.caminho, linkDrive: schema.documento.linkDrive })
    .from(schema.documento)
    .where(and(eq(schema.documento.projetoId, projeto.id), isNotNull(schema.documento.modeloEquipamentoId)));

  for (const a of atuais) {
    const quer = desejados.get(a.caminho);
    if (!quer) {
      // Trocou o modelo do kit: o anexo do modelo antigo sai (só a linha; o arquivo continua no catálogo).
      await db.delete(schema.documento).where(eq(schema.documento.id, a.id));
    } else if (quer.link !== a.linkDrive) {
      // O catálogo recebeu um arquivo novo para o mesmo modelo.
      await db
        .update(schema.documento)
        .set({ linkDrive: quer.link, nomeArquivo: quer.nome, modificadoEm: new Date() })
        .where(eq(schema.documento.id, a.id));
    }
    desejados.delete(a.caminho);
  }

  for (const [caminho, d] of desejados) {
    await db
      .insert(schema.documento)
      .values({
        empresaId,
        clienteId: projeto.clienteId,
        projetoId: projeto.id,
        tipo: "datasheet",
        status: "indefinido",
        versao: 1,
        nomeArquivo: d.nome,
        caminho,
        linkDrive: d.link,
        origem: "catálogo de equipamentos",
        modificadoEm: new Date(),
        criadoPor: usuarioId,
        modeloEquipamentoId: d.modeloId,
      })
      .onConflictDoNothing();
  }
}

/** Um modelo do catálogo ganhou ou trocou arquivo: atualiza todo projeto que usa ele. */
export async function ressincronizarModelo(empresaId: string, modeloId: string): Promise<number> {
  const projetos = await db
    .select({ id: schema.projeto.id })
    .from(schema.projeto)
    .where(
      and(
        eq(schema.projeto.empresaId, empresaId),
        or(eq(schema.projeto.inversorModeloId, modeloId), eq(schema.projeto.moduloModeloId, modeloId)),
      ),
    );
  for (const p of projetos) await sincronizarDatasheets(empresaId, p.id);
  return projetos.length;
}
