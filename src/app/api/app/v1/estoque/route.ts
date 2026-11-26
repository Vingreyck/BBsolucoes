import { exigirApp } from "@/app-movel/autenticacao";
import { json } from "@/app-movel/http";
import { itensComSaldo } from "@/estoque/estoque";

export const dynamic = "force-dynamic";

/**
 * Os itens do estoque, para o técnico escolher o material usado na OS.
 *
 *   GET → { itens: [{ id, nome, unidade, saldo, codigo }] }
 *
 * Só os ativos. O saldo vai junto para o app mostrar "restam 12", mas não
 * trava: material usado é fato, e o estoque pode ficar negativo até a nota ser
 * lançada (a tela do estoque marca em vermelho).
 */
export async function GET(req: Request) {
  const usuario = await exigirApp(req);
  if (usuario instanceof Response) return usuario;
  const itens = await itensComSaldo(usuario.empresaId);
  return json({
    itens: itens
      .filter((i) => i.ativo)
      .map((i) => ({ id: i.id, nome: i.nome, unidade: i.unidade, saldo: i.saldo, codigo: i.codigo })),
  });
}
