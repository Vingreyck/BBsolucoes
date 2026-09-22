import { ErroColetor } from "../types";

/**
 * Cliente da OpenAPI v1 da Growatt — a oficial, a que vai ficar.
 *
 * Convive com `client.ts`, que fala a API de sessão do ShinePhone. Aquele é
 * engenharia reversa e existe por falta de opção; este é o caminho documentado,
 * e é ele que deve puxar as 137 usinas quando a Growatt vincular o token às
 * contas dos clientes.
 *
 * A autenticação é a mais simples de todos os sete portais: o token vai no
 * header `token`, sem assinatura, sem sessão, sem validade. O token é emitido no
 * OSS em *System Setting → System Management → API management → Add API
 * Request* e, aprovado, é permanente.
 *
 * **O que está travado hoje (09/09/2026):** o token responde `error_code 0` mas
 * `/v1/plant/list` e `/v1/user/c_user_list` devolvem `count: 0`, e pedir as
 * usinas de um cliente real devolve `10011 error_permission_denied`. O token
 * existe e não foi vinculado às contas. Chamado aberto com a Growatt. Este
 * cliente está escrito e conferido contra a API de verdade até onde dá sem essa
 * permissão — no dia em que ela sair, é rodar o probe.
 *
 * Cuidado com frequência: a Growatt limita por endpoint (cerca de 300 s entre
 * chamadas de visão geral e 60 s nas de detalhe) e devolve `FREQUENTLY_ACCESS`
 * quando estoura. Pior que o erro é o bloqueio de IP, que outros integradores
 * relatam levar dias para ser desfeito — por isso o cliente espaça as chamadas
 * sozinho em vez de confiar em quem o chama.
 */

const BASE_PADRAO = "https://openapi.growatt.com";

/** Espaçamento mínimo entre chamadas, para não acordar o limitador. */
const PAUSA_PADRAO_MS = 1500;

export interface RespostaGrowatt<T = unknown> {
  data?: T;
  error_code: number;
  error_msg?: string;
}

export interface UsinaV1 {
  plant_id: number | string;
  name?: string;
  user_id?: number | string;
  country?: string;
  city?: string;
  latitude?: string;
  longitude?: string;
  /** Potência de pico, em kWp. */
  peak_power?: number;
  create_date?: string;
  installer?: string;
  /** Potência instantânea, em kW. */
  current_power?: number;
  /** Geração acumulada, em kWh. */
  total_energy?: number;
}

export interface DispositivoV1 {
  device_id: string;
  device_sn?: string;
  datalogger_sn?: string;
  manufacturer?: string;
  model?: string;
  /** 1 inversor, 2 armazenamento, 3 outro. */
  type?: number;
  last_update_time?: string;
  /** 0 online, 1 desconectado. */
  lost?: number;
  /** Para inversor: 0 desconectado, 1 online, 2 espera, 3 falha. */
  status?: number;
}

export interface AlarmeV1 {
  sn?: string;
  alarm_code?: number | string;
  alarm_message?: string;
  start_time?: string;
  end_time?: string;
}

/**
 * O que cada código significou **nas rotas que usamos**, e não o que a
 * documentação diz em geral.
 *
 * A distinção não é preciosismo. O PDF oficial da Growatt (*Server Open API
 * protocol standards*) lista os códigos por seção, e o mesmo número quer dizer
 * coisas diferentes conforme o endpoint: lá, `10002` é "User name or password
 * is empty" e `10012` é "Energy storage machine does not exist". Nenhum dos
 * dois descreve o que vimos aqui.
 *
 * O que está nesta tabela foi **observado na prática**, chamando estas rotas
 * com este token:
 *
 * - `10002` veio ao pedir alarme passando `device_id` em vez de `device_sn`
 * - `10011` veio ao pedir usinas de um cliente antes de o token ser vinculado
 * - `10012` veio ao chamar `/v1/plant/list` duas vezes em menos de cinco
 *   minutos, duas vezes no mesmo dia, e sumiu depois de esperar
 *
 * Por isso a mensagem da Growatt vem **junto** da nossa nota, e não no lugar
 * dela: a versão anterior descartava `error_msg` sempre que o código estava
 * aqui, o que significa que, se a Growatt tivesse escrito "frequently access",
 * ninguém jamais teria lido.
 */
