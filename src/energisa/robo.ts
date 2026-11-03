import "dotenv/config";

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { eq } from "drizzle-orm";
import { chromium, type BrowserContext, type Page } from "playwright-core";

import { db, schema } from "@/db";

import { sincronizar } from "./sincronizar";

/**
 * O robô do portal de projetos da Energisa — roda num container próprio
 * (`energisa` no docker-compose), com um navegador automatizado comum
 * (Playwright), na conta da própria empresa.
 *
 * Ele abre a página "Meus projetos" e lê a lista que a página recebe pronta
 * do servidor (`__NEXT_DATA__ … dadosServerSide.solicitacao`): todos os
 * projetos de uma vez, com o código da situação de cada um. Uma leitura a cada
 * 30 minutos — o mesmo que alguém abrindo a página.
 *
 * O portal tem proteção contra robôs (Akamai). O robô não tenta se esconder
 * dela: se a Energisa recusar, ele marca "bloqueado", avisa e para de tentar
 * até alguém pedir pela tela. Nesse caso o caminho é pedir acesso à Energisa,
 * não insistir.
 *
 * O login não tem senha: CPF → escolher o celular → código por SMS. Quando a
 * sessão cai, o robô avisa (Healthchecks → e-mail) e espera alguém clicar
 * "Entrar na Energisa" no Selebi (`/energisa`) e digitar o código que chegou.
 *
 * Configuração no `.env`:
 *   ENERGISA_CPF=             CPF ou CNPJ da conta do portal (só dígitos)
 *   ENERGISA_FINAL_TELEFONE=  final do celular que recebe o SMS (padrão 0544)
 *   ENERGISA_HEALTHCHECK_URL= check do Healthchecks que manda o e-mail
 *   ENERGISA_INTERVALO_MIN=   minutos entre leituras (padrão 30)
 */

const BASE = "https://servicos.energisa.com.br";
const PAINEL = `${BASE}/AWGPE/dashboard?CodigoEmpresaWeb=${process.env.ENERGISA_CODIGO_EMPRESA || "3"}`;
const PASTA = process.env.ENERGISA_PASTA || "estado/energisa";
const CPF = (process.env.ENERGISA_CPF ?? "").replace(/\D/g, "");
const FINAL = (process.env.ENERGISA_FINAL_TELEFONE ?? "0544").replace(/\D/g, "") || "0544";
const INTERVALO_MS = Math.max(15, Number(process.env.ENERGISA_INTERVALO_MIN) || 30) * 60_000;
/** Quanto o robô espera alguém digitar o código antes de desistir. */
const ESPERA_CODIGO_MS = 10 * 60_000;

type Estado = "conectado" | "desconectado" | "entrando" | "aguardando_codigo" | "erro" | "bloqueado" | "parado";

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));
const hora = () => new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
function log(msg: string) {
  console.log(`[energisa ${hora()}] ${msg}`);
}

let empresaId = "";
let ultimoEstado: Estado | null = null;

async function definirEstado(
  estado: Estado,
  mensagem: string,
  extra: Partial<typeof schema.roboEnergisa.$inferInsert> = {},
) {
  log(`${estado}: ${mensagem}`);
  await db
    .update(schema.roboEnergisa)
    .set({ estado, mensagem, atualizadoEm: new Date(), ...extra })
    .where(eq(schema.roboEnergisa.empresaId, empresaId));
  // E-mail só na virada para um estado ruim: o Healthchecks avisa uma vez, não a cada leitura.
  const ruim = estado === "desconectado" || estado === "erro" || estado === "bloqueado";
  if (ruim && ultimoEstado !== estado) {
    await avisar("/fail", `Robô da Energisa: ${mensagem}\n\nResolva em https://app.selebi.com.br/energisa`);
  }
  if (estado === "conectado") await avisar("", mensagem);
  ultimoEstado = estado;
}

async function avisar(sufixo: "" | "/fail", corpo: string) {
  const base = process.env.ENERGISA_HEALTHCHECK_URL?.trim();
  if (!base) return;
  try {
    await fetch(base.replace(/\/+$/, "") + sufixo, { method: "POST", body: corpo, signal: AbortSignal.timeout(10_000) });
  } catch (e) {
    log(`não consegui avisar o Healthchecks: ${e instanceof Error ? e.message : e}`);
  }
}

/** Guarda o que o robô está vendo: a tela `/energisa` mostra, para entender um erro sem entrar na VM. */
async function fotografar(page: Page, motivo: string) {
  try {
    mkdirSync(PASTA, { recursive: true });
    await page.screenshot({ path: join(PASTA, "tela.png") });
    const texto = (await page.locator("body").innerText({ timeout: 3_000 }).catch(() => "")).slice(0, 3000);
    writeFileSync(join(PASTA, "tela.txt"), `${new Date().toISOString()} — ${motivo}\n${page.url()}\n\n${texto}`);
  } catch {
    // Sem foto não é motivo para parar.
  }
}

