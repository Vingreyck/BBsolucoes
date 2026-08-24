import path from "node:path";

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * Existe um package-lock.json solto em C:\Users\Vinicius, e sem isto o Next
   * elege aquela pasta como raiz do workspace e rastreia arquivo demais.
   */
  outputFileTracingRoot: path.join(__dirname),
};

export default nextConfig;
