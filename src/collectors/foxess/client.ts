import { createHash } from "node:crypto";

import { ErroColetor } from "../types";

/**
 * Cliente da Open API da FoxESS.
 *
 * Diferente da Growatt, aqui a chave é estática e permanente, gerada pelo
 * próprio usuário no FoxCloud OpenPlatform. Não há aprovação nem token que
 * expira.
 *
 * A pegadinha está na assinatura. Cada requisição leva três cabeçalhos
 * calculados na hora — `token`, `timestamp` e `signature` — e a assinatura é
 * MD5 de `caminho + separador + token + separador + timestamp`.
 *
 * O separador é a **sequência literal de quatro caracteres** `\r\n`, e não os
 * caracteres de controle CR LF. A documentação da FoxESS é explícita:
 *
 *   "The separator is the 4-character string \r\n, NOT an actual carriage
 *    return or line feed character. Do not use your programming language's
 *    newline escape sequence."
 *
 * É o erro número um de quem integra com eles, e devolve 401 sem explicação.
 * O separador fica configurável só porque há relato de contas que se comportam
 * ao contrário — o probe testa os dois e diz qual funciona.
 */

const BASE_PADRAO = "https://www.foxesscloud.com";

/** Os quatro caracteres literais, como a documentação exige. */
export const SEPARADOR_LITERAL = "\\r\\n";
/** Os caracteres de controle de verdade, para o caso de a conta exigir. */
export const SEPARADOR_CONTROLE = "\r\n";

export interface RespostaFox<T = unknown> {
  errno: number;
  msg?: string;
  result?: T;
}

/** Erros de negócio que a FoxESS devolve com HTTP 200. */
const ERROS: Record<number, string> = {
  40257: "parâmetro inválido",
  40404: "estourou a cota diária ou a frequência",
  41201: "erro interno da FoxESS",
  41808: "token expirado ou malformado",
  41811: "token sem permissão para este recurso",
  41930: "número de série não existe",
};

export class FoxEssClient {
  constructor(
    private readonly chave: string,
    private readonly opcoes: { base?: string; separador?: string } = {},
  ) {}

  private get base(): string {
    return this.opcoes.base ?? BASE_PADRAO;
  }

  private get separador(): string {
    return this.opcoes.separador ?? SEPARADOR_LITERAL;
  }

  private assinar(caminho: string, timestamp: string): string {
    return createHash("md5")
      .update(caminho + this.separador + this.chave + this.separador + timestamp)
      .digest("hex")
      .toLowerCase();
  }

  /**
   * Uma chamada. `caminho` começa com barra e é exatamente o que entra na
   * assinatura — usar a URL completa aqui quebra tudo.
   */
  async chamar<T>(
    caminho: string,
    corpo?: Record<string, unknown>,
  ): Promise<RespostaFox<T>> {
    const timestamp = Date.now().toString();
    const res = await fetch(`${this.base}${caminho}`, {
      method: corpo ? "POST" : "GET",
      headers: {
        token: this.chave,
        timestamp,
        signature: this.assinar(caminho, timestamp),
        lang: "en",
        ...(corpo ? { "Content-Type": "application/json" } : {}),
      },
      body: corpo ? JSON.stringify(corpo) : undefined,
    });

    if (res.status === 401) {
      throw new ErroColetor(
        "FoxESS recusou a autenticação (HTTP 401). Chave errada, ou o " +
          "separador da assinatura é o outro — rode `npm run probe:foxess`.",
        "foxess",
        true,
      );
    }

    const texto = await res.text();
    let dados: RespostaFox<T>;
    try {
      dados = JSON.parse(texto) as RespostaFox<T>;
    } catch {
      throw new ErroColetor(
        `FoxESS respondeu não-JSON em ${caminho} (HTTP ${res.status}): ` +
          texto.slice(0, 100),
        "foxess",
      );
    }

    if (dados.errno !== 0) {
      throw new ErroColetor(
        `FoxESS recusou ${caminho}: errno ${dados.errno} — ` +
          (ERROS[dados.errno] ?? dados.msg ?? "sem detalhe"),
        "foxess",
        dados.errno === 41808,
      );
    }

    return dados;
  }

  /**
   * `pageSize` tem mínimo de 10 — descoberto testando, porque a FoxESS não
   * documenta isso em lugar nenhum. Pedir menos devolve `40257 parâmetro
   * inválido`, sem dizer qual parâmetro nem que existe um mínimo.
   */
  private static readonly PAGINA_MINIMA = 10;

  listarUsinas(pagina = 1, porPagina = 100) {
    return this.chamar<{ data?: unknown[]; total?: number }>("/op/v0/plant/list", {
      currentPage: pagina,
      pageSize: Math.max(porPagina, FoxEssClient.PAGINA_MINIMA),
    });
  }

  listarDispositivos(pagina = 1, porPagina = 100) {
    return this.chamar<{ data?: unknown[]; total?: number }>("/op/v0/device/list", {
      currentPage: pagina,
      pageSize: Math.max(porPagina, FoxEssClient.PAGINA_MINIMA),
    });
  }

  /** Leitura do momento. `sns` no plural, em array — até 50 por chamada. */
  dadosAgora(series: string[]) {
    return this.chamar<unknown[]>("/op/v1/device/real/query", {
      sns: series.slice(0, 50),
      variables: [],
    });
  }
}
