import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "./schema";

/**
 * A conexão só é aberta na primeira consulta, e não ao importar o arquivo.
 *
 * A versão anterior lançava erro no topo quando `DATABASE_URL` faltava, e isso
 * derrubava o `next build`: para gerar a rota de download de documento o Next
 * carrega o módulo dela, que importa este arquivo — e durante o build não há
 * banco nem variável de ambiente. O erro que aparecia era
 * `Failed to collect page data for /documentos/arquivo/[id]`, que não diz nada
 * sobre a causa.
 *
 * Compilar não é motivo para precisar de banco. Adiar a conexão resolve os
 * dois lados: o build passa, e quem chamar uma consulta sem `DATABASE_URL`
 * continua recebendo a mesma mensagem clara, só que na hora certa.
 */
/**
 * A conexão mora no `globalThis`, e não numa variável do módulo, por causa do
 * `next dev`: a cada arquivo salvo ele recarrega os módulos, e cada recarga
 * abria um pool novo de 10 sem fechar o anterior — em meia hora de edição o
 * Postgres recusava tudo com "too many clients already". Em produção o módulo
 * carrega uma vez só e isto não muda nada.
 */
const global = globalThis as { __selebiConexao?: ReturnType<typeof postgres> };

function cliente() {
  if (global.__selebiConexao) return global.__selebiConexao;

  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL não está definida. Copie .env.example para .env.");
  }

  /**
   * O coletor roda em processo separado e abre sua própria conexão. Aqui o pool
   * fica pequeno de propósito: a aplicação web não é o gargalo desse sistema.
   */
  global.__selebiConexao = postgres(url, { max: 10 });
  return global.__selebiConexao;
}

/**
 * `db` é um proxy: cada uso toca no Drizzle de verdade, que por sua vez abre a
 * conexão na primeira vez. Mantém a forma `db.query...` e `db.insert(...)` que
 * o projeto inteiro já usa, sem trocar uma linha de quem chama.
 */
export const db = new Proxy({} as ReturnType<typeof drizzle<typeof schema>>, {
  get(_alvo, prop, receptor) {
    const real = drizzle(cliente(), { schema });
    const valor = Reflect.get(real, prop, receptor);
    return typeof valor === "function" ? valor.bind(real) : valor;
  },
});

export { schema };
