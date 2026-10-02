import { solicitarCadastro } from "@/auth/cadastro";
import { falha, ipDe, json, lerJson, muitasTentativas, texto } from "@/app-movel/http";
import { consumir, MINUTO } from "@/app-movel/limitador";

/**
 * Cadastro feito pelo próprio técnico, no celular.
 *
 * A regra (o que se pede, o que se valida, como a conta nasce) mora em
 * `@/auth/cadastro`, a mesma que o "Solicitar acesso" do site usa. Aqui fica
 * só o que é do app: o freio por IP e o formato da resposta.
 */
export async function POST(req: Request) {
  const limite = consumir(`cadastro:${ipDe(req)}`, 10, 60 * MINUTO);
  if (!limite.ok) return muitasTentativas(limite.tenteEmSegundos);

  const corpo = await lerJson(req);
  if (!corpo) return falha(400, "requisicao_invalida", "Não entendi o que foi enviado.");

  const resultado = await solicitarCadastro({
    codigo: texto(corpo.codigo, 100),
    nome: texto(corpo.nome, 120),
    cpf: texto(corpo.cpf, 20),
    email: texto(corpo.email, 254),
    senha: typeof corpo.senha === "string" ? corpo.senha : "",
  });

  if (!resultado.ok) {
    return falha(
      resultado.status,
      resultado.codigo,
      resultado.mensagem,
      resultado.campos ? { campos: resultado.campos } : undefined,
    );
  }

  return json(
    {
      situacao: "pendente",
      empresa: { nome: resultado.empresa.nome },
      mensagem: `Agora falta um administrador da ${resultado.empresa.nome} liberar o seu acesso.`,
    },
    201,
  );
}
