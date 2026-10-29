/**
 * O que a rota `/api/saude` confere, sem banco nem Drive: só as contas.
 *
 * Cada verificação devolve `ok` e uma frase curta. A rota junta tudo; um
 * monitor externo (UptimeRobot, Healthchecks) chama a rota e alerta quando ela
 * responde 503 — ou quando nem responde, que é o caso de o site ter caído.
 */

export interface Verificacao {
  nome: string;
  ok: boolean;
  detalhe: string;
}

const HORA = 3_600_000;

/** Quanto tempo uma coisa pode ficar sem atualizar antes de virar problema. */
export const LIMITES = {
  /** A rodada do coletor é de hora em hora; três horas sem rodar é coletor parado. */
  coletorMs: 3 * HORA,
  /** Uma cópia por dia; 36 h dá folga para a rodada da manhã atrasar. */
  backupMs: 36 * HORA,
  discoPorcento: 85,
};

function idade(ms: number): string {
  const h = ms / HORA;
  return h < 1 ? `${Math.round(h * 60)} min` : h < 48 ? `${Math.round(h)} h` : `${Math.round(h / 24)} dias`;
}

export function verificarColetor(
  estado: { fim: string; alerta: boolean; motivos: string[] } | null,
  agora = Date.now(),
): Verificacao {
  if (!estado) return { nome: "coletor", ok: false, detalhe: "nenhuma rodada registrada ainda" };
  const parado = agora - new Date(estado.fim).getTime();
  if (parado > LIMITES.coletorMs) {
    return { nome: "coletor", ok: false, detalhe: `a última rodada foi há ${idade(parado)}` };
  }
  if (estado.alerta) {
    return { nome: "coletor", ok: false, detalhe: estado.motivos.join("; ") || "a última rodada pediu atenção" };
  }
  return { nome: "coletor", ok: true, detalhe: `última rodada há ${idade(parado)}` };
}

export function verificarBackupLocal(maisNovaMs: number | null, agora = Date.now()): Verificacao {
  if (maisNovaMs === null) return { nome: "backup local", ok: false, detalhe: "nenhuma cópia encontrada" };
  const velho = agora - maisNovaMs;
  return velho > LIMITES.backupMs
    ? { nome: "backup local", ok: false, detalhe: `a última cópia tem ${idade(velho)}` }
    : { nome: "backup local", ok: true, detalhe: `última cópia há ${idade(velho)}` };
}

/** `configurado` falso = a cópia externa nem foi ligada: isso é problema, não "tudo bem". */
export function verificarBackupExterno(
  configurado: boolean,
  envio: { ok: boolean; quando: string; erro?: string } | null,
  agora = Date.now(),
): Verificacao {
  if (!configurado) return { nome: "backup no Drive", ok: false, detalhe: "não configurado (falta BACKUP_SENHA)" };
  if (!envio) return { nome: "backup no Drive", ok: false, detalhe: "nenhum envio registrado ainda" };
  if (!envio.ok) return { nome: "backup no Drive", ok: false, detalhe: `o último envio falhou: ${envio.erro ?? "sem detalhe"}` };
  const velho = agora - new Date(envio.quando).getTime();
  return velho > LIMITES.backupMs
    ? { nome: "backup no Drive", ok: false, detalhe: `o último envio foi há ${idade(velho)}` }
    : { nome: "backup no Drive", ok: true, detalhe: `último envio há ${idade(velho)}` };
}

/** Anexo que espera o Drive há mais de 6 h: o Drive parou de aceitar, e o disco enche. */
export function verificarAnexosPendentes(
  pendentes: { quantidade: number; maisAntigo: Date | null },
  agora = Date.now(),
): Verificacao {
  const nome = "anexos esperando o Drive";
  if (!pendentes.quantidade || !pendentes.maisAntigo) return { nome, ok: true, detalhe: "nenhum" };
  const espera = agora - pendentes.maisAntigo.getTime();
  const texto = `${pendentes.quantidade}, o mais antigo há ${idade(espera)}`;
  return { nome, ok: espera <= 6 * HORA, detalhe: texto };
}

export function verificarDisco(porcento: number | null): Verificacao {
  if (porcento === null) return { nome: "disco", ok: true, detalhe: "não foi possível medir" };
  return porcento >= LIMITES.discoPorcento
    ? { nome: "disco", ok: false, detalhe: `${porcento}% em uso` }
    : { nome: "disco", ok: true, detalhe: `${porcento}% em uso` };
}
