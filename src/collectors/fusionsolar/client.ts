import { ErroColetor } from "../types";

/**
 * Cliente da Northbound API do FusionSolar (Huawei).
 *
 * Três coisas separam esta API de todas as outras do projeto.
 *
 * **A credencial não é a do portal.** `userName` e `systemCode` são de uma conta
 * *northbound*, criada à parte pelo instalador em
 * `System → Company Management → Northbound Management`. Tentar entrar aqui com
 * o login do site devolve 20400 e, repetido, tranca a conta por 30 minutos.
 *
 * **O token vem no cabeçalho, não no corpo.** O `POST /thirdData/login` responde
 * um JSON que não contém o token: ele chega em `xsrf-token` (às vezes só no
 * `Set-Cookie`) e tem que voltar em `XSRF-TOKEN` a cada chamada seguinte. Quem
 * procura o token no corpo conclui que o login falhou, e ele passou.
 *
 * **A sessão é única e os limites são duros.** Uma sessão por conta — logar de
 * novo derruba a anterior. Cinco logins a cada dez minutos. Nos dados, cerca de
 * `⌈usinas ÷ 100⌉` chamadas a cada cinco minutos para o KPI de agora, e
 * `⌈usinas ÷ 100⌉ + 24` no dia inteiro para o histórico diário. Estourou, vem
 * `failCode 407` e a janela inteira se fecha. Por isso o cliente guarda o token,
 * só reloga quando o próprio portal pede (305), e conta os logins para não
 * trancar a conta sozinho.
 */

const CAMINHO_LOGIN = "/thirdData/login";

/** Cinco logins a cada dez minutos. O sexto tranca a conta. */
const JANELA_LOGIN_MS = 10 * 60 * 1000;
const LOGINS_POR_JANELA = 5;

export interface RespostaHuawei<T = unknown> {
  success: boolean;
  failCode: number;
  message?: string | null;
  params?: Record<string, unknown>;
  data?: T;
}

/** Usina como o resto do sistema vê, já com as duas rotas conciliadas. */
export interface UsinaHuawei {
  codigo: string;
  nome: string;
  /**
   * Como a Huawei mandou, sem converter. A unidade documentada é **MW** — uma
   * casa de 8 kWp chega como `0.008`. Fica cru de propósito: o probe imprime o
   * número junto com a leitura em kWp, para conferir contra o portal antes de
   * qualquer conta depender disso.
   */
  capacidadeBruta?: number;
  endereco?: string;
  conexaoEm?: string;
  bruto: unknown;
}

const ERROS: Record<number, string> = {
  305: "sessão expirada ou derrubada por outro login",
  401: "a conta northbound não tem permissão para este recurso",
  407: "estourou o limite de chamadas — espere a janela virar",
  20400: "usuário ou systemCode errado, ou conta trancada por tentativas",
  20007: "usina não encontrada",
  20008: "dispositivo não encontrado",
};

function tokenDoCookie(bruto: string | null): string | null {
  if (!bruto) return null;
  const m = /XSRF-TOKEN=([^;,\s]+)/i.exec(bruto);
  return m ? m[1] : null;
}

export class FusionSolarClient {
  private token: string | null = null;
  /** Instantes dos logins recentes, para não trancar a conta. */
  private readonly logins: number[] = [];

  constructor(
    private readonly usuario: string,
    private readonly systemCode: string,
    private readonly base: string,
  ) {}

  /**
   * Faz login e guarda o token. Chamar de novo derruba a sessão anterior, então
   * só é chamado na primeira requisição e quando o portal devolve 305.
   */
  async autenticar(): Promise<void> {
    const agora = Date.now();
    while (this.logins.length && agora - this.logins[0] > JANELA_LOGIN_MS) {
      this.logins.shift();
    }
    if (this.logins.length >= LOGINS_POR_JANELA) {
      const esperaMin = Math.ceil(
        (JANELA_LOGIN_MS - (agora - this.logins[0])) / 60000,
      );
      throw new ErroColetor(
        `Já foram ${LOGINS_POR_JANELA} logins em dez minutos. Mais um e a Huawei ` +
          `tranca a conta por 30 minutos — esperando ${esperaMin} min.`,
        "huawei",
      );
    }
    this.logins.push(agora);

    let res: Response;
    try {
      res = await fetch(`${this.base}${CAMINHO_LOGIN}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userName: this.usuario,
          systemCode: this.systemCode,
        }),
      });
    } catch (erro) {
      throw new ErroColetor(
        `Não consegui falar com ${this.base}. Confira o prefixo do host — ele é ` +
          "o mesmo que aparece na barra de endereço quando você entra no " +
          `FusionSolar. Detalhe: ${erro instanceof Error ? erro.message : erro}`,
        "huawei",
      );
    }

    const texto = await res.text();
    let corpo: RespostaHuawei;
    try {
      corpo = JSON.parse(texto) as RespostaHuawei;
    } catch {
      throw new ErroColetor(
        `${this.base}${CAMINHO_LOGIN} respondeu HTML, não JSON (HTTP ${res.status}). ` +
          "Quase sempre é host errado: a Northbound API só existe no servidor da " +
          "sua região.",
        "huawei",
      );
    }

    if (!corpo.success) {
      throw new ErroColetor(
        `Login recusado: failCode ${corpo.failCode} — ` +
          (ERROS[corpo.failCode] ?? corpo.message ?? "sem detalhe"),
        "huawei",
      );
    }

    const cabecalhos = res.headers;
    const setCookie =
      typeof cabecalhos.getSetCookie === "function"
        ? cabecalhos.getSetCookie().join("; ")
        : cabecalhos.get("set-cookie");

    const token = cabecalhos.get("xsrf-token") ?? tokenDoCookie(setCookie);
    if (!token) {
      throw new ErroColetor(
        "A Huawei aceitou o login mas não devolveu o xsrf-token. Sem ele nenhuma " +
          "outra chamada passa.",
        "huawei",
      );
    }
    this.token = token;
  }

  /**
   * Uma chamada de dados. Reloga uma única vez se a sessão tiver caído —
   * repetir mais que isso só serve para trancar a conta.
   */
  async chamar<T>(
    caminho: string,
    corpo: Record<string, unknown> = {},
    jaRelogou = false,
  ): Promise<RespostaHuawei<T>> {
    if (!this.token) await this.autenticar();

    const res = await fetch(`${this.base}${caminho}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "XSRF-TOKEN": this.token as string,
      },
      body: JSON.stringify(corpo),
    });

