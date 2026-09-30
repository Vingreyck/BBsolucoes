import { exigirApp } from "@/app-movel/autenticacao";
import { ehUuid, falha, json, lerJson, muitasTentativas } from "@/app-movel/http";
import { consumir, MINUTO } from "@/app-movel/limitador";
import { dataDoApp, respostaDoErro } from "@/app-movel/os-api";
import { ordemDoUsuario } from "@/app-movel/ordens";
import { atorDoApp } from "@/os/acesso";
import { responderItem } from "@/os/respostas";

export const dynamic = "force-dynamic";

/**
 * A resposta de um item do checklist.
 *
 *   PUT { valor, observacao?, respondidoEm? }
 *
 * `valor` conforme o tipo do item: true/false, número, texto, a opção, a lista
 * de opções ou a lista de seriais; null apaga. `respondidoEm` é a hora do
 * celular — resposta mais velha que a gravada é descartada (`ignorado: true`),
 * para a fila offline não passar por cima de quem respondeu depois.
 *
 * O servidor decide se o item está cumprido; o app só mostra.
 */
export async function PUT(req: Request, { params }: { params: Promise<{ id: string; itemId: string }> }) {
  const usuario = await exigirApp(req);
  if (usuario instanceof Response) return usuario;

  const limite = consumir(`os-item:${usuario.id}`, 600, 10 * MINUTO);
  if (!limite.ok) return muitasTentativas(limite.tenteEmSegundos);

  const { id, itemId } = await params;
  if (!ehUuid(id) || !ehUuid(itemId)) return falha(404, "nao_encontrado", "Item não encontrado.");

  const corpo = await lerJson(req, 32_768);
  if (!corpo) return falha(400, "requisicao_invalida", "Não entendi o que foi enviado.");

  try {
    const r = await responderItem(atorDoApp(usuario), id, itemId, {
      valor: corpo.valor,
      observacao:
        corpo.observacao === undefined ? undefined : typeof corpo.observacao === "string" ? corpo.observacao : null,
      respondidoEm: dataDoApp(corpo.respondidoEm),
    });
    const ordem = await ordemDoUsuario(usuario, id);
    return json({ ordem, ignorado: r.ignorado, avisos: r.avisos });
  } catch (e) {
    return respostaDoErro(e);
  }
}
