import { exigirApp } from "@/app-movel/autenticacao";
import { ehUuid, falha, json, lerJson, muitasTentativas } from "@/app-movel/http";
import { consumir, MINUTO } from "@/app-movel/limitador";
import { dataDoApp, idClienteDoApp, respostaDoErro } from "@/app-movel/os-api";
import { ordemDoUsuario } from "@/app-movel/ordens";
import { atorDoApp } from "@/os/acesso";
import { anotar, NOTA_MAXIMO } from "@/os/notas";

export const dynamic = "force-dynamic";

/**
 * Uma nota na OS, escrita no celular — a mesma dos comentários da tela da OS
 * no site.
 *
 *   POST { idCliente, texto, criadoEm? }
 *
 * O `idCliente` torna o reenvio da fila seguro: a mesma nota duas vezes vira
 * uma só (`repetida: true`). Devolve a OS atualizada, já com a nota.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const usuario = await exigirApp(req);
  if (usuario instanceof Response) return usuario;

  const limite = consumir(`os-nota:${usuario.id}`, 60, 10 * MINUTO);
  if (!limite.ok) return muitasTentativas(limite.tenteEmSegundos);

  const { id } = await params;
  if (!ehUuid(id)) return falha(404, "nao_encontrado", "Ordem de serviço não encontrada.");

  const corpo = await lerJson(req, 32_768);
  if (!corpo) return falha(400, "requisicao_invalida", "Não entendi o que foi enviado.");

  const idCliente = idClienteDoApp(corpo.idCliente);
  if (!idCliente) return falha(400, "validacao", "Falta o idCliente (UUID gerado no celular).");
  if (typeof corpo.texto !== "string" || !corpo.texto.trim()) {
    return falha(400, "validacao", "Escreva a nota.");
  }
  if (corpo.texto.length > NOTA_MAXIMO) {
    return falha(400, "validacao", `A nota passou de ${NOTA_MAXIMO.toLocaleString("pt-BR")} caracteres.`);
  }

  try {
    const r = await anotar(atorDoApp(usuario), id, corpo.texto, {
      idCliente,
      criadoEm: dataDoApp(corpo.criadoEm),
    });
    const ordem = await ordemDoUsuario(usuario, id);
    return json({ ordem, repetida: r.repetida }, r.repetida ? 200 : 201);
  } catch (e) {
    return respostaDoErro(e);
  }
}
