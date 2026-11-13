"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { exigirUsuario } from "@/auth/sessao";
import { db, schema } from "@/db";
import { tipoDoDocumento } from "@/documentos/conteudo";

/** 1 MB: o logo vai dentro de cada contrato, e PNG de logo fica bem abaixo disso. */
const LOGO_MAXIMO = 1024 * 1024;

function texto(d: FormData, campo: string, max = 300): string | null {
  const v = String(d.get(campo) ?? "").trim().slice(0, max);
  return v || null;
}

/**
 * Os dados da empresa que saem no contrato: razão social, CNPJ, endereço,
 * e-mail e logo. Ficam no banco, e não no código, porque o repositório é
 * público e o sistema serve a mais de uma empresa.
 */
export async function salvarEmpresa(dados: FormData): Promise<void> {
  const usuario = await exigirUsuario();
  if (usuario.papel !== "adm") redirect("/sem-acesso");

  const nome = texto(dados, "nome", 120);
  if (!nome) redirect("/administracao/empresa?erro=nome");
  const cnpj = (texto(dados, "cnpj") ?? "").replace(/\D/g, "");
  if (cnpj && cnpj.length !== 14) redirect("/administracao/empresa?erro=cnpj");

  const mudar: Partial<typeof schema.empresa.$inferInsert> = {
    nome,
    razaoSocial: texto(dados, "razaoSocial", 200),
    cnpj: cnpj || null,
    endereco: texto(dados, "endereco", 400),
    email: texto(dados, "email", 200),
  };

  const arquivo = dados.get("logo");
  if (arquivo instanceof File && arquivo.size > 0) {
    if (arquivo.size > LOGO_MAXIMO) redirect("/administracao/empresa?erro=logo-grande");
    const conteudo = new Uint8Array(await arquivo.arrayBuffer());
    // O conteúdo diz o que o arquivo é, não o nome: só PNG e JPEG, que o PDF lê.
    const real = tipoDoDocumento(conteudo, arquivo.name);
    if (!real || !["image/png", "image/jpeg"].includes(real.mime)) redirect("/administracao/empresa?erro=logo-tipo");
    mudar.logo = `data:${real.mime};base64,${Buffer.from(conteudo).toString("base64")}`;
  }
  if (dados.get("tirarLogo") === "sim") mudar.logo = null;

  await db.update(schema.empresa).set(mudar).where(eq(schema.empresa.id, usuario.empresaId));
  revalidatePath("/administracao/empresa");
  redirect("/administracao/empresa?ok=1");
}
