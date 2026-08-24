import { createHash } from "node:crypto";

import { ErroColetor } from "../types";

/**
 * Cliente da API de sessão da Growatt (a mesma que o app ShinePhone usa).
 *
 * ATENÇÃO: esta API é de engenharia reversa, não é documentada e a Growatt já
 * cortou o acesso a ela sem aviso antes. Ela existe aqui para uma coisa só:
 * levantar as 137 usinas hoje, sem esperar o token da OpenAPI v1. Assim que o
 * token sair, troca-se o cliente e o resto do coletor continua igual.
 *
 * Por isso o cliente guarda a resposta crua de tudo: no primeiro contato com a
 * conta real, o trabalho é descobrir o formato de verdade, não confiar no que
 * a documentação de terceiros diz.
 */

/**
 * Hosts candidatos, na ordem em que valem a tentativa.
 *
 * Em ago/2026, `openapi.growatt.com` e `server.growatt.com` respondem HTTP 403
 * com o corpo literal "error" — bloqueio, não credencial inválida. Quem atende a
 * API de sessão é `server-api.growatt.com`. Como a Growatt já mudou isso mais de
 * uma vez, o cliente varre a lista no login e trava no primeiro que responder
 * JSON, em vez de depender de uma constante que envelhece.
 */
const HOSTS_PADRAO = [
  "https://server-api.growatt.com",
  "https://openapi.growatt.com",
  "https://server.growatt.com",
];

/** Corpo devolvido pela Growatt quando o host está bloqueando. */
const CORPO_BLOQUEIO = "error";

/**
 * A Growatt não manda a senha em claro nem um MD5 normal: é o MD5 hexadecimal
 * com todo '0' em posição par trocado por 'c'. Não há razão técnica para isso —
 * é só como o app faz, e o servidor só aceita assim.
 */
export function hashSenhaGrowatt(senha: string): string {
  const md5 = createHash("md5").update(senha, "utf8").digest("hex");
  const chars = md5.split("");
  for (let i = 0; i < chars.length; i += 2) {
    if (chars[i] === "0") chars[i] = "c";
  }
  return chars.join("");
}

export interface RespostaCrua {
  url: string;
  status: number;
  corpo: unknown;
}

/** Resposta que não é JSON. `bloqueado` separa "host recusou" de "sessão caiu". */
class ErroHost extends Error {
  constructor(
    message: string,
    readonly bloqueado: boolean,
  ) {
    super(message);
    this.name = "ErroHost";
  }
}

export class GrowattSessionClient {
  private cookies = new Map<string, string>();
  private userId: string | null = null;
  private base: string;
  /** Toda resposta fica aqui quando `debug` está ligado, para inspeção. */
  readonly capturas: RespostaCrua[] = [];

  constructor(
    private readonly usuario: string,
    private readonly senha: string,
    private readonly opcoes: { base?: string; debug?: boolean } = {},
  ) {
    this.base = opcoes.base ?? HOSTS_PADRAO[0];
  }

  /** Host que efetivamente respondeu — útil no log e no diagnóstico. */
  get hostEmUso(): string {
    return this.base;
  }

  get idUsuario(): string | null {
    return this.userId;
  }

  private headerCookie(): string {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
  }

  private guardarCookies(res: Response): void {
    const brutos = res.headers.getSetCookie?.() ?? [];
    for (const linha of brutos) {
      const [par] = linha.split(";");
      const idx = par.indexOf("=");
      if (idx > 0) this.cookies.set(par.slice(0, idx).trim(), par.slice(idx + 1));
    }
  }