const ERROS: Record<number, string> = {
  10001: "erro interno da Growatt",
  10002: "identificador não encontrado — confira se o parâmetro é o serial, não o id",
  10003: "faltou o identificador na chamada",
  10004: "data inválida, ou janela maior que 7 dias",
  10011: "sem permissão — o token pode não estar vinculado a estas contas",
  10012: "observado como excesso de chamadas; esperar alguns minutos resolveu",
};

/**
 * Código que aparece quando chamamos demais.
 *
 * **Não é documentado como tal** — é o que observamos. A cautela em volta dele
 * (esperar, parar a passada, nunca insistir) vem de relatos de outros
 * integradores sobre IP bloqueado por dias, não de uma cláusula. Preferimos
 * errar para o lado de esperar: o custo de esperar é uma rodada; o de ser
 * bloqueado é o parque inteiro sem monitoramento.
 */
export const ERRO_FREQUENCIA = 10012;

/**
 * Janela que respeitamos entre chamadas de visão geral.
 *
 * **Escolha nossa, não limite publicado.** A documentação da Growatt não traz
 * teto de frequência nem de chamadas por dia em lugar nenhum — o único
 * "intervalo" que ela menciona é a janela de 7 dias entre `start_date` e
 * `end_date`, que é outra coisa. Cinco minutos é o que bateu com o
 * comportamento observado.
 */
export const JANELA_VISAO_GERAL_MS = 5 * 60 * 1000;

/**
 * Este erro é de frequência?
 *
 * Procura `error_code 10012` e não o número solto: agora que a mensagem da
 * Growatt vem junto, um `10012` que aparecesse dentro do texto dela — ou num
 * identificador — faria o coletor encerrar a passada achando que levou
 * bloqueio.
 */
export function ehErroDeFrequencia(mensagem: string): boolean {
  return new RegExp(`error_code\\s+${ERRO_FREQUENCIA}\\b`).test(mensagem);
}

export class GrowattOpenApi {
  private ultimaChamada = 0;

  constructor(
    private readonly token: string,
    private readonly opcoes: { base?: string; pausaMs?: number } = {},
  ) {}

  private get base(): string {
    return (this.opcoes.base ?? BASE_PADRAO).replace(/\/+$/, "");
  }

  private async esperarAVez(): Promise<void> {
    const pausa = this.opcoes.pausaMs ?? PAUSA_PADRAO_MS;
    const desde = Date.now() - this.ultimaChamada;
    if (desde < pausa) await new Promise((r) => setTimeout(r, pausa - desde));
    this.ultimaChamada = Date.now();
  }

  async chamar<T>(
    caminho: string,
    parametros: Record<string, string | number> = {},
    metodo: "GET" | "POST" = "GET",
  ): Promise<RespostaGrowatt<T>> {
    await this.esperarAVez();

    const query = new URLSearchParams(
      Object.entries(parametros).map(([k, v]) => [k, String(v)]),
    );
    const url =
      metodo === "GET"
        ? `${this.base}${caminho}${query.size ? `?${query}` : ""}`
        : `${this.base}${caminho}`;

    const res = await fetch(url, {
      method: metodo,
      headers: {
        token: this.token,
        ...(metodo === "POST"
          ? { "Content-Type": "application/x-www-form-urlencoded" }
          : {}),
      },
      body: metodo === "POST" ? query.toString() : undefined,
      signal: AbortSignal.timeout(45_000),
    });

    const texto = await res.text();
    let dados: RespostaGrowatt<T>;
    try {
      dados = JSON.parse(texto) as RespostaGrowatt<T>;
    } catch {
      throw new ErroColetor(
        `Growatt respondeu não-JSON em ${caminho} (HTTP ${res.status}): ` +
          texto.slice(0, 120),
        "growatt",
      );
    }

    if (dados.error_code !== 0) {
      /**
       * A mensagem da Growatt vem primeiro, e a nossa nota depois, entre
       * parênteses.
       *
       * Antes era o contrário — a nota substituía `error_msg` sempre que o
       * código estivesse na nossa tabela —, e isso apagava a única fonte
       * confiável que existe sobre esta API. A documentação dela contradiz o
       * que observamos em pelo menos dois códigos, então jogar fora o que o
       * servidor de fato disse é abrir mão de descobrir qual dos dois vale.
       */
      const daGrowatt = dados.error_msg?.trim();
      const nossa = ERROS[dados.error_code];
      const detalhe = [daGrowatt || null, nossa ? `(${nossa})` : null]
        .filter(Boolean)
        .join(" ");

      throw new ErroColetor(
        `Growatt recusou ${caminho}: error_code ${dados.error_code} — ` +
          (detalhe || "sem detalhe"),
        "growatt",
      );
    }

    return dados;
  }

