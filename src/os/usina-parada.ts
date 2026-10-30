/**
 * Quando uma usina parada vira OS sozinha — a regra, sem banco, para o
 * `testar-regras.ts` conferir.
 *
 * O detector (`collectors/detectar.ts`) já abre um alerta "offline" para cada
 * dia em que a usina não gerou **enquanto as vizinhas geraram** — dia de chuva
 * não conta, porque aí todo mundo cai junto. Um dia só ainda pode ser o
 * disjuntor que o cliente desligou e religou; dois dias seguidos sem gerar já
 * é visita. Daí a regra:
 *
 * - **2 dias parados nos últimos 4** → abre OS corretiva, prioridade alta;
 * - ou o alerta de "praticamente sem geração" (a usina que passou o período
 *   inteiro parada e por isso nem tem padrão), que já vale sozinho;
 * - só alerta recente: o histórico antigo não vira uma enxurrada de OS no
 *   primeiro dia em que a regra liga;
 * - usina sem dono não vira OS (não há casa para ir) e usina que já tem OS
 *   aberta ganha os alertas novos ligados a ela, em vez de uma OS repetida.
 */

/** Dias parados, dentro da janela, para abrir a OS. */
export const DIAS_PARADA_PARA_OS = 2;

/** A janela olhada para trás, em dias. */
export const JANELA_DIAS = 4;

/**
 * Se mais que esta fração do parque parece parada ao mesmo tempo, o problema
 * é o portal ou a coleta, não as usinas: nenhuma OS é aberta.
 */
export const FRACAO_MAXIMA_PARADA = 0.2;

export interface AlertaParada {
  id: string;
  usinaId: string;
  abertoEm: Date;
  mensagem: string;
}

export interface UsinaParada {
  usinaId: string;
  alertaIds: string[];
  /** Os dias parados na janela, do mais antigo ao mais novo ("2026-10-28"). */
  dias: string[];
  /** Parada o período inteiro ("praticamente sem geração"). */
  semGeracao: boolean;
}

export function ehSemGeracao(mensagem: string): boolean {
  return mensagem.startsWith("Praticamente sem geração");
}

/** As usinas que pedem OS, a partir dos alertas "offline" abertos e ainda sem OS. */
export function usinasParadas(alertas: AlertaParada[], agora = new Date()): UsinaParada[] {
  const desde = agora.getTime() - JANELA_DIAS * 86_400_000;
  const porUsina = new Map<string, AlertaParada[]>();
  for (const a of alertas) {
    if (a.abertoEm.getTime() < desde) continue;
    const lista = porUsina.get(a.usinaId) ?? [];
    lista.push(a);
    porUsina.set(a.usinaId, lista);
  }
  const resultado: UsinaParada[] = [];
  for (const [usinaId, lista] of porUsina) {
    const semGeracao = lista.some((a) => ehSemGeracao(a.mensagem));
    const dias = [...new Set(lista.filter((a) => !ehSemGeracao(a.mensagem)).map((a) => a.abertoEm.toISOString().slice(0, 10)))].sort();
    if (semGeracao || dias.length >= DIAS_PARADA_PARA_OS) {
      resultado.push({ usinaId, alertaIds: lista.map((a) => a.id), dias, semGeracao });
    }
  }
  return resultado;
}

/** "28/10" */
function diaCurto(dia: string): string {
  return `${dia.slice(8, 10)}/${dia.slice(5, 7)}`;
}

/** O que o técnico lê na OS: por que ela existe e o que olhar primeiro. */
export function descricaoDaOs(p: UsinaParada): string {
  const quando = p.semGeracao
    ? "não gerou praticamente nada no período monitorado"
    : `não gerou nada em ${p.dias.length} dias (${p.dias.map(diaCurto).join(", ")}), enquanto as usinas vizinhas geraram normalmente`;
  return [
    `Aberta automaticamente pelo monitoramento: a usina ${quando}.`,
    "Verificar, nesta ordem: disjuntor do inversor ligado, inversor com tela/LED de falha, " +
      "internet do datalogger (Wi-Fi do cliente) e cabos CC.",
    "Se for só a internet, a usina pode estar gerando — confirme no medidor antes de abrir o inversor.",
  ].join("\n");
}
