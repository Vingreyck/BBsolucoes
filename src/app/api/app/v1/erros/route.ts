import { falha, ipDe, json, lerJson, muitasTentativas, texto } from "@/app-movel/http";
import { consumir, MINUTO } from "@/app-movel/limitador";
import { desembaralharDaVersao } from "@/sistema/retrace";
import { enviarParaSentry } from "@/sistema/sentry";

export const dynamic = "force-dynamic";

/**
 * O app conta que travou.
 *
 *   POST { plataforma, versao, build, dispositivo, tipo, mensagem, pilha, quando }
 *
 * O app grava a falha no celular na hora em que trava e manda na próxima
 * abertura — por isso esta rota não pede login: o travamento pode ter sido na
 * tela de entrada. Em troca, ela só aceita texto curto, limita por IP e não
 * guarda nada: encaminha ao Sentry e ao log. Responde 202 sempre que a forma
 * está certa, para o app apagar o registro.
 *
 * No Android a pilha chega com os nomes trocados pelo R8; se o mapeamento da
 * versão (`mapeamentos/<build>.txt`) estiver no servidor, ela é desembaralhada
 * aqui, e a original segue junto no `extra` para conferência.
 */
export async function POST(req: Request) {
  const limite = consumir(`erros:${ipDe(req)}`, 20, 60 * MINUTO);
  if (!limite.ok) return muitasTentativas(limite.tenteEmSegundos);

  const corpo = await lerJson(req, 20_000);
  if (!corpo) return falha(400, "requisicao_invalida", "Não entendi o que foi enviado.");

  const plataforma = texto(corpo.plataforma, 20).toLowerCase();
  if (plataforma !== "android" && plataforma !== "ios") {
    return falha(400, "validacao", "Plataforma deve ser android ou ios.");
  }
  const mensagem = texto(corpo.mensagem, 1000) || "(sem mensagem)";
  const pilhaOriginal = texto(corpo.pilha, 8000);
  const pilha =
    plataforma === "android" ? await desembaralharDaVersao(pilhaOriginal, texto(corpo.build, 10)) : pilhaOriginal;

  console.error(`[app ${plataforma} ${texto(corpo.versao, 20)}] ${texto(corpo.tipo, 200)}: ${mensagem}`);
  await enviarParaSentry({
    mensagem,
    tipo: texto(corpo.tipo, 200) || "Falha",
    pilha,
    plataforma,
    nivel: "fatal",
    tags: { versao: texto(corpo.versao, 20), build: texto(corpo.build, 10) },
    extra: {
      dispositivo: texto(corpo.dispositivo, 100),
      quando: texto(corpo.quando, 40),
      ...(pilha !== pilhaOriginal ? { pilhaOfuscada: pilhaOriginal } : {}),
    },
  });
  return json({ ok: true }, 202);
}
