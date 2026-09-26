import { empresaPeloCodigo } from "@/empresa/codigo-acesso";
import { falha, ipDe, json, lerJson, muitasTentativas, texto } from "@/app-movel/http";
import { consumir, MINUTO } from "@/app-movel/limitador";

/**
 * Primeira tela do app: o código da empresa vira o nome dela.
 *
 * O app guarda o `id` devolvido e passa a mostrar "BB Soluções" no login. O
 * código em si só volta a ser pedido no cadastro de alguém novo — trocar o
 * código da empresa não desloga quem já está dentro.
 *
 * O freio por IP existe para que ninguém descubra código de empresa por
 * tentativa e erro.
 */
export async function POST(req: Request) {
  const limite = consumir(`empresa:${ipDe(req)}`, 20, 10 * MINUTO);
  if (!limite.ok) return muitasTentativas(limite.tenteEmSegundos);

  const corpo = await lerJson(req);
  const codigo = texto(corpo?.codigo, 100);
  if (!codigo) return falha(400, "validacao", "Digite o código da empresa.");

  const empresa = await empresaPeloCodigo(codigo);
  if (!empresa) {
    return falha(
      404,
      "codigo_invalido",
      "Não achamos nenhuma empresa com esse código. Confira com quem te passou.",
    );
  }
  return json({ id: empresa.id, nome: empresa.nome });
}
