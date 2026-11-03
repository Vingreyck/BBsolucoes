import { readFileSync } from "node:fs";
import { join } from "node:path";

import { exigirGestaoWeb } from "@/os/acesso";

export const dynamic = "force-dynamic";

/** A última tela que o robô da Energisa viu — para entender um erro sem entrar na VM. */
export async function GET() {
  await exigirGestaoWeb();
  try {
    const png = readFileSync(join(process.env.ENERGISA_PASTA || "estado/energisa", "tela.png"));
    return new Response(new Uint8Array(png), { headers: { "content-type": "image/png", "cache-control": "no-store" } });
  } catch {
    return new Response("O robô ainda não guardou nenhuma tela.", { status: 404 });
  }
}
