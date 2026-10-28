import path from "node:path";

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * Existe um package-lock.json solto em C:\Users\Vinicius, e sem isto o Next
   * elege aquela pasta como raiz do workspace e rastreia arquivo demais.
   */
  outputFileTracingRoot: path.join(__dirname),

  /**
   * A biblioteca do relatório em PDF carrega fontes e o motor de layout em
   * WebAssembly por conta própria. Empacotada pelo Next, ela perde esses
   * arquivos e quebra só em produção; fora do pacote, o Node a carrega como
   * qualquer dependência.
   */
  serverExternalPackages: ["@react-pdf/renderer"],

  /**
   * Quem comprime é o Caddy, na frente. Comprimir aqui também seria trabalho
   * dobrado e seguraria o fluxo ao vivo do mapa "Em campo" (SSE) num buffer.
   */
  compress: false,

  /**
   * O otimizador de imagens do Next (`/_next/image`) desligado.
   *
   * O site não usa o componente `next/image`, então ele não tem serventia aqui,
   * e foi nele que apareceram as falhas críticas de 2026 (execução de código
   * pela biblioteca de imagem `sharp`, GHSA-2464-fhr4-w9xw e GHSA-2xp9-vwfh-vxw4).
   * Desligado, a rota responde 404 e a biblioteca nunca recebe um arquivo de
   * fora. A versão corrigida do `sharp` vem forçada no `package.json`
   * (`overrides`) do mesmo jeito, para o caso de um dia isto ser religado.
   */
  images: { unoptimized: true },

  experimental: {
    serverActions: {
      /**
       * O padrão do Next é 1 MB, e não serve aqui: há memoriais escaneados de
       * 30 MB no Drive da BB. Sem isto, subir um documento grande falharia com
       * "Body exceeded 1 MB limit" — erro que não diz nada a quem está só
       * tentando anexar uma ART. O limite de verdade fica em
       * `src/app/documentos/actions.ts`, que recusa com uma frase legível.
       */
      bodySizeLimit: "64mb",
    },
  },
};

export default nextConfig;
