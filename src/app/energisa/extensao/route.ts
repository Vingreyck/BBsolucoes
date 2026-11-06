import { zipDaExtensao } from "@/energisa/extensao";
import { atorDaWebOuNulo } from "@/os/acesso";

export const dynamic = "force-dynamic";

export async function GET() {
  const ator = await atorDaWebOuNulo();
  if (!ator?.gestao) return new Response("Só a gestão baixa a extensão.", { status: 403 });
  const zip = await zipDaExtensao();
  return new Response(new Uint8Array(zip), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": 'attachment; filename="selebi-energisa.zip"',
      "Cache-Control": "no-store",
    },
  });
}