  private async requisitar(
    caminho: string,
    corpo?: Record<string, string>,
    baseAlternativa?: string,
  ): Promise<unknown> {
    const url = `${baseAlternativa ?? this.base}${caminho}`;
    const res = await fetch(url, {
      method: corpo ? "POST" : "GET",
      headers: {
        // Sem User-Agent de app a Growatt responde HTML de login em vez de JSON.
        "User-Agent": "Dalvik/2.1.0 (Linux; U; Android 12; ShinePhone)",
        ...(corpo
          ? { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" }
          : {}),
        ...(this.cookies.size ? { Cookie: this.headerCookie() } : {}),
      },
      body: corpo ? new URLSearchParams(corpo).toString() : undefined,
      redirect: "manual",
    });

    this.guardarCookies(res);

    const texto = await res.text();
    let dados: unknown;
    try {
      dados = JSON.parse(texto);
    } catch {
      // 403 com corpo "error" é o host recusando; HTML costuma ser sessão expirada.
      const bloqueado = res.status === 403 || texto.trim() === CORPO_BLOQUEIO;
      throw new ErroHost(
        `${url} respondeu ${bloqueado ? "bloqueio" : "não-JSON"} ` +
          `(HTTP ${res.status}): ${texto.slice(0, 80).trim()}`,
        bloqueado,
      );
    }

    if (this.opcoes.debug) {
      this.capturas.push({ url, status: res.status, corpo: dados });
    }
    return dados;
  }

  async login(): Promise<string> {
    // Se o chamador fixou um host, respeita. Senão, varre os candidatos.
    const candidatos = this.opcoes.base ? [this.opcoes.base] : HOSTS_PADRAO;
    const corpo = {
      userName: this.usuario,
      password: hashSenhaGrowatt(this.senha),
    };

    let dados: unknown;
    const recusas: string[] = [];

    for (const host of candidatos) {
      try {
        dados = await this.requisitar("/newTwoLoginAPI.do", corpo, host);
        this.base = host;
        break;
      } catch (erro) {
        if (erro instanceof ErroHost && erro.bloqueado) {
          recusas.push(erro.message);
          continue;
        }
        throw erro;
      }
    }

    if (dados === undefined) {
      throw new ErroColetor(
        "Nenhum host da Growatt aceitou a conexão. Todos bloquearam:\n  " +
          recusas.join("\n  ") +
          "\nSe isso persistir, a API de sessão foi cortada de novo e o caminho " +
          "passa a ser o token da OpenAPI v1 (OSS → System set → System management).",
        "growatt",
      );
    }

    const back = (dados as { back?: { success?: boolean; error?: string; user?: { id?: unknown } } })
      ?.back;
    if (!back?.success) {
      throw new ErroColetor(
        `Login recusado pela Growatt em ${this.base}: ` +
          `${back?.error ?? "sem detalhe na resposta"}`,
        "growatt",
      );
    }

    const id = back.user?.id;
    if (id === undefined || id === null) {
      throw new ErroColetor(
        "Login aceito mas a resposta não trouxe user.id — o formato mudou.",
        "growatt",
      );
    }

    this.userId = String(id);
    return this.userId;
  }

  private exigirSessao(): string {
    if (!this.userId) {
      throw new ErroColetor("Chame login() antes.", "growatt", true);
    }
    return this.userId;
  }

  /** Lista as usinas visíveis para a conta autenticada. */
  async listarUsinas(): Promise<unknown> {
    const id = this.exigirSessao();
    return this.requisitar(`/PlantListAPI.do?userId=${encodeURIComponent(id)}`);
  }

  /** Dispositivos de uma usina, paginado. */
  async listarDispositivos(plantId: string, pagina = 1): Promise<unknown> {
    this.exigirSessao();
    const q = new URLSearchParams({
      op: "getAllDeviceListTwo",
      plantId,
      pageNum: String(pagina),
      pageSize: "50",
    });
    return this.requisitar(`/newTwoPlantAPI.do?${q}`);
  }

  /**
   * Série de um dia da usina.
   * @param tipo 1 = dia, 2 = mês, 3 = ano
   */
  async detalheUsina(plantId: string, data: string, tipo = 1): Promise<unknown> {
    this.exigirSessao();
    const q = new URLSearchParams({ plantId, type: String(tipo), date: data });
    return this.requisitar(`/PlantDetailAPI.do?${q}`);
  }
}
