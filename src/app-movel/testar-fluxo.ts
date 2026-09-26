import "dotenv/config";

import { randomInt } from "node:crypto";

import { eq, inArray } from "drizzle-orm";

import { db, schema } from "@/db";

/**
 * Percorre a API do app de ponta a ponta, contra o servidor rodando.
 *
 *   npm run dev            (num terminal)
 *   TESTE_CODIGO=<código da empresa> npm run testar:app
 *
 * Cria dois cadastros de teste com CPFs sorteados, passa por aprovação, login,
 * OS, equipe, senha provisória e desativação — e apaga os dois no fim, mesmo
 * se algum passo falhar. O código da empresa vem do ambiente porque o
 * repositório é público.
 */

const BASE = (process.env.TESTE_BASE ?? "http://localhost:3000") + "/api/app/v1";
const CODIGO = process.env.TESTE_CODIGO ?? "";

// Cada rodada finge vir de um IP diferente, para não esbarrar no freio de
// tentativas das rodadas anteriores. Só funciona em desenvolvimento: em
// produção o Caddy sobrescreve este cabeçalho com o IP real.
const IP = `10.${randomInt(255)}.${randomInt(255)}.${randomInt(255)}`;

function cpfSorteado(): string {
  const base = Array.from({ length: 9 }, () => randomInt(10));
  const dv = (d: number[], peso: number) => {
    const resto = (d.reduce((s, n, i) => s + n * (peso - i), 0) * 10) % 11;
    return resto === 10 ? 0 : resto;
  };
  const d1 = dv(base, 10);
  const d2 = dv([...base, d1], 11);
  return [...base, d1, d2].join("");
}

let passos = 0;
function confere(condicao: unknown, descricao: string, detalhe?: unknown): void {
  passos++;
  if (!condicao) {
    console.error(`✗ ${descricao}`);
    if (detalhe !== undefined) console.error("  ", JSON.stringify(detalhe));
    throw new Error(`falhou: ${descricao}`);
  }
  console.log(`✓ ${descricao}`);
}

async function chamar(
  metodo: string,
  caminho: string,
  corpo?: unknown,
  token?: string,
): Promise<{ status: number; dados: Record<string, any> }> {
  const resposta = await fetch(BASE + caminho, {
    method: metodo,
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": IP,
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
    redirect: "manual",
  });
  const texto = await resposta.text();
  let dados: Record<string, any> = {};
  try {
    dados = texto ? JSON.parse(texto) : {};
  } catch {
    dados = { naoJson: texto.slice(0, 120) };
  }
  return { status: resposta.status, dados };
}

