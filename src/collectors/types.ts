/**
 * Contrato comum a todo coletor de portal.
 *
 * Cada fabricante fala um dialeto diferente — a Growatt devolve form-encoded de
 * uma API de sessão, a Solis exige HMAC-SHA1 numa porta esquisita, a FoxESS
 * assina com MD5. Nada disso pode vazar para o resto do sistema: quem consome
 * um coletor só enxerga `UsinaRemota` e `EquipamentoRemoto`.
 */

export type Fabricante =
  | "growatt"
  | "hoymiles"
  | "solis"
  | "foxess"
  | "huawei"
  | "solarportal_plus"
  | "nep"
  | "outro";

export interface UsinaRemota {
  /** id da usina no portal de origem — vira `vinculo_portal.id_externo` */
  idExterno: string;
  nome: string;
  potenciaKwp?: number;
  cidade?: string;
  dataInstalacao?: Date;
  /** status como o portal reporta, sem normalizar */
  statusBruto?: string;
  energiaTotalKwh?: number;
  energiaDiaKwh?: number;
  potenciaAtualW?: number;
  /** resposta crua, para gravar em `leitura_bruta` */
  bruto: unknown;
}

export interface EquipamentoRemoto {
  idExterno: string;
  numeroSerie?: string;
  tipo?: string;
  modelo?: string;
  statusBruto?: string;
  potenciaAtualW?: number;
  energiaDiaKwh?: number;
  energiaTotalKwh?: number;
  bruto: unknown;
}

export interface Coletor {
  readonly fabricante: Fabricante;
  /**
   * Cadência mínima aceitável em minutos. Não é preferência: é o teto que o
   * fabricante impõe. A Huawei, por exemplo, libera cerca de 25 chamadas no dia
   * inteiro — ver `conta_portal.cadencia_minutos`.
   */
  readonly cadenciaMinimaMin: number;

  autenticar(): Promise<void>;
  listarUsinas(): Promise<UsinaRemota[]>;
  listarEquipamentos(idExternoUsina: string): Promise<EquipamentoRemoto[]>;
}

/** Erro de coletor que já veio classificado, para o runner decidir se repete. */
export class ErroColetor extends Error {
  constructor(
    message: string,
    readonly fabricante: Fabricante,
    readonly reautenticar = false,
  ) {
    super(message);
    this.name = "ErroColetor";
  }
}
