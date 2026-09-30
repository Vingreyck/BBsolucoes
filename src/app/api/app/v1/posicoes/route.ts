import { exigirApp } from "@/app-movel/autenticacao";
import { falha, json, lerJson, muitasTentativas } from "@/app-movel/http";
import { consumir, MINUTO } from "@/app-movel/limitador";
import { atorDoApp } from "@/os/acesso";
import { normalizarPonto, PONTOS_POR_ENVIO, registrarPosicoes } from "@/rastreamento/posicoes";

export const dynamic = "force-dynamic";

/**
 * As posições do técnico em atendimento, em lote.
 *
 *   POST { pontos: [{ ordemId, latitude, longitude, precisao?, velocidade?,
 *                     bateria?, modo?, capturadoEm }] }
 *
 * O celular manda de 10 em 10 s a caminho, de minuto em minuto no local, e o
 * que juntou sem sinal quando o sinal volta. Ponto que não presta (coordenada
 * zerada, velho demais, de OS alheia) é descartado sem erro: o celular não tem
 * o que fazer com a recusa, e o lote inteiro não pode travar por um ponto.
 */
export async function POST(req: Request) {
  const usuario = await exigirApp(req);
  if (usuario instanceof Response) return usuario;

  // Folgado: um celular que passou a tarde sem sinal manda vários lotes seguidos.
  const limite = consumir(`posicoes:${usuario.id}`, 240, 10 * MINUTO);
  if (!limite.ok) return muitasTentativas(limite.tenteEmSegundos);

  const corpo = await lerJson(req, 131_072);
  if (!corpo || !Array.isArray(corpo.pontos)) {
    return falha(400, "requisicao_invalida", "Esperava { pontos: [...] }.");
  }
  if (corpo.pontos.length > PONTOS_POR_ENVIO) {
    return falha(400, "validacao", `No máximo ${PONTOS_POR_ENVIO} pontos por envio.`);
  }

  const agora = new Date();
  const pontos = corpo.pontos.map((p) => normalizarPonto(p, agora)).filter((p) => p !== null);
  const r = await registrarPosicoes(atorDoApp(usuario), pontos, agora);
  return json({
    recebidos: corpo.pontos.length,
    aceitos: r.aceitos,
    naTrilha: r.naTrilha,
    descartados: corpo.pontos.length - r.aceitos,
  });
}
