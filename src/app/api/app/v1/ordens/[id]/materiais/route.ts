import { exigirApp } from "@/app-movel/autenticacao";
import { ehUuid, falha, json, lerJson, muitasTentativas, texto } from "@/app-movel/http";
import { consumir, MINUTO } from "@/app-movel/limitador";
import { idClienteDoApp, respostaDoErro } from "@/app-movel/os-api";
import { ordemDoUsuario } from "@/app-movel/ordens";
import { OBSERVACAO_MAXIMO, registrarMaterial } from "@/estoque/baixa";
import { atorDoApp } from "@/os/acesso";

export const dynamic = "force-dynamic";

/**
 * Material ou equipamento usado na OS, registrado no celular. O estoque
 * desconta na hora.
 *
 *   POST { idCliente, itemId, quantidade, observacao? }
 *
 * O `idCliente` torna o reenvio da fila seguro: o mesmo registro duas vezes
 * vira um só (`repetida: true`). Devolve a OS atualizada, com `materiais`.
 * A lista de itens vem de GET /api/app/v1/estoque.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const usuario = await exigirApp(req);
  if (usuario instanceof Response) return usuario;

  const limite = consumir(`os-material:${usuario.id}`, 120, 10 * MINUTO);
  if (!limite.ok) return muitasTentativas(limite.tenteEmSegundos);

  const { id } = await params;
  if (!ehUuid(id)) return falha(404, "nao_encontrada", "Ordem de serviço não encontrada.");

  const corpo = await lerJson(req, 8_192);
  if (!corpo) return falha(400, "requisicao_invalida", "Não entendi o que foi enviado.");

  const idCliente = idClienteDoApp(corpo.idCliente);
  if (!idCliente) return falha(400, "validacao", "Falta o idCliente (UUID gerado no celular).");
  if (typeof corpo.itemId !== "string" || !ehUuid(corpo.itemId)) return falha(400, "validacao", "Escolha o item do estoque.");

  try {
    const r = await registrarMaterial(atorDoApp(usuario), id, {
      itemId: corpo.itemId,
      quantidade: corpo.quantidade,
      observacao: typeof corpo.observacao === "string" ? texto(corpo.observacao, OBSERVACAO_MAXIMO) : null,
      idCliente,
    });
    const ordem = await ordemDoUsuario(usuario, id);
    return json({ ordem, materialId: r.id, repetida: r.repetida }, r.repetida ? 200 : 201);
  } catch (e) {
    return respostaDoErro(e);
  }
}
