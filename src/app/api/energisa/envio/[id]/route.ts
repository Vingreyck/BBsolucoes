import { NextResponse } from "next/server";

import { ehUuid } from "@/app-movel/http";
import { tiposDoPapel } from "@/auth/permissao";
import { pacoteDeEnvio } from "@/energisa/envio-pacote";
import { atorDaWebOuNulo } from "@/os/acesso";

import { origemDoSite } from "../../../../origem";

export const dynamic = "force-dynamic";

/**
 * Os dados do envio de um projeto para o painel que a extensão mostra ao lado
 * do formulário do portal da Energisa: campos para copiar e os documentos do
 * pedido, com o endereço de baixar pelo Selebi (que confere o papel de novo).
 *
 * Mesma trava da rota de importar: só com o cabeçalho `X-Selebi-Extensao`, que
 * página de outro site não consegue mandar.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!req.headers.get("x-selebi-extensao")) {
    return NextResponse.json({ ok: false, erro: "Só a extensão do Selebi lê aqui." }, { status: 400 });
  }
  const ator = await atorDaWebOuNulo();
  if (!ator) return NextResponse.json({ ok: false, erro: "Entre no Selebi neste Chrome." }, { status: 401 });
  const tipos = await tiposDoPapel(ator.empresaId, ator.papel);
  if (!tipos.has("protocolo")) {
    return NextResponse.json({ ok: false, erro: "Quem envia à Energisa é o engenheiro." }, { status: 403 });
  }

  const { id } = await params;
  if (!ehUuid(id)) return NextResponse.json({ ok: false, erro: "Projeto não encontrado." }, { status: 404 });
  const pacote = await pacoteDeEnvio(ator.empresaId, id);
  if (!pacote) return NextResponse.json({ ok: false, erro: "Projeto não encontrado." }, { status: 404 });

  const origem = await origemDoSite();
  return NextResponse.json(
    {
      ok: true,
      projetoId: pacote.projetoId,
      cliente: pacote.cliente,
      dossie: `${origem}/documentos/${pacote.projetoId}#energisa`,
      campos: pacote.campos,
      documentos: pacote.itens.map((i) => ({
        rotulo: i.rotulo,
        quando: i.quando,
        nome: i.nomeArquivo,
        baixar: i.documentoId ? `${origem}/documentos/arquivo/${i.documentoId}` : null,
      })),
      faltam: pacote.faltam,
    },
    { headers: { "cache-control": "private, no-store" } },
  );
}
