import qrcode from "qrcode-generator";

/**
 * O QR do aplicativo autenticador, desenhado no servidor como SVG.
 *
 * Nada de imagem de serviço de fora: o segredo é a chave do segundo fator, e
 * mandar o endereço `otpauth://` para um site gerador de QR entregaria a chave a
 * ele. Aqui ele nasce e fica no próprio HTML da resposta.
 *
 * Preto sobre branco com a margem de 4 módulos, mesmo no tema escuro: o leitor
 * da câmera precisa de contraste de verdade.
 */
export function CodigoQr({ conteudo, rotulo }: { conteudo: string; rotulo: string }) {
  const qr = qrcode(0, "M");
  qr.addData(conteudo);
  qr.make();
  const n = qr.getModuleCount();

  let caminho = "";
  for (let linha = 0; linha < n; linha++) {
    for (let coluna = 0; coluna < n; coluna++) {
      if (qr.isDark(linha, coluna)) caminho += `M${coluna},${linha}h1v1h-1z`;
    }
  }
  const margem = 4;
  return (
    <svg
      className="mfa-qr"
      viewBox={`${-margem} ${-margem} ${n + margem * 2} ${n + margem * 2}`}
      shapeRendering="crispEdges"
      role="img"
      aria-label={rotulo}
    >
      <rect x={-margem} y={-margem} width={n + margem * 2} height={n + margem * 2} fill="#ffffff" />
      <path d={caminho} fill="#000000" />
    </svg>
  );
}
