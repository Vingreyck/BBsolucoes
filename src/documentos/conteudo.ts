/**
 * O tipo de um documento pelo que ele é, e não pelo que o navegador declarou.
 *
 * O envio de documento conferia só o tipo que o navegador manda junto com o
 * arquivo — e esse tipo é escolhido por quem envia. Um `pagina.html` declarado
 * como PDF passava, ia para o Drive com o nome terminando em `.html`, e quem o
 * baixasse depois abriria uma página, não um papel. Aqui o que decide são os
 * primeiros bytes do arquivo (a "assinatura" de cada formato), e a extensão do
 * nome sai do tipo reconhecido, nunca do nome original.
 *
 * Sem banco nem Drive, para o `testar-regras.ts` conferir.
 */

export interface TipoDeDocumento {
  mime: string;
  /** Com o ponto: ".pdf". */
  extensao: string;
}

const PDF: TipoDeDocumento = { mime: "application/pdf", extensao: ".pdf" };
const JPEG: TipoDeDocumento = { mime: "image/jpeg", extensao: ".jpg" };
const PNG: TipoDeDocumento = { mime: "image/png", extensao: ".png" };
const WEBP: TipoDeDocumento = { mime: "image/webp", extensao: ".webp" };
const HEIC: TipoDeDocumento = { mime: "image/heic", extensao: ".heic" };
const DOCX: TipoDeDocumento = {
  mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  extensao: ".docx",
};
const XLSX: TipoDeDocumento = {
  mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  extensao: ".xlsx",
};
const DOC: TipoDeDocumento = { mime: "application/msword", extensao: ".doc" };
const XLS: TipoDeDocumento = { mime: "application/vnd.ms-excel", extensao: ".xls" };

/** As marcas de arquivo HEIC/HEIF que o iPhone e o Android gravam. */
const MARCAS_HEIC = new Set(["heic", "heix", "hevc", "hevx", "heim", "heis", "hevm", "hevs", "mif1", "msf1", "heif"]);

function ascii(b: Uint8Array, de: number, ate: number): string {
  return String.fromCharCode(...b.subarray(de, ate));
}

function comecaCom(b: Uint8Array, bytes: number[], em = 0): boolean {
  return bytes.every((v, i) => b[em + i] === v);
}

function contem(b: Uint8Array, texto: string): boolean {
  return Buffer.from(b.buffer, b.byteOffset, b.byteLength).includes(texto, 0, "latin1");
}

/**
 * Reconhece PDF, JPEG, PNG, WebP, HEIC e os documentos do Office (novos e
 * antigos). Qualquer outra coisa — HTML, SVG, executável, ZIP comum — é `null`.
 *
 * `dica` é o tipo declarado ou o nome original: só desempata o Office antigo,
 * em que `.doc` e `.xls` têm a mesma assinatura.
 */
export function tipoDoDocumento(conteudo: Uint8Array, dica = ""): TipoDeDocumento | null {
  const b = conteudo;
  if (b.byteLength < 12) return null;

  // O PDF pode ter lixo antes do cabeçalho; os leitores aceitam até 1 KB.
  if (ascii(b, 0, Math.min(b.byteLength, 1024)).includes("%PDF-")) return PDF;
  if (comecaCom(b, [0xff, 0xd8, 0xff])) return JPEG;
  if (comecaCom(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return PNG;
  if (ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 12) === "WEBP") return WEBP;
  if (ascii(b, 4, 8) === "ftyp" && MARCAS_HEIC.has(ascii(b, 8, 12))) return HEIC;

  // Office novo é um ZIP com pastas de nome fixo. ZIP sem elas não é documento.
  if (comecaCom(b, [0x50, 0x4b, 0x03, 0x04])) {
    if (contem(b, "word/document")) return DOCX;
    if (contem(b, "xl/workbook")) return XLSX;
    return null;
  }

  // Office antigo (97–2003): mesma assinatura para Word e Excel.
  if (comecaCom(b, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) {
    return /excel|\.xls$/i.test(dica) ? XLS : DOC;
  }

  return null;
}