async function main() {
  if (!CODIGO) {
    console.error("Defina TESTE_CODIGO com o código da empresa.");
    process.exit(1);
  }

  const cpfAdm = cpfSorteado();
  const cpfTec = cpfSorteado();
  const senhaAdm = `teste-adm-${randomInt(1e6)}`;
  const senhaTec = `teste-tec-${randomInt(1e6)}`;

  try {
    // --- A porta do app não é a do navegador ---
    let r = await chamar("GET", "/eu");
    confere(r.status === 401 && r.dados.erro === "nao_autenticado", "sem token: 401 em JSON, sem redirecionar para o login web", r);

    // --- Código da empresa ---
    r = await chamar("POST", "/empresa", { codigo: "nao-existe-mesmo" });
    confere(r.status === 404 && r.dados.erro === "codigo_invalido", "código errado: 404 codigo_invalido", r);

    r = await chamar("POST", "/empresa", { codigo: `  ${CODIGO.toUpperCase()} ` });
    confere(r.status === 200 && r.dados.id && r.dados.nome, "código com maiúscula e espaço: acha a empresa", r);
    const empresaId: string = r.dados.id;
    console.log(`   empresa: ${r.dados.nome}`);

    // --- Cadastro ---
    r = await chamar("POST", "/cadastro", { codigo: CODIGO, nome: "Fulano", cpf: "11111111111", senha: "123" });
    confere(
      r.status === 400 && r.dados.campos?.nome && r.dados.campos?.cpf && r.dados.campos?.senha,
      "cadastro inválido: aponta nome, CPF e senha",
      r,
    );

    r = await chamar("POST", "/cadastro", { codigo: CODIGO, nome: "teste ADMIN do app", cpf: cpfAdm, senha: cpfAdm + "x" });
    confere(r.status === 400 && /CPF/.test(r.dados.campos?.senha ?? ""), "senha que contém o CPF: recusada", r);

    r = await chamar("POST", "/cadastro", { codigo: CODIGO, nome: "teste ADMIN do app", cpf: cpfAdm, senha: senhaAdm });
    confere(r.status === 201 && r.dados.situacao === "pendente", "cadastro certo: 201 pendente", r);

    r = await chamar("POST", "/cadastro", { codigo: CODIGO, nome: "teste ADMIN do app", cpf: cpfAdm, senha: senhaAdm });
    confere(r.status === 409 && r.dados.erro === "cadastro_pendente", "mesmo CPF de novo: cadastro_pendente", r);

    const [criado] = await db
      .select({ nome: schema.usuario.nome, ativo: schema.usuario.ativo, aprovadoEm: schema.usuario.aprovadoEm })
      .from(schema.usuario)
      .where(eq(schema.usuario.cpf, cpfAdm));
    confere(criado?.nome === "Teste Admin do App" && !criado.ativo && !criado.aprovadoEm, "nome capitalizado, nasce desativado e sem aprovação", criado);

    // --- Login antes da aprovação ---
    r = await chamar("POST", "/sessao", { empresaId, cpf: cpfAdm, senha: "senha-errada" });
    confere(r.status === 401 && r.dados.erro === "credenciais", "pendente com senha errada: 401 (não revela que está pendente)", r);

    r = await chamar("POST", "/sessao", { empresaId, cpf: cpfAdm, senha: senhaAdm });
    confere(r.status === 403 && r.dados.erro === "aguardando_aprovacao", "pendente com senha certa: aguardando_aprovacao", r);

    // O primeiro administrador sai do banco, como faria `npm run usuario:aprovar`.
    await db
      .update(schema.usuario)
      .set({ ativo: true, papel: "adm", aprovadoEm: new Date() })
      .where(eq(schema.usuario.cpf, cpfAdm));

    // --- Login do administrador ---
    r = await chamar("POST", "/sessao", {
      empresaId,
      cpf: `${cpfAdm.slice(0, 3)}.${cpfAdm.slice(3, 6)}.${cpfAdm.slice(6, 9)}-${cpfAdm.slice(9)}`,
      senha: senhaAdm,
      dispositivo: "Teste · Node",
    });
    confere(r.status === 200 && r.dados.token, "adm aprovado entra, com CPF formatado", r);
    const tokenAdm: string = r.dados.token;
    confere(
      r.dados.usuario.papel === "adm" &&
        r.dados.usuario.permissoes.includes("equipe.gerir") &&
        r.dados.usuario.email === null,
      "perfil do adm: papel, permissões e e-mail nulo",
      r.dados.usuario,
    );

    r = await chamar("GET", "/eu", undefined, tokenAdm);
    confere(r.status === 200 && r.dados.usuario.empresa.id === empresaId, "/eu com o token", r);

    r = await chamar("GET", "/ordens", undefined, tokenAdm);
    confere(r.status === 200 && Array.isArray(r.dados.ordens), `adm vê as OS da empresa (${r.dados.ordens?.length ?? "?"})`, r);
    const primeira = r.dados.ordens[0];
    if (primeira) {
      confere(
        typeof primeira.numero === "number" && primeira.cliente?.nome && Array.isArray(primeira.checklist),
        "OS vem com cliente e checklist",
        primeira,
      );
      r = await chamar("GET", `/ordens/${primeira.id}`, undefined, tokenAdm);
      confere(r.status === 200 && r.dados.ordem.id === primeira.id, "detalhe da OS", r);
    }
    r = await chamar("GET", "/ordens/00000000-0000-4000-8000-000000000000", undefined, tokenAdm);
    confere(r.status === 404, "OS inexistente: 404", r);
    r = await chamar("GET", "/ordens/nao-e-uuid", undefined, tokenAdm);
    confere(r.status === 404, "id que não é UUID: 404, e não erro 500", r);

    // --- Técnico: cadastro, aprovação pela tela de equipe, escopo ---
    r = await chamar("POST", "/cadastro", { codigo: CODIGO, nome: "Teste Técnico do App", cpf: cpfTec, email: `tec${cpfTec}@teste.invalid`, senha: senhaTec });
    confere(r.status === 201, "técnico se cadastra com e-mail", r);

    r = await chamar("GET", "/equipe", undefined, tokenAdm);
    const pendente = r.dados.pendentes?.find((p: any) => p.cpf?.replace(/\D/g, "") === cpfTec);
    confere(r.status === 200 && pendente, "adm vê o técnico na fila de aprovação", r);

    r = await chamar("POST", `/equipe/${pendente.id}/aprovar`, { papel: "chefe" }, tokenAdm);
    confere(r.status === 400, "aprovar com papel que não existe: 400", r);
    r = await chamar("POST", `/equipe/${pendente.id}/aprovar`, { papel: "tecnico" }, tokenAdm);
    confere(r.status === 200, "adm aprova como técnico", r);

    r = await chamar("POST", "/sessao", { empresaId, cpf: cpfTec, senha: senhaTec });
    confere(r.status === 200 && r.dados.usuario.papel === "tecnico", "técnico entra", r);
    let tokenTec: string = r.dados.token;

    r = await chamar("GET", "/ordens", undefined, tokenTec);
    confere(r.status === 200 && r.dados.ordens.length === 0, "técnico sem OS atribuída não vê as da empresa", r);
    r = await chamar("GET", "/equipe", undefined, tokenTec);
    confere(r.status === 403 && r.dados.erro === "sem_permissao", "técnico não abre a equipe", r);
    if (primeira) {
      r = await chamar("GET", `/ordens/${primeira.id}`, undefined, tokenTec);
      confere(r.status === 404, "técnico não abre OS de outro, nem sabe que existe", r);
    }

    // --- Trocar papel ---
    r = await chamar("PATCH", `/equipe/${pendente.id}`, { papel: "engenheiro" }, tokenAdm);
    confere(r.status === 200, "adm troca o técnico para engenheiro", r);
    r = await chamar("GET", "/eu", undefined, tokenTec);
    confere(r.dados.usuario?.papel === "engenheiro" && r.dados.usuario.permissoes.includes("os.ver_todas"), "o papel novo vale na próxima chamada, sem novo login", r);

    // --- Senha provisória ---
    r = await chamar("POST", `/equipe/${pendente.id}/senha`, undefined, tokenAdm);
    confere(r.status === 200 && r.dados.senhaProvisoria?.length === 10, "adm redefine a senha: provisória de 10 caracteres", r);
    const provisoria: string = r.dados.senhaProvisoria;

    r = await chamar("GET", "/eu", undefined, tokenTec);
    confere(r.status === 401, "redefinir derruba a sessão que estava aberta", r);

    r = await chamar("POST", "/sessao", { empresaId, cpf: cpfTec, senha: provisoria });
    confere(r.status === 200 && r.dados.usuario.deveTrocarSenha === true, "entra com a provisória, marcado para trocar", r);
    tokenTec = r.dados.token;

    r = await chamar("GET", "/ordens", undefined, tokenTec);
    confere(r.status === 403 && r.dados.erro === "trocar_senha", "com senha provisória, não vê OS", r);

    r = await chamar("POST", "/eu/senha", { atual: provisoria, nova: "12345678" }, tokenTec);
    confere(r.status === 400 && r.dados.campos?.nova, "senha nova óbvia: recusada", r);
    r = await chamar("POST", "/eu/senha", { atual: "errada-errada", nova: senhaTec + "!" }, tokenTec);
    confere(r.status === 400 && r.dados.erro === "senha_atual_incorreta", "senha atual errada: recusada", r);
    r = await chamar("POST", "/eu/senha", { atual: provisoria, nova: senhaTec + "!" }, tokenTec);
    confere(r.status === 200 && r.dados.usuario.deveTrocarSenha === false, "troca a senha", r);
    r = await chamar("GET", "/ordens", undefined, tokenTec);
    confere(r.status === 200, "depois de trocar, a mesma sessão segue valendo", r);

    // --- Limites do administrador ---
    r = await chamar("PATCH", `/equipe/${r.dados?.id ?? "x"}`, { ativo: false }, tokenAdm);
    confere(r.status === 404, "PATCH com id inválido: 404", r);
    const eu = await chamar("GET", "/eu", undefined, tokenAdm);
    r = await chamar("PATCH", `/equipe/${eu.dados.usuario.id}`, { ativo: false }, tokenAdm);
    confere(r.status === 409 && r.dados.erro === "propria_conta", "adm não desativa a si mesmo", r);

    // --- Desativar ---
    r = await chamar("PATCH", `/equipe/${pendente.id}`, { ativo: false }, tokenAdm);
    confere(r.status === 200, "adm desativa", r);
    r = await chamar("GET", "/eu", undefined, tokenTec);
    confere(r.status === 401, "desativado cai na hora", r);
    r = await chamar("POST", "/sessao", { empresaId, cpf: cpfTec, senha: senhaTec + "!" });
    confere(r.status === 403 && r.dados.erro === "conta_desativada", "desativado não entra de novo", r);

    // --- Sair ---
    r = await chamar("DELETE", "/sessao", undefined, tokenAdm);
    confere(r.status === 204, "sair: 204", r);
    r = await chamar("GET", "/eu", undefined, tokenAdm);
    confere(r.status === 401, "token de quem saiu não vale mais", r);

    console.log(`\nTudo certo: ${passos} verificações.`);
  } finally {
    const apagados = await db
      .delete(schema.usuario)
      .where(inArray(schema.usuario.cpf, [cpfAdm, cpfTec]))
      .returning({ id: schema.usuario.id });
    console.log(`(limpeza: ${apagados.length} cadastros de teste apagados)`);
  }
  process.exit(0);
}

main().catch((erro) => {
  console.error(erro instanceof Error ? erro.message : erro);
  process.exit(1);
});