    const texto = await res.text();
    let dados: RespostaHuawei<T>;
    try {
      dados = JSON.parse(texto) as RespostaHuawei<T>;
    } catch {
      throw new ErroColetor(
        `FusionSolar respondeu não-JSON em ${caminho} (HTTP ${res.status}): ` +
          texto.slice(0, 120),
        "huawei",
      );
    }

    if (dados.failCode === 305 && !jaRelogou) {
      this.token = null;
      await this.autenticar();
      return this.chamar<T>(caminho, corpo, true);
    }

    if (!dados.success) {
      throw new ErroColetor(
        `FusionSolar recusou ${caminho}: failCode ${dados.failCode} — ` +
          (ERROS[dados.failCode] ?? dados.message ?? "sem detalhe"),
        "huawei",
        dados.failCode === 305,
      );
    }

    return dados;
  }

  /**
   * Lista as usinas.
   *
   * Há duas rotas para a mesma coisa, com nomes de campo diferentes: a nova
   * `/stations` (paginada, `plantCode`/`plantName`) e a antiga `getStationList`
   * (sem paginação, `stationCode`/`stationName`), que a Huawei marcou para sair
   * mas ainda é a única disponível em algumas contas. Tenta a nova e cai na
   * antiga, devolvendo o mesmo formato nos dois casos.
   */
  async listarUsinas(): Promise<{ usinas: UsinaHuawei[]; rota: string }> {
    try {
      const usinas: UsinaHuawei[] = [];
      let pagina = 1;
      let paginas = 1;

      do {
        const r = await this.chamar<{
          list?: Record<string, unknown>[];
          pageCount?: number;
        }>("/thirdData/stations", { pageNo: pagina, pageSize: 100 });

        for (const u of r.data?.list ?? []) {
          usinas.push({
            codigo: String(u.plantCode ?? ""),
            nome: String(u.plantName ?? ""),
            capacidadeBruta:
              typeof u.capacity === "number" ? u.capacity : undefined,
            endereco: u.plantAddress ? String(u.plantAddress) : undefined,
            conexaoEm: u.gridConnectionDate
              ? String(u.gridConnectionDate)
              : undefined,
            bruto: u,
          });
        }

        paginas = r.data?.pageCount ?? 1;
        pagina += 1;
      } while (pagina <= paginas);

      return { usinas, rota: "/thirdData/stations" };
    } catch (erro) {
      // 401 aqui costuma ser conta antiga sem a rota nova, não falta de
      // permissão de verdade. Vale tentar a antiga antes de desistir.
      const r = await this.chamar<Record<string, unknown>[]>(
        "/thirdData/getStationList",
        {},
      );
      const usinas = (r.data ?? []).map((u) => ({
        codigo: String(u.stationCode ?? ""),
        nome: String(u.stationName ?? ""),
        capacidadeBruta: typeof u.capacity === "number" ? u.capacity : undefined,
        endereco: u.stationAddr ? String(u.stationAddr) : undefined,
        conexaoEm: u.gridConnectionDate ? String(u.gridConnectionDate) : undefined,
        bruto: u,
      }));
      if (usinas.length === 0 && erro instanceof Error) {
        // Sem usina em nenhuma das rotas: devolve a lista vazia, mas o motivo
        // da rota nova ter falhado é a informação que interessa.
        console.warn(`  (rota /stations falhou: ${erro.message})`);
      }
      return { usinas, rota: "/thirdData/getStationList" };
    }
  }

  /** Geração e estado de agora. Até 100 usinas por chamada. */
  kpiAgora(codigos: string[]) {
    return this.chamar<Record<string, unknown>[]>("/thirdData/getStationRealKpi", {
      stationCodes: codigos.slice(0, 100).join(","),
    });
  }

  /** Geração fechada do dia. `quando` é qualquer instante dentro do dia. */
  kpiDia(codigos: string[], quando: Date) {
    return this.chamar<Record<string, unknown>[]>("/thirdData/getKpiStationDay", {
      stationCodes: codigos.slice(0, 100).join(","),
      collectTime: quando.getTime(),
    });
  }

  /** Inversores, baterias e medidores das usinas. `devTypeId` 1 = inversor. */
  listarDispositivos(codigos: string[]) {
    return this.chamar<Record<string, unknown>[]>("/thirdData/getDevList", {
      stationCodes: codigos.slice(0, 100).join(","),
    });
  }
}