async function lerLinha() {
  const [linha] = await db.select().from(schema.roboEnergisa).where(eq(schema.roboEnergisa.empresaId, empresaId));
  return linha;
}

async function limparPedido() {
  await db.update(schema.roboEnergisa).set({ pedido: null }).where(eq(schema.roboEnergisa.empresaId, empresaId));
}

function recusado(texto: string) {
  return /access denied|acesso negado|you don't have permission/i.test(texto);
}

// --- Ler a lista ------------------------------------------------------------------------

async function ler(page: Page): Promise<void> {
  await page.goto(PAINEL, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => undefined);
  const texto = await page.locator("body").innerText({ timeout: 5_000 }).catch(() => "");
  if (recusado(texto)) {
    await fotografar(page, "recusado");
    await definirEstado("bloqueado", "A Energisa recusou o acesso do robô (Access Denied). O robô parou de tentar.");
    return;
  }
  if (/\/login|\/logout/.test(page.url())) {
    await definirEstado("desconectado", 'A Energisa pediu login de novo. Clique em "Entrar na Energisa" e digite o código do SMS.');
    return;
  }
  const dados = await page.evaluate(() => {
    const w = window as unknown as { __NEXT_DATA__?: { props?: { pageProps?: { dadosServerSide?: unknown } } } };
    return w.__NEXT_DATA__?.props?.pageProps?.dadosServerSide ?? null;
  });
  const lista = (dados as { solicitacao?: unknown } | null)?.solicitacao;
  if (!Array.isArray(lista)) {
    await fotografar(page, "sem lista");
    if (/Projetos \(0\)|não possui/i.test(texto)) {
      await definirEstado("desconectado", 'A sessão da Energisa venceu. Clique em "Entrar na Energisa" e digite o código do SMS.');
    } else {
      await definirEstado("erro", "A página de projetos abriu, mas sem a lista que o robô lê. Veja a última tela.");
    }
    return;
  }
  const resumo = await sincronizar(empresaId, lista as Record<string, unknown>[]);
  const partes = [`${resumo.lidos} projetos lidos`];
  if (resumo.novos) partes.push(`${resumo.novos} novos`);
  if (resumo.mudaram) partes.push(`${resumo.mudaram} mudaram de situação`);
  if (resumo.vinculados) partes.push(`${resumo.vinculados} vinculados`);
  if (resumo.movidos.length) partes.push(`movidos na esteira: ${resumo.movidos.join(", ")}`);
  await definirEstado("conectado", partes.join(" · "), { ultimaLeituraEm: new Date(), totalProjetos: resumo.lidos });
}

// --- Entrar, com o código que alguém digita no Selebi -----------------------------------

const BOTAO_SEGUIR = /continuar|enviar|receber|avan[cç]ar|pr[oó]ximo|confirmar|validar|acessar|entrar/i;

async function clicarSeguir(page: Page) {
  const botao = page.getByRole("button", { name: BOTAO_SEGUIR }).first();
  if ((await botao.isVisible().catch(() => false)) && (await botao.isEnabled().catch(() => false))) await botao.click();
}

async function esperarCodigo(): Promise<string | null> {
  const limite = Date.now() + ESPERA_CODIGO_MS;
  while (Date.now() < limite) {
    const linha = await lerLinha();
    if (linha?.codigo) {
      await db
        .update(schema.roboEnergisa)
        .set({ codigo: null, codigoEm: null })
        .where(eq(schema.roboEnergisa.empresaId, empresaId));
      return linha.codigo;
    }
    await dormir(3_000);
  }
  return null;
}

