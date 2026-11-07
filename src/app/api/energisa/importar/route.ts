import { NextResponse, type NextRequest } from "next/server";

import { registrarLista, registrarPortalDeslogado, registrarSemMudanca } from "@/energisa/importar";
import { atorDaWebOuNulo } from "@/os/acesso";

export const dynamic = "force-dynamic";

/**
 * Onde a extensão "Selebi — Energisa" (pasta `extensao/`) entrega a lista do
 * portal, a cada 30 minutos, com o cookie do Selebi do próprio Chrome.
 *
 * Sem CORS de propósito: a extensão tem permissão de host para o Selebi e não
 * passa pelo CORS. O cabeçalho `X-Selebi-Extensao` é a trava contra outro
 * site postando aqui com o cookie de quem está logado — página nenhuma
 * consegue mandar cabeçalho próprio para outra origem sem o CORS liberar.
 */
export async function POST(req: NextRequest) {
  if (!req.headers.get("x-selebi-extensao")) {
    return NextResponse.json({ ok: false, erro: "Só a extensão do Selebi envia aqui." }, { status: 400 });
  }
  const ator = await atorDaWebOuNulo();
  if (!ator) return NextResponse.json({ ok: false, erro: "Entre no Selebi neste Chrome." }, { status: 401 });
  if (!ator.gestao) return NextResponse.json({ ok: false, erro: "Este usuário não é da gestão." }, { status: 403 });

  let corpo: { lista?: unknown; estado?: unknown; total?: unknown };
  try {
    corpo = await req.json();
  } catch {
    return NextResponse.json({ ok: false, erro: "O corpo não é JSON." }, { status: 400 });
  }

  if (corpo.estado === "portal_deslogado") {
    await registrarPortalDeslogado(ator);
    return NextResponse.json({ ok: true, texto: "anotado" });
  }
  if (corpo.estado === "sem_mudanca") {
    return NextResponse.json(await registrarSemMudanca(ator, corpo.total));
  }
  const resultado = await registrarLista(ator, corpo.lista, "extensao");
  return NextResponse.json(resultado, { status: resultado.ok ? 200 : 400 });
}
