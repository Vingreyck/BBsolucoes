/**
 * O tipo de um arquivo pelo que ele é, e não pelo que o celular declarou.
 * Num arquivo à parte, sem banco nem Drive, para o `testar-regras.ts` conferir.
 */

/** 50 MB para o vídeo — o app grava até 30 s em qualidade média, uns 10 a 25 MB. */
export const TAMANHO_MAXIMO_VIDEO = 50 * 1024 * 1024;

export type TipoReal = "image/jpeg" | "image/png" | "application/pdf" | "video/mp4" | "video/quicktime";

/**
 * O tipo pelo conteúdo, não pelo que o celular declarou. JPEG e PNG são o que
 * o relatório em PDF sabe desenhar; PDF só como documento. Vídeo é MP4 (Android)
 * ou QuickTime/MOV (iPhone): os dois começam com uma caixa `ftyp` no byte 4, e o
 * que a marca diz é qual dos dois é.
 */
export function tipoReal(conteudo: Uint8Array): TipoReal | null {
  const b = conteudo;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return "application/pdf";
  if (b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) {
    const marca = String.fromCharCode(b[8], b[9], b[10], b[11]);
    return marca === "qt  " ? "video/quicktime" : "video/mp4";
  }
  return null;
}

export const EXTENSAO: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "application/pdf": ".pdf",
  "video/mp4": ".mp4",
  "video/quicktime": ".mov",
};
