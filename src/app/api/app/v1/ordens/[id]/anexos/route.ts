import { exigirApp } from "@/app-movel/autenticacao";
import { ehUuid, falha, json, muitasTentativas } from "@/app-movel/http";
import { consumir, MINUTO } from "@/app-movel/limitador";
import { dataDoApp, idClienteDoApp, numeroDoApp, respostaDoErro } from "@/app-movel/os-api";
import { ordemDoUsuario } from "@/app-movel/ordens";
import { atorDoApp } from "@/os/acesso";
import { anexar, CATEGORIAS, type CategoriaAnexo } from "@/os/anexos";

export const dynamic = "force-dynamic";

/** 16 MB de corpo: a foto (até 15 MB) mais os campos do formulário. */
const CORPO_MAXIMO = 16 * 1024 * 1024;

/**
 * Uma foto (ou a assinatura) tirada no celular.
 *
 *   POST multipart: arquivo, idCliente, categoria (foto | assinatura),
 *                   itemId?, capturadoEm?, latitude?, longitude?
 *
 * Vai para o Drive, na pasta do cliente, e — se o item diz que a foto é um
 * documento do dossiê — entra também no dossiê da venda. O `idCliente` torna o
 * reenvio seguro: a mesma foto duas vezes vira uma só (`repetido: true`).
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const usuario = await exigirApp(req);
  if (usuario instanceof Response) return usuario;

  const limite = consumir(`os-anexo:${usuario.id}`, 300, 10 * MINUTO);
  if (!limite.ok) return muitasTentativas(limite.tenteEmSegundos);

  const { id } = await params;
  if (!ehUuid(id)) return falha(404, "nao_encontrado", "Ordem de serviço não encontrada.");

  if (Number(req.headers.get("content-length") ?? 0) > CORPO_MAXIMO) {
    return falha(413, "validacao", "A foto passou de 15 MB.");
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return falha(400, "requisicao_invalida", "Esperava um formulário multipart com o arquivo.");
  }

  const arquivo = form.get("arquivo");
  if (!(arquivo instanceof File) || arquivo.size === 0) {
    return falha(400, "validacao", "Falta o arquivo.");
  }
  const idCliente = idClienteDoApp(form.get("idCliente"));
  if (!idCliente) return falha(400, "validacao", "Falta o idCliente (UUID gerado no celular).");

  const categoria = String(form.get("categoria") ?? "foto");
  if (!(CATEGORIAS as readonly string[]).includes(categoria) || categoria === "documento") {
    return falha(400, "validacao", "Categoria deve ser foto ou assinatura.");
  }
  const itemId = String(form.get("itemId") ?? "") || null;
  if (itemId && !ehUuid(itemId)) return falha(400, "validacao", "Item inválido.");

  try {
    const r = await anexar(atorDoApp(usuario), id, {
      conteudo: new Uint8Array(await arquivo.arrayBuffer()),
      nomeOriginal: arquivo.name,
      categoria: categoria as CategoriaAnexo,
      itemId,
      capturadoEm: dataDoApp(form.get("capturadoEm")),
      latitude: numeroDoApp(form.get("latitude")),
      longitude: numeroDoApp(form.get("longitude")),
      idCliente,
    });
    const ordem = await ordemDoUsuario(usuario, id);
    return json({ anexo: { id: r.anexoId, repetido: r.repetido }, ordem }, r.repetido ? 200 : 201);
  } catch (e) {
    return respostaDoErro(e);
  }
}
