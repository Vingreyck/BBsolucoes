import { createReadStream, existsSync } from "node:fs";
import { createInterface } from "node:readline";
import { join } from "node:path";

/**
 * Desembaralha o travamento do app Android.
 *
 * O app de loja passa pelo R8, que troca os nomes das classes e dos métodos por
 * letras (`H2.K0.a`) e guarda a tabela de volta num `mapping.txt`, um por versão.
 * O travamento chega aqui com os nomes trocados; este módulo lê o mapeamento da
 * versão que travou e devolve a pilha com os nomes de verdade.
 *
 * Não usa o `retrace` do Google (é Java): o formato do mapeamento é texto e o que
 * precisamos é pouco — classe, método e linha. O arquivo tem dezenas de MB, então
 * ele é lido em fluxo e só as classes que aparecem na pilha são guardadas.
 *
 * Os mapeamentos ficam em `mapeamentos/<versionCode>.txt` (ver `SETUP.md`).
 */

export const PASTA_MAPEAMENTOS = "mapeamentos";

interface Membro {
  /** Linhas do código ofuscado a que este trecho corresponde; nulo = sem linha. */
  de: number | null;
  ate: number | null;
  /** Linha no código original em que o trecho começa (e termina), quando há. */
  origDe: number | null;
  origAte: number | null;
  classe: string;
  metodo: string;
}

interface Classe {
  original: string;
  arquivo: string | null;
  /** Por nome ofuscado do método. */
  metodos: Map<string, Membro[]>;
}

const CLASSE = /^(\S+) -> (\S+):$/;
const ARQUIVO = /^# \{"id":"sourceFile","fileName":"([^"]+)"\}/;
// [de:ate:]retorno classe.metodo(args)[:origDe[:origAte]] -> ofuscado
const MEMBRO = /^ {4}(?:(\d+):(\d+):)?\S+ ([\w.$<>]+)\([^)]*\)(?::(\d+)(?::(\d+))?)? -> (\S+)$/;

/** Lê do mapeamento só as classes pedidas (nomes ofuscados), em fluxo. */
export async function lerClasses(caminho: string, ofuscadas: Set<string>): Promise<Map<string, Classe>> {
  const achadas = new Map<string, Classe>();
  const linhas = createInterface({ input: createReadStream(caminho, "utf8"), crlfDelay: Infinity });
  let atual: Classe | null = null;
  for await (const linha of linhas) {
    if (!linha.startsWith(" ") && !linha.startsWith("#")) {
      const c = CLASSE.exec(linha);
      atual = null;
      if (c && ofuscadas.has(c[2])) {
        atual = { original: c[1], arquivo: null, metodos: new Map() };
        achadas.set(c[2], atual);
      }
      continue;
    }
    if (!atual) continue;
    const a = ARQUIVO.exec(linha);
    if (a) {
      atual.arquivo = a[1];
      continue;
    }
    const m = MEMBRO.exec(linha);
    if (!m) continue;
    const completo = m[3];
    const corte = completo.lastIndexOf(".");
    const membro: Membro = {
      de: m[1] ? Number(m[1]) : null,
      ate: m[2] ? Number(m[2]) : null,
      origDe: m[4] ? Number(m[4]) : null,
      origAte: m[5] ? Number(m[5]) : null,
      // Trecho "inlined" vem com a classe de origem no nome do método.
      classe: corte >= 0 ? completo.slice(0, corte) : atual.original,
      metodo: corte >= 0 ? completo.slice(corte + 1) : completo,
    };
    const lista = atual.metodos.get(m[6]) ?? [];
    lista.push(membro);
    atual.metodos.set(m[6], lista);
  }
  return achadas;
}

const QUADRO = /^(\s*at )([\w.$]+)\.([\w$<>]+)\(([^:)]*)(?::(\d+))?\)\s*$/;

/** As classes ofuscadas que aparecem nos quadros da pilha. */
export function classesDaPilha(pilha: string): Set<string> {
  const nomes = new Set<string>();
  for (const linha of pilha.split("\n")) {
    const q = QUADRO.exec(linha);
    if (q) nomes.add(q[2]);
    const primeira = /^([\w.$]+)(?::|$)/.exec(linha);
    if (primeira) nomes.add(primeira[1]);
  }
  return nomes;
}

/** Aplica as classes lidas à pilha. Linha que não casa fica como veio. */
export function desembaralhar(pilha: string, classes: Map<string, Classe>): string {
  const saida: string[] = [];
  for (const [i, linha] of pilha.split("\n").entries()) {
    const q = QUADRO.exec(linha);
    if (!q) {
      // A primeira linha é "pacote.Excecao: mensagem": a classe da exceção também troca.
      const p = i === 0 ? /^([\w.$]+)(.*)$/.exec(linha) : null;
      const c = p ? classes.get(p[1]) : undefined;
      saida.push(c && p ? c.original + p[2] : linha);
      continue;
    }
    const [, recuo, nomeClasse, metodo, arquivo, linhaTexto] = q;
    const classe = classes.get(nomeClasse);
    if (!classe) {
      saida.push(linha);
      continue;
    }
    const numero = linhaTexto ? Number(linhaTexto) : null;
    const candidatos = classe.metodos.get(metodo) ?? [];
    const porLinha =
      numero === null
        ? []
        : candidatos.filter((m) => m.de !== null && m.ate !== null && numero >= m.de && numero <= m.ate);
    const escolhidos = porLinha.length ? porLinha : candidatos.filter((m) => m.de === null);
    if (!escolhidos.length) {
      saida.push(`${recuo}${classe.original}.${metodo}(${classe.arquivo ?? arquivo}${numero ? `:${numero}` : ""})`);
      continue;
    }
    // Mais de um: o R8 embutiu métodos uns nos outros — cada um vira um quadro.
    for (const m of escolhidos) {
      const original =
        numero !== null && m.de !== null && m.origDe !== null
          ? m.origAte !== null && m.origAte !== m.origDe
            ? m.origDe + (numero - m.de)
            : m.origDe
          : numero;
      saida.push(`${recuo}${m.classe}.${m.metodo}(${classe.arquivo ?? arquivo}${original ? `:${original}` : ""})`);
    }
  }
  return saida.join("\n");
}

/**
 * A pilha desembaralhada com o mapeamento da versão, ou a própria pilha se não
 * houver mapeamento ou algo falhar. Nunca lança: erro aqui não pode esconder o
 * travamento que se queria relatar.
 */
export async function desembaralharDaVersao(pilha: string, build: string): Promise<string> {
  try {
    if (!/^\d{1,8}$/.test(build)) return pilha;
    const caminho = join(PASTA_MAPEAMENTOS, `${build}.txt`);
    if (!existsSync(caminho)) return pilha;
    const classes = await lerClasses(caminho, classesDaPilha(pilha));
    return desembaralhar(pilha, classes);
  } catch (erro) {
    console.warn("Não consegui desembaralhar a pilha:", erro instanceof Error ? erro.message : erro);
    return pilha;
  }
}
