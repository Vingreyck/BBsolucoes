/**
 * Classificação dos eventos da Growatt.
 *
 * A taxonomia não é invenção nossa: o próprio manual de troubleshooting da
 * Growatt separa os eventos em duas partes, e essa divisão é exatamente o que
 * decide se alguém precisa pegar a estrada ou não.
 *
 *   Part I  — System fault: condição de rede ou de ambiente (tensão fora de
 *             faixa, frequência, falta de AC, isolação, temperatura). Some
 *             sozinho quando a causa passa.
 *   Part II — Inverter fault: os "Error: 1xx". Falha de hardware. O manual
 *             manda reiniciar, e persistindo, trocar a placa de controle ou o
 *             inversor. Não some sozinho.
 *
 * Uma frase do manual vale para os dois casos e muda como o alerta deve ser
 * escrito: "All faults will shut down the inverter immediately and wait until
 * the fault is cleared." Ou seja, qualquer falha significa geração parada — o
 * que muda entre as duas categorias é se é preciso ir até lá.
 *
 * Fontes: manual de troubleshooting Growatt TL&MTL (Ver 1.3) e as listas
 * públicas de código das séries mais novas. Ver SETUP.md.
 */

export type Severidade = "info" | "atencao" | "critico";

export interface Classificacao {
  severidade: Severidade;
  /** Rótulo em português para exibir na tela. */
  rotulo: string;
  /** Se true, não adianta esperar: alguém precisa ir até a usina. */
  exigeVisita: boolean;
}

/**
 * Falhas de hardware do inversor. O manual manda reiniciar e, persistindo,
 * trocar placa de controle ou inversor — ou seja, visita técnica.
 */
const HARDWARE: Record<string, string> = {
  "100": "Tensão de referência interna",
  "101": "Comunicação entre as duas CPUs",
  "102": "Amostragem inconsistente entre as CPUs",
  "116": "Falha de leitura ou escrita da EEPROM",
  "117": "Circuito de relé",
  "118": "Falha ao inicializar o modelo do inversor",
  "119": "Falha do GFCI (corrente de fuga)",
  "120": "Falha interna do inversor",
  "121": "Comunicação entre processadores",
  "122": "Tensão de barramento",
  "05": "Sobretensão no lado CC",
};

/**
 * Condições de rede e de ambiente. O inversor para enquanto durarem, mas
 * voltam sozinhas — mandar técnico numa dessas é viagem perdida.
 *
 * Chegam como texto na descrição do evento, não como código, então a
 * identificação é por padrão. As variantes em inglês são as que o portal usa;
 * as em português aparecem quando a conta está com idioma trocado.
 */
const REDE: { padrao: RegExp; rotulo: string }[] = [
  { padrao: /ac\s*v\s*outrange|grid\s*volt|tens[ãa]o\s*da\s*rede/i, rotulo: "Tensão da rede fora da faixa" },
  { padrao: /ac\s*f\s*outrange|frequen|frequ[êe]ncia/i, rotulo: "Frequência da rede fora da faixa" },
  { padrao: /no\s*ac\s*connect|grid\s*loss|sem\s*rede/i, rotulo: "Sem conexão com a rede" },
  { padrao: /residual\s*i|gfci|corrente\s*residual/i, rotulo: "Corrente residual alta" },
  { padrao: /pv\s*isolation|isola[çc]/i, rotulo: "Isolação do arranjo baixa" },
  { padrao: /output\s*high\s*dci|dci/i, rotulo: "Componente CC na saída alta" },
  { padrao: /over\s*temp|temperatura/i, rotulo: "Sobretemperatura" },
  { padrao: /auto\s*test/i, rotulo: "Autoteste não passou" },
  { padrao: /pv\s*volt|dc\s*volt|sobretens/i, rotulo: "Tensão do arranjo fora da faixa" },
];

/**
 * Códigos 3xx das séries novas: são condição de rede, não hardware.
 *
 * O Fault Log da BB traz `EventID 300` com a descrição vazia (`---`), então
 * sem esta tabela o evento cairia como "info" e passaria despercebido. Quando o
 * portal não descreve, o código é a única informação disponível.
 */
const REDE_POR_CODIGO: Record<string, string> = {
  "300": "Tensão da rede fora da faixa",
  "301": "Tensão da rede fora da faixa",
  "302": "Sem conexão com a rede",
  "303": "Falha de aterramento",
  "304": "Frequência da rede fora da faixa",
};

/** Perda de comunicação: não é falha do inversor, mas cega o monitoramento. */
const COMUNICACAO = /offline|lost|disconnect|sem\s*comunica|communication/i;

/**
 * Classifica um evento pelo código e pela descrição que a Growatt exporta.
 *
 * O código tem prioridade sobre o texto: "Error: 117" é falha de relé mesmo que
 * a descrição venha genérica.
 */
export function classificarEvento(
  codigo: string | null | undefined,
  descricao: string | null | undefined,
): Classificacao {
  const texto = (descricao ?? "").trim();

  // O código pode vir como "117", "Error: 117" ou "error117".
  const numero = String(codigo ?? "").match(/(\d{2,3})/)?.[1];
  const doTexto = texto.match(/error[:\s]*(\d{2,3})/i)?.[1];
  const chave = numero && HARDWARE[numero] ? numero : doTexto && HARDWARE[doTexto] ? doTexto : null;

  if (chave) {
    return { severidade: "critico", rotulo: HARDWARE[chave], exigeVisita: true };
  }

  const codigoRede = numero && REDE_POR_CODIGO[numero] ? numero : null;
  if (codigoRede) {
    return {
      severidade: "atencao",
      rotulo: REDE_POR_CODIGO[codigoRede],
      exigeVisita: false,
    };
  }

  for (const { padrao, rotulo } of REDE) {
    if (padrao.test(texto)) {
      return { severidade: "atencao", rotulo, exigeVisita: false };
    }
  }

  if (COMUNICACAO.test(texto)) {
    return {
      severidade: "atencao",
      rotulo: "Sem comunicação com o portal",
      exigeVisita: false,
    };
  }

  // Código 1xx desconhecido ainda é falha de inversor: a família toda é hardware.
  if (numero && /^1\d\d$/.test(numero)) {
    return {
      severidade: "critico",
      rotulo: `Falha de inversor (código ${numero})`,
      exigeVisita: true,
    };
  }

  return { severidade: "info", rotulo: texto || "Evento sem descrição", exigeVisita: false };
}
