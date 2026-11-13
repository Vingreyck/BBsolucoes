import { eq } from "drizzle-orm";
import { Building2, Check, ImageIcon } from "lucide-react";
import { redirect } from "next/navigation";

import { exigirUsuario } from "@/auth/sessao";
import { db, schema } from "@/db";
import { formatarCnpj } from "@/projeto/contrato";

import { Cabecalho, Cartao } from "../../_ui";
import { salvarEmpresa } from "./actions";

export const dynamic = "force-dynamic";

const ERROS: Record<string, string> = {
  nome: "Escreva o nome da empresa.",
  cnpj: "O CNPJ precisa ter 14 dígitos.",
  "logo-grande": "O logo passou de 1 MB. Exporte uma versão menor (PNG ou JPEG).",
  "logo-tipo": "O logo precisa ser PNG ou JPEG.",
};

/**
 * Dados da empresa: o que o contrato traz da contratada.
 *
 * Só o adm mexe. O contrato não é gerado enquanto faltar razão social, CNPJ,
 * endereço ou e-mail; o logo é opcional (sem ele, o topo leva o nome).
 */
export default async function DadosDaEmpresa({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; erro?: string }>;
}) {
  const usuario = await exigirUsuario();
  if (usuario.papel !== "adm") redirect("/sem-acesso");
  const { ok, erro } = await searchParams;

  const empresa = await db.query.empresa.findFirst({
    where: eq(schema.empresa.id, usuario.empresaId),
    columns: { nome: true, razaoSocial: true, cnpj: true, endereco: true, email: true, logo: true },
  });
  if (!empresa) redirect("/");

  return (
    <main>
      <Cabecalho
        titulo="Dados da empresa"
        meta="O que sai no contrato como CONTRATADO(A): razão social, CNPJ, sede, e-mail e o logo do cabeçalho."
      />

      {ok && (
        <p className="aviso ok" role="status">
          Dados salvos. Os próximos contratos já saem com eles.
        </p>
      )}
      {erro && (
        <p className="aviso erro" role="alert">
          {ERROS[erro] ?? "Não consegui salvar."}
        </p>
      )}

      <form action={salvarEmpresa} className="pagina-estreita">
        <Cartao
          titulo="Empresa"
          icone={<Building2 size={16} />}
          ajuda="Contratos já gerados não mudam: eles guardam os dados do dia em que foram feitos. Para corrigir um, gere de novo na esteira."
        >
          <div className="form-ficha">
            <div className="dupla">
              <label>
                Nome (fantasia) <span className="req">*</span>
                <input name="nome" required defaultValue={empresa.nome} placeholder="BB Soluções Energia Solar" />
              </label>
              <label>
                Razão social
                <input name="razaoSocial" defaultValue={empresa.razaoSocial ?? ""} placeholder="Como está no cartão do CNPJ" />
              </label>
              <label>
                CNPJ
                <input
                  name="cnpj"
                  inputMode="numeric"
                  defaultValue={empresa.cnpj ? formatarCnpj(empresa.cnpj) : ""}
                  placeholder="00.000.000/0000-00"
                />
              </label>
            </div>
            <label>
              Endereço da sede
              <input
                name="endereco"
                defaultValue={empresa.endereco ?? ""}
                placeholder="Av. ..., nº ..., bairro, cidade - UF, CEP 00000-000"
              />
              <small className="entrada-ajuda">Numa linha só: sai no contrato e no rodapé de cada página.</small>
            </label>
            <label>
              E-mail
              <input name="email" type="email" defaultValue={empresa.email ?? ""} placeholder="contato@empresa.com.br" />
            </label>
          </div>
        </Cartao>

        <Cartao
          titulo="Logo"
          icone={<ImageIcon size={16} />}
          ajuda="Vai no topo de cada página do contrato e, bem clarinho, no meio da página."
        >
          <div className="form-ficha">
            {empresa.logo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={empresa.logo} alt="Logo atual" className="logo-empresa" />
            ) : (
              <p className="nota">Sem logo: o topo do contrato leva o nome da empresa.</p>
            )}
            <label>
              {empresa.logo ? "Trocar o logo" : "Enviar o logo"} <span className="fraco">(PNG ou JPEG, até 1 MB)</span>
              <input name="logo" type="file" accept="image/png,image/jpeg" />
            </label>
            {empresa.logo && (
              <label className="marcar">
                <input type="checkbox" name="tirarLogo" value="sim" /> Tirar o logo
              </label>
            )}
          </div>
        </Cartao>

        <div className="barra-enviar">
          <button type="submit" className="botao">
            <Check size={15} aria-hidden /> Salvar
          </button>
        </div>
      </form>
    </main>
  );
}
