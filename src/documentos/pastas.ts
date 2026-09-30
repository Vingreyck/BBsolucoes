import { and, eq, isNotNull } from "drizzle-orm";

import { db, schema } from "@/db";

import { garantirPasta } from "./drive";

/**
 * Onde cada cliente mora no Drive.
 *
 * Dois caminhos gravam arquivo na pasta do cliente — o dossiê (documento que o
 * escritório sobe) e a OS (foto que o técnico tira) — e os dois precisam cair
 * no mesmo lugar, senão a pasta do cliente se parte em duas.
 */

/** Tira acento e o que o Drive e o Windows não gostam em nome de arquivo. */
export function limparNome(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[\\/:*?"<>|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * A pasta do cliente no Drive, criada se ainda não existir.
 *
 * `pastaExterna` foi gravada na importação e é o id da pasta do cliente. Se o
 * cliente não tem pasta — venda que nasceu aqui dentro —, cria uma sob
 * `CLIENTES <ano>`, seguindo a árvore que a BB já usa. Criada uma vez, o
 * `garantirPasta` a encontra pelo nome nas próximas.
 */
export async function pastaDoCliente(
  empresaId: string,
  cliente: { id: string; nome: string },
): Promise<string> {
  const comPasta = await db.query.documento.findFirst({
    where: and(
      eq(schema.documento.clienteId, cliente.id),
      eq(schema.documento.empresaId, empresaId),
      isNotNull(schema.documento.pastaExterna),
    ),
    columns: { pastaExterna: true },
  });
  if (comPasta?.pastaExterna) return comPasta.pastaExterna;

  const raiz = process.env.GOOGLE_DRIVE_RAIZ;
  if (!raiz) {
    throw new Error(
      'Falta GOOGLE_DRIVE_RAIZ no .env — é o id da pasta "Energia solar" no Drive. ' +
        "Está no cabeçalho de scripts/listar-drive.gs.",
    );
  }
  const ano = new Date().getFullYear();
  const pastaDoAno = await garantirPasta(`CLIENTES ${ano}`, raiz);
  return garantirPasta(limparNome(cliente.nome), pastaDoAno);
}
