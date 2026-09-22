import { createHash, createHmac } from "node:crypto";

import { ErroColetor } from "../types";

/**
 * Cliente da API do SolisCloud.
 *
 * A autenticação é a mais trabalhosa das três que o projeto fala. Cada
 * requisição é assinada com HMAC-SHA1 sobre cinco linhas, nesta ordem:
 *
 *     POST
 *     <md5 do corpo, em base64>
 *     application/json
 *     <data em GMT>
 *     <caminho>
 *
 * O resultado vai em `Authorization: API <keyId>:<assinatura>`. Três detalhes
 * derrubam a chamada sem explicar por quê:
 *
 * - **O Content-MD5 é do corpo exato que será enviado.** Serializar duas vezes
 *   dá strings diferentes e assinatura inválida, por isso o corpo é montado uma
 *   vez só e reaproveitado.
 * - **A data precisa bater com a do servidor deles.** Mais de alguns minutos de
 *   diferença e a requisição é recusada.
 * - **Barra no fim da URL base quebra tudo.** O SolisCloud devolve HTTP 500
 *   reclamando de "potentially malicious String //" — parece ataque, é só uma
 *   barra sobrando. Por isso o construtor apara a barra em vez de confiar.
 */

/**
 * Base oficial, porta 13333 e tudo.
 *
 * Conferida em 22/09/2026 contra o *SolisCloud Platform API Document V2.0.2*,
 * 129 páginas, publicado pela própria Ginlong em
 * `oss.soliscloud.com/templet/`. Bate com o que estava aqui.
 */
const BASE_PADRAO = "https://www.soliscloud.com:13333";
const TIPO = "application/json";

/**
 * Limites que a documentação da Solis publica, e o que eles significam aqui.
 *
 * - *"The update frequency for all interface data is 5 minutes"* — o dado só
 *   muda de cinco em cinco minutos do lado deles. Consultar mais rápido não
 *   traz número novo, só gasta chamada. A cadência de 15 min em
 *   `conta_portal` está folgada de propósito.
 * - *"Interface frequency limit 2 times/sec"*, por endpoint.
 *
 * O coletor faz **três chamadas por conta** — `userStationList`,
 * `inverterList` e `collectorList` —, cada uma num endpoint diferente. Com duas
 * contas são seis chamadas, longe do teto. Por isso não há espaçamento
 * artificial aqui: ele seria enfeite, e enfeite que esconde o motivo.
 *
 * Se um dia o coletor passar a chamar `inverterDetail` por inversor, aí o teto
 * de 2/s passa a valer de verdade e o espaçamento vira obrigatório.
 */
export const LIMITE_POR_SEGUNDO = 2;
export const ATUALIZACAO_DO_DADO_MIN = 5;

export interface RespostaSolis<T = unknown> {
  success: boolean;
  code?: string;
  msg?: string;
  data?: T;
}

export interface UsinaSolis {
  id: string;
  stationName?: string;
  /** Potência instalada. A unidade vem em `capacityStr` — costuma ser kWp. */
  capacity?: number;
  capacityStr?: string;
  dayPowerGeneration?: number;
  allPowerGeneration?: number;
  power?: number;
  powerStr?: string;
  /** 1 online, 2 offline, 3 em falha — confirmado pelos contadores da lista. */
  state?: number;
  /** Alarmes abertos na usina. 0 quando está tudo certo. */
  alarmCount?: number;
  alarmMsg?: string;
  /**
   * Endereço como quem cadastrou a usina digitou. Na conta da BB, `cityStr`
   * veio com o nome do estado e `countyStr` com o bairro — o portal não
   * valida nada disso, então serve de ponto de partida, não de verdade.
   */
  cityStr?: string;
  regionStr?: string;
  addrOrigin?: string;
  dataTimestamp?: string;
}

export interface InversorSolis {
  id: string;
  sn?: string;
  stationId?: string;
  model?: string;
  productModel?: string;
  collectorSn?: string;
  /** 1 online, 2 offline, 3 alarme. */
  state?: number;
  etoday?: number;
  etotal?: number;
  pac?: number;
  pacStr?: string;
}

export class SolisClient {
  private readonly base: string;

  constructor(
    private readonly keyId: string,
    private readonly keySecret: string,
    base = BASE_PADRAO,
  ) {
    this.base = base.replace(/\/+$/, "");
  }

  async chamar<T>(
    caminho: string,
    corpo: Record<string, unknown> = {},
  ): Promise<RespostaSolis<T>> {
    const texto = JSON.stringify(corpo);
    const md5 = createHash("md5").update(texto).digest("base64");
    const data = new Date().toUTCString();
    const assinatura = createHmac("sha1", this.keySecret)
      .update(["POST", md5, TIPO, data, caminho].join("\n"))
      .digest("base64");

    const res = await fetch(this.base + caminho, {
      method: "POST",
      headers: {
        "Content-Type": TIPO,
        "Content-MD5": md5,
        Date: data,
        Authorization: `API ${this.keyId}:${assinatura}`,
      },
      body: texto,
    });

    const bruto = await res.text();
    let dados: RespostaSolis<T>;
    try {
      dados = JSON.parse(bruto) as RespostaSolis<T>;
    } catch {
      throw new ErroColetor(
        `SolisCloud respondeu não-JSON em ${caminho} (HTTP ${res.status}): ` +
          bruto.slice(0, 160),
        "solis",
      );
    }

    if (!dados.success) {
      throw new ErroColetor(
        `SolisCloud recusou ${caminho}: ${dados.code ?? "?"} — ` +
          (dados.msg ?? "sem detalhe"),
        "solis",
        // 403/1004 é assinatura ou relógio fora de hora: vale tentar de novo.
        dados.code === "403" || dados.code === "1004",
      );
    }

    return dados;
  }

  listarUsinas(pagina = 1, porPagina = 100) {
    return this.chamar<{
      page?: { records?: UsinaSolis[] };
      stationStatusVo?: Record<string, number>;
    }>("/v1/api/userStationList", { pageNo: pagina, pageSize: porPagina });
  }

  listarInversores(usinaId?: string, pagina = 1, porPagina = 100) {
    return this.chamar<{ page?: { records?: InversorSolis[] } }>(
      "/v1/api/inverterList",
      {
        pageNo: pagina,
        pageSize: porPagina,
        ...(usinaId ? { stationId: usinaId } : {}),
      },
    );
  }

  /** Dataloggers. É o que mais cai em campo, e o que explica "usina sumiu". */
  listarColetores(usinaId?: string, pagina = 1, porPagina = 100) {
    return this.chamar<{ page?: { records?: Record<string, unknown>[] } }>(
      "/v1/api/collectorList",
      {
        pageNo: pagina,
        pageSize: porPagina,
        ...(usinaId ? { stationId: usinaId } : {}),
      },
    );
  }
}
