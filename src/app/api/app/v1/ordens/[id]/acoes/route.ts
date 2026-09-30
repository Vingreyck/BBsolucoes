import { exigirApp } from "@/app-movel/autenticacao";
import { ehUuid, falha, json, lerJson, muitasTentativas, texto } from "@/app-movel/http";
import { consumir, MINUTO } from "@/app-movel/limitador";
import { dataDoApp, idClienteDoApp, numeroDoApp, respostaDoErro } from "@/app-movel/os-api";
import { ordemDoUsuario } from "@/app-movel/ordens";
import { atorDoApp } from "@/os/acesso";
import { executarAcao, type Acao } from "@/os/fluxo";

export const dynamic = "force-dynamic";

/**
 * O técnico mexe na OS pelo celular: saiu, chegou, pausou, retomou, concluiu,
 * não conseguiu atender.
 *
 *   POST { idCliente, acao, ocorridoEm?, latitude?, longitude?, precisao?,
 *          motivo?, resultado?, laudo?, assinaturaNome? }
 *
 * A mesma regra do site (`@/os/fluxo`). O `idCliente` é obrigatório: é ele que
 * deixa o app reenviar a fila depois de uma queda de sinal sem duplicar nada —
 * a ação repetida responde 200 com `repetida: true`. Devolve a OS atualizada.
 *
 * Agendar, atribuir, cancelar e reabrir são da gestão e ficam no site.
 */
const DO_APP = new Set(["deslocamento", "iniciar", "pausar", "retomar", "concluir", "nao_atendida"]);

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const usuario = await exigirApp(req);
  if (usuario instanceof Response) return usuario;

  const limite = consumir(`os-acao:${usuario.id}`, 120, 10 * MINUTO);
  if (!limite.ok) return muitasTentativas(limite.tenteEmSegundos);

  const { id } = await params;
  if (!ehUuid(id)) return falha(404, "nao_encontrado", "Ordem de serviço não encontrada.");

  const corpo = await lerJson(req, 32_768);
  if (!corpo) return falha(400, "requisicao_invalida", "Não entendi o que foi enviado.");

  const idCliente = idClienteDoApp(corpo.idCliente);
  if (!idCliente) return falha(400, "validacao", "Falta o idCliente (UUID gerado no celular).");

  const tipo = texto(corpo.acao, 30);
  if (!DO_APP.has(tipo)) return falha(400, "validacao", "Ação inválida para o app.");

  let acao: Acao;
  if (tipo === "concluir") {
    acao = {
      tipo,
      resultado: corpo.resultado === "nao_resolvido" ? "nao_resolvido" : "resolvido",
      laudo: texto(corpo.laudo, 8000) || null,
      assinaturaNome: texto(corpo.assinaturaNome, 200) || null,
    };
  } else if (tipo === "pausar" || tipo === "nao_atendida") {
    acao = { tipo, motivo: texto(corpo.motivo, 500) };
  } else {
    acao = { tipo: tipo as "deslocamento" | "iniciar" | "retomar" };
  }

  try {
    const r = await executarAcao(atorDoApp(usuario), id, acao, {
      idCliente,
      ocorridoEm: dataDoApp(corpo.ocorridoEm),
      latitude: numeroDoApp(corpo.latitude),
      longitude: numeroDoApp(corpo.longitude),
      precisao: numeroDoApp(corpo.precisao),
    });
    const ordem = await ordemDoUsuario(usuario, id);
    return json({ ordem, repetida: r.repetida, avisos: r.avisos });
  } catch (e) {
    return respostaDoErro(e);
  }
}
