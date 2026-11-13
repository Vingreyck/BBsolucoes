/**
 * De quem é esta usina que o portal mostrou? A sugestão, sem banco — conferida
 * pelo `testar-regras.ts`.
 *
 * Quando o técnico anota o serial do inversor, a ligação é automática
 * (`reconciliarSeriais`). Quando não anota, a usina chega **sem dono**, com um
 * nome de portal que não diz nada. Aqui a regra procura, entre as vendas que já
 * foram instaladas e ainda não têm usina, a que mais combina: nome parecido,
 * mesma cidade e a instalação concluída na semana em que a usina nasceu.
 *
 * É sugestão, nunca decisão: quem confirma é a pessoa. Ligar errado levaria a
 * geração de um cliente para o dossiê de outro, e isso não se vê olhando a tela.
 */

export interface UsinaOrfa {
  nome: string;
  cidade: string | null;
  /** A data de instalação que o portal informa; sem ela, vale o dia em que o Selebi a viu. */
  instaladaEm: Date | null;
  criadaEm: Date;
}

export interface CandidatoDeProjeto {
  projetoId: string;
  clienteId: string;
  clienteNome: string;
  cidade: string | null;
  /** Quando a OS de instalação do projeto foi concluída. */
  instalacaoConcluidaEm: Date | null;
}

export interface SugestaoDeProjeto {
  projetoId: string;
  clienteId: string;
  clienteNome: string;
  pontos: number;
  /** Em palavras, por que combinou: "nome parecido", "mesma cidade"… */
  motivos: string[];
}

const DIA_MS = 86_400_000;

/** Pontos mínimos para aparecer: sozinha, a cidade (1) ou a data (2) não bastam. */
export const PONTOS_MINIMOS = 3;

/** Palavras que não identificam ninguém num nome de pessoa. */
const LIGACOES = new Set(["de", "da", "do", "dos", "das", "e"]);

function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    // Número não identifica ninguém: "José Fernando7" e "micaely 03" são o login que o técnico digitou.
    .replace(/[^a-z ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** As palavras do nome que identificam alguém (sem "de", "da" e sem sílabas soltas). */
function palavras(texto: string): string[] {
  return [...new Set(normalizar(texto).split(" ").filter((p) => p.length >= 3 && !LIGACOES.has(p)))];
}

/**
 * Quanto o nome do cliente aparece no nome da usina.
 * - todas as palavras do cliente (duas ou mais) estão na usina: 4;
 * - duas ou mais palavras em comum: 3;
 * - uma só palavra em comum, de quatro letras ou mais: 1 (sozinha, não basta).
 */
export function pontosDoNome(nomeUsina: string, nomeCliente: string): number {
  const da = new Set(palavras(nomeUsina));
  const doCliente = palavras(nomeCliente);
  if (!da.size || !doCliente.length) return 0;
  const comuns = doCliente.filter((p) => da.has(p));
  if (doCliente.length >= 2 && comuns.length === doCliente.length) return 4;
  if (comuns.length >= 2) return 3;
  if (comuns.length === 1 && comuns[0].length >= 4) return 1;
  return 0;
}

/**
 * A usina aparece depois da instalação (o técnico a cria no portal ao terminar):
 * de 3 dias antes até 10 depois, vale 2; até 20 depois, 1. A data do portal vem
 * sem hora, por isso a folga para trás.
 */
export function pontosDaData(usina: Pick<UsinaOrfa, "instaladaEm" | "criadaEm">, concluidaEm: Date | null): number {
  if (!concluidaEm) return 0;
  const referencia = usina.instaladaEm ?? usina.criadaEm;
  const dias = (referencia.getTime() - concluidaEm.getTime()) / DIA_MS;
  if (dias >= -3 && dias <= 10) return 2;
  if (dias > 10 && dias <= 20) return 1;
  return 0;
}

/** Os projetos que mais combinam com a usina, do melhor para o pior (no máximo 3). */
export function sugerirVendasParaUsina(usina: UsinaOrfa, candidatos: CandidatoDeProjeto[]): SugestaoDeProjeto[] {
  const cidadeDaUsina = usina.cidade ? normalizar(usina.cidade) : null;
  return candidatos
    .map((c) => {
      const motivos: string[] = [];
      let pontos = 0;

      const doNome = pontosDoNome(usina.nome, c.clienteNome);
      if (doNome) {
        pontos += doNome;
        motivos.push(doNome >= 3 ? "nome parecido" : "um nome em comum");
      }
      if (cidadeDaUsina && c.cidade && normalizar(c.cidade) === cidadeDaUsina) {
        pontos += 1;
        motivos.push("mesma cidade");
      }
      const daData = pontosDaData(usina, c.instalacaoConcluidaEm);
      if (daData) {
        pontos += daData;
        motivos.push("instalada na mesma época");
      }
      return { projetoId: c.projetoId, clienteId: c.clienteId, clienteNome: c.clienteNome, pontos, motivos };
    })
    .filter((s) => s.pontos >= PONTOS_MINIMOS)
    .sort((a, b) => b.pontos - a.pontos || a.clienteNome.localeCompare(b.clienteNome, "pt-BR"))
    .slice(0, 3);
}

/** Dias inteiros entre duas datas (agora menos o início), nunca negativo. */
export function diasDesde(inicio: Date, agora: Date = new Date()): number {
  return Math.max(0, Math.floor((agora.getTime() - inicio.getTime()) / DIA_MS));
}