  /** Usinas da própria conta do token. */
  listarUsinas(pagina = 1, porPagina = 100) {
    return this.chamar<{ plants?: UsinaV1[]; count?: number }>("/v1/plant/list", {
      page: pagina,
      perpage: porPagina,
    });
  }

  /** Clientes finais sob a conta de distribuidor. */
  listarUsuariosFinais(pagina = 1, porPagina = 100) {
    return this.chamar<{ c_user?: Record<string, unknown>[]; count?: number }>(
      "/v1/user/c_user_list",
      { page: pagina, perpage: porPagina },
    );
  }

  /** Usinas de um cliente específico. Única rota que é POST. */
  usinasDoUsuario(usuario: string, pagina = 1, porPagina = 100) {
    return this.chamar<{ plants?: UsinaV1[]; count?: number }>(
      "/v1/plant/user_plant_list",
      { user_name: usuario, page: pagina, perpage: porPagina },
      "POST",
    );
  }

  /** Visão geral de uma usina: potência agora, geração de hoje, acumulado. */
  visaoGeral(usinaId: string | number) {
    return this.chamar<{
      current_power?: number;
      today_energy?: number;
      monthly_energy?: number;
      total_energy?: number;
      last_update_time?: string;
    }>("/v1/plant/data", { plant_id: usinaId });
  }

  /**
   * Geração histórica da usina. `time_unit` aceita dia, mês e ano — o coletor
   * usa dia, que é a granularidade que o detector precisa.
   */
  energia(
    usinaId: string | number,
    inicio: string,
    fim: string,
    unidade: "day" | "month" | "year" = "day",
  ) {
    return this.chamar<{
      count?: number;
      time_unit?: string;
      energys?: { date?: string; energy?: number }[];
    }>("/v1/plant/energy", {
      plant_id: usinaId,
      start_date: inicio,
      end_date: fim,
      time_unit: unidade,
      perpage: 100,
    });
  }

  /** Inversores e dataloggers de uma usina. */
  listarDispositivos(usinaId: string | number, pagina = 1, porPagina = 100) {
    return this.chamar<{ devices?: DispositivoV1[]; count?: number }>(
      "/v1/device/list",
      { plant_id: usinaId, page: pagina, perpage: porPagina },
    );
  }

  /**
   * Alarmes de um inversor.
   *
   * É a rota que resolve o buraco da planilha: o Fault Log exportado do OSS
   * trouxe 1 evento em 5 meses enquanto 5 usinas estavam offline. Aqui o alarme
   * vem da fonte, com código e janela de início e fim.
   */
  /**
   * Vai pelo **número de série**, não pelo `device_id` numérico que a listagem
   * devolve ao lado dele: passar o id dá `10002 dispositivo não existe`, que é
   * uma mensagem infeliz para um parâmetro trocado. `date` também é exigido.
   */
  alarmes(serie: string, data: string, pagina = 1, porPagina = 100) {
    return this.chamar<{ alarms?: AlarmeV1[]; count?: number }>(
      "/v1/device/inverter/alarm",
      { device_sn: serie, date: data, page: pagina, perpage: porPagina },
    );
  }
}
