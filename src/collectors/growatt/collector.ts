import { GrowattSessionClient } from "./client";
import { ErroColetor, type Coletor, type EquipamentoRemoto, type UsinaRemota } from "../types";

/**
 * Coletor Growatt sobre a API de sessão.
 *
 * O mapeamento de campos abaixo é a melhor hipótese a partir de bibliotecas de
 * comunidade — a Growatt não publica esse formato. Rode `npm run probe:growatt`
 * contra a conta real primeiro e ajuste `NOMES_*` conforme o que voltar de fato.
 */

/** Candidatos de nome para cada campo, na ordem de preferência. */
const NOMES_USINA = {
  id: ["id", "plantId", "plant_id"],
  nome: ["plantName", "plantname", "name"],
  potenciaKwp: ["nominalPower", "nominal_power", "capacity"],
  cidade: ["city", "plantCity"],
  energiaTotal: ["totalEnergy", "eTotal", "total_energy"],
  energiaDia: ["todayEnergy", "eToday", "today_energy"],
  potenciaAtual: ["currentPower", "power", "pac"],
  status: ["status", "plantStatus"],
} as const;

const NOMES_DISPOSITIVO = {
  id: ["deviceSn", "sn", "deviceAilas", "id"],
  serie: ["deviceSn", "sn", "alias"],
  tipo: ["deviceType", "type"],
  modelo: ["deviceModel", "model"],
  status: ["status", "deviceStatus"],
  potenciaAtual: ["pac", "power", "currentPower"],
  energiaDia: ["eToday", "todayEnergy"],
  energiaTotal: ["eTotal", "totalEnergy"],
} as const;

function pegar(obj: Record<string, unknown>, chaves: readonly string[]): unknown {
  for (const k of chaves) {
    if (obj[k] !== undefined && obj[k] !== null && obj[k] !== "") return obj[k];
  }
  return undefined;
}

function comoNumero(v: unknown): number | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  // A Growatt manda número como string com frequência, e às vezes com unidade.
  const n = typeof v === "number" ? v : Number(String(v).replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : undefined;
}

function comoTexto(v: unknown): string | undefined {
  return v === undefined || v === null ? undefined : String(v);
}

/**
 * A resposta vem embrulhada de formas diferentes conforme o endpoint
 * (`back.data`, `back`, `data`, ou o array direto). Desembrulha até achar lista.
 */
function extrairLista(payload: unknown): Record<string, unknown>[] {
  const visitar = (v: unknown, profundidade: number): Record<string, unknown>[] | null => {
    if (profundidade > 4 || v === null || typeof v !== "object") return null;
    if (Array.isArray(v)) {
      return v.filter((i): i is Record<string, unknown> => typeof i === "object" && i !== null);
    }
    for (const chave of ["data", "back", "datas", "list", "records", "obj"]) {
      const filho = (v as Record<string, unknown>)[chave];
      const achado = visitar(filho, profundidade + 1);
      if (achado?.length) return achado;
    }
    return null;
  };
  return visitar(payload, 0) ?? [];
}

export class GrowattColetor implements Coletor {
  readonly fabricante = "growatt" as const;
  /**
   * A Growatt não publica teto diário na v1, mas o histórico é limitado a
   * janelas de 7 dias por requisição. 15 min é conservador e suficiente.
   */
  readonly cadenciaMinimaMin = 15;

  private cliente: GrowattSessionClient;

  constructor(
    usuario: string,
    senha: string,
    opcoes: { debug?: boolean; base?: string } = {},
  ) {
    this.cliente = new GrowattSessionClient(usuario, senha, opcoes);
  }

  get capturas() {
    return this.cliente.capturas;
  }

  /** Host que respondeu — a Growatt bloqueia alguns e move a API de tempos em tempos. */
  get host() {
    return this.cliente.hostEmUso;
  }

  async autenticar(): Promise<void> {
    await this.cliente.login();
  }

  async listarUsinas(): Promise<UsinaRemota[]> {
    const payload = await this.cliente.listarUsinas();
    const linhas = extrairLista(payload);

    if (!linhas.length) {
      throw new ErroColetor(
        "A conta autenticou mas nenhuma usina foi reconhecida na resposta. " +
          "Rode o probe e ajuste o mapeamento — o formato provavelmente mudou.",
        "growatt",
      );
    }

    return linhas.map((linha) => {
      const id = comoTexto(pegar(linha, NOMES_USINA.id));
      if (!id) {
        throw new ErroColetor(
          `Usina sem id reconhecível. Campos vistos: ${Object.keys(linha).join(", ")}`,
          "growatt",
        );
      }
      return {
        idExterno: id,
        nome: comoTexto(pegar(linha, NOMES_USINA.nome)) ?? `Usina ${id}`,
        potenciaKwp: comoNumero(pegar(linha, NOMES_USINA.potenciaKwp)),
        cidade: comoTexto(pegar(linha, NOMES_USINA.cidade)),
        statusBruto: comoTexto(pegar(linha, NOMES_USINA.status)),
        energiaTotalKwh: comoNumero(pegar(linha, NOMES_USINA.energiaTotal)),
        energiaDiaKwh: comoNumero(pegar(linha, NOMES_USINA.energiaDia)),
        potenciaAtualW: comoNumero(pegar(linha, NOMES_USINA.potenciaAtual)),
        bruto: linha,
      } satisfies UsinaRemota;
    });
  }

  async listarEquipamentos(idExternoUsina: string): Promise<EquipamentoRemoto[]> {
    const payload = await this.cliente.listarDispositivos(idExternoUsina);
    return extrairLista(payload).map((linha) => {
      const id = comoTexto(pegar(linha, NOMES_DISPOSITIVO.id));
      return {
        idExterno: id ?? "",
        numeroSerie: comoTexto(pegar(linha, NOMES_DISPOSITIVO.serie)),
        tipo: comoTexto(pegar(linha, NOMES_DISPOSITIVO.tipo)),
        modelo: comoTexto(pegar(linha, NOMES_DISPOSITIVO.modelo)),
        statusBruto: comoTexto(pegar(linha, NOMES_DISPOSITIVO.status)),
        potenciaAtualW: comoNumero(pegar(linha, NOMES_DISPOSITIVO.potenciaAtual)),
        energiaDiaKwh: comoNumero(pegar(linha, NOMES_DISPOSITIVO.energiaDia)),
        energiaTotalKwh: comoNumero(pegar(linha, NOMES_DISPOSITIVO.energiaTotal)),
        bruto: linha,
      } satisfies EquipamentoRemoto;
    });
  }
}