async function entrar(page: Page): Promise<void> {
  if (!CPF) {
    await definirEstado("erro", "Falta ENERGISA_CPF no .env do servidor (o CPF ou CNPJ da conta do portal).");
    return;
  }
  await definirEstado("entrando", "Abrindo o login da Energisa…");
  await db.update(schema.roboEnergisa).set({ codigo: null }).where(eq(schema.roboEnergisa.empresaId, empresaId));

  // 1. CPF ou CNPJ.
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  const campo = page.locator("input:visible").first();
  await campo.waitFor({ timeout: 30_000 }).catch(() => undefined);
  if (!(await campo.isVisible().catch(() => false))) {
    await fotografar(page, "login sem campo");
    const t = await page.locator("body").innerText().catch(() => "");
    await definirEstado(recusado(t) ? "bloqueado" : "erro", "Não achei o campo do CPF na tela de login. Veja a última tela.");
    return;
  }
  await campo.fill(CPF);
  await clicarSeguir(page);

  // 2. O celular que recebe o código (e o SMS, se a tela perguntar o canal).
  const celular = page.getByText(new RegExp(FINAL)).first();
  await celular.waitFor({ timeout: 30_000 }).catch(() => undefined);
  if (!(await celular.isVisible().catch(() => false))) {
    await fotografar(page, "sem celular");
    await definirEstado("erro", `Depois do CPF, não achei o celular final ${FINAL} para mandar o código. Veja a última tela.`);
    return;
  }
  await celular.click();
  const sms = page.getByText(/SMS/i).first();
  if (await sms.isVisible().catch(() => false)) await sms.click();
  await clicarSeguir(page);

  // 3. O código: espera alguém digitar no Selebi.
  const caixa = page
    .locator('input[autocomplete="one-time-code"], input[inputmode="numeric"], input[maxlength="1"], input:visible')
    .first();
  await caixa.waitFor({ timeout: 30_000 }).catch(() => undefined);
  await fotografar(page, "esperando código");
  await definirEstado(
    "aguardando_codigo",
    `A Energisa mandou um código por SMS para o celular final ${FINAL}. Digite o código no Selebi (vale por poucos minutos).`,
  );
  const codigo = await esperarCodigo();
  if (!codigo) {
    await definirEstado("desconectado", 'Ninguém digitou o código a tempo. Clique em "Entrar na Energisa" de novo.');
    return;
  }
  await caixa.click().catch(() => undefined);
  await page.keyboard.type(codigo);
  await clicarSeguir(page);
  await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => undefined);

  // 4. Confere entrando no painel.
  await page.goto(PAINEL, { waitUntil: "domcontentloaded", timeout: 60_000 });
  if (/\/login|\/logout/.test(page.url())) {
    await fotografar(page, "código recusado");
    await definirEstado("desconectado", 'A Energisa não aceitou o código (ou ele venceu). Clique em "Entrar na Energisa" de novo.');
    return;
  }
  await definirEstado("conectado", "Entrou na Energisa. Lendo os projetos…");
  await ler(page);
}

// --- O laço ------------------------------------------------------------------------------

async function abrirNavegador(): Promise<BrowserContext> {
  mkdirSync(join(PASTA, "perfil"), { recursive: true });
  // Perfil guardado em disco: a sessão da Energisa sobrevive a um reinício do container.
  return chromium.launchPersistentContext(join(PASTA, "perfil"), {
    headless: true,
    locale: "pt-BR",
    timezoneId: "America/Sao_Paulo",
    viewport: { width: 1366, height: 850 },
  });
}

async function main() {
  const empresa = await db.query.empresa.findFirst({ columns: { id: true, nome: true } });
  if (!empresa) throw new Error("Nenhuma empresa no banco.");
  empresaId = empresa.id;
  await db.insert(schema.roboEnergisa).values({ empresaId, estado: "parado" }).onConflictDoNothing();

  const contexto = await abrirNavegador();
  let page = contexto.pages()[0] ?? (await contexto.newPage());
  let proximaLeitura = 0;
  log(`robô no ar para ${empresa.nome}; leitura a cada ${INTERVALO_MS / 60_000} min.`);

  for (;;) {
    try {
      if (page.isClosed()) page = await contexto.newPage();
      const linha = await lerLinha();
      if (linha?.pedido === "entrar") {
        await limparPedido();
        await entrar(page);
        proximaLeitura = Date.now() + INTERVALO_MS;
      } else if (linha?.pedido === "ler" || Date.now() >= proximaLeitura) {
        if (linha?.pedido) await limparPedido();
        // Desconectado ou recusado não tenta sozinho: só quando alguém pedir pela tela.
        const parado = ultimoEstado === "desconectado" || ultimoEstado === "bloqueado";
        if (linha?.pedido === "ler" || !parado) await ler(page);
        proximaLeitura = Date.now() + INTERVALO_MS;
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message.split("\n")[0] : String(e);
      await fotografar(page, `exceção: ${msg}`);
      await definirEstado("erro", `O robô travou numa etapa: ${msg}`).catch(() => undefined);
      proximaLeitura = Date.now() + INTERVALO_MS;
    }
    await dormir(5_000);
  }
}

main().catch(async (e) => {
  console.error("[energisa] falhou ao subir:", e);
  await avisar("/fail", `Robô da Energisa não conseguiu subir: ${e instanceof Error ? e.message : e}`);
  process.exit(1);
});
