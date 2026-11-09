/**
 * O símbolo do Selebi: um sol dourado com três arcos cobre girando em volta.
 *
 * Duas versões, como nas marcas profissionais: a normal e a de tamanho pequeno
 * (até 32 px), com arcos mais grossos e sol maior — sem isso o símbolo vira
 * uma mancha na aba do navegador. As mesmas formas estão em `app/icon.svg` e
 * no menu recolhido (`globals.css`); mudou aqui, muda lá.
 */
export const COR_SOL = "#FFC247";
export const COR_ARCO = "#C9561A";

const NORMAL = { arco: "M50 21 A14.5 14.5 0 0 0 36.23 40.03", traco: 10, sol: 8, recorte: "14 14 72 72" };
const PEQUENO = { arco: "M50 20 A15 15 0 0 0 35.18 37.33", traco: 13, sol: 9.5, recorte: "12 12 76 76" };

export function SimboloSelebi({ tamanho = 28, className }: { tamanho?: number; className?: string }) {
  const v = tamanho <= 32 ? PEQUENO : NORMAL;
  return (
    <svg width={tamanho} height={tamanho} viewBox={v.recorte} className={className} aria-hidden focusable="false">
      <g fill="none" stroke={COR_ARCO} strokeWidth={v.traco} strokeLinecap="round">
        <path d={v.arco} />
        <path d={v.arco} transform="rotate(120 50 50)" />
        <path d={v.arco} transform="rotate(240 50 50)" />
      </g>
      <circle cx="50" cy="50" r={v.sol} fill={COR_SOL} />
    </svg>
  );
}

/**
 * A marca grande e apagada no fundo das telas de entrada: os mesmos três arcos,
 * mais finos, girando devagar em volta de um sol com brilho, e duas órbitas de
 * linha fina. É decoração: o leitor de tela não a vê, e quem pediu menos
 * movimento no sistema a vê parada (`globals.css`).
 */
export function OrbitaDecorativa({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 100" className={className} aria-hidden focusable="false">
      <defs>
        <radialGradient id="orbita-brilho">
          <stop offset="0%" stopColor={COR_SOL} stopOpacity="0.55" />
          <stop offset="45%" stopColor={COR_SOL} stopOpacity="0.14" />
          <stop offset="100%" stopColor={COR_SOL} stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx="50" cy="50" r="48" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="0.25" />
      <circle cx="50" cy="50" r="39" fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="0.25" strokeDasharray="0.5 1.5" />
      <circle cx="50" cy="50" r="30" fill="url(#orbita-brilho)" />
      <g className="orbita-arcos" fill="none" stroke={COR_ARCO} strokeOpacity="0.75" strokeWidth={4} strokeLinecap="round">
        <path d={NORMAL.arco} />
        <path d={NORMAL.arco} transform="rotate(120 50 50)" />
        <path d={NORMAL.arco} transform="rotate(240 50 50)" />
      </g>
      <circle cx="50" cy="50" r={NORMAL.sol * 0.8} fill={COR_SOL} />
    </svg>
  );
}
