import path from "node:path";

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * Existe um package-lock.json solto em C:\Users\Vinicius, e sem isto o Next
   * elege aquela pasta como raiz do workspace e rastreia arquivo demais.
   */
  outputFileTracingRoot: path.join(__dirname),

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
