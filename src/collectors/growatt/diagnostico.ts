import "dotenv/config";

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { hashSenhaGrowatt } from "./client";

/**
 * Diagnóstico de credencial da Growatt.
 *
 * O que já sabemos, por eliminação:
 *
 *   - o host certo é server-api.growatt.com (os outros devolvem 403);
 *   - em /newTwoLoginAPI.do, usuário inexistente devolve "User Does Not Exist"
 *     e a conta da BB devolve "Username or Password Error" — ou seja, a conta
 *     existe e é a senha que está sendo recusada;
 *   - o .env está bem escrito e as três formas de senha falharam ali.
 *
 * Resta a hipótese mais provável: a conta de distribuidor do OSS não autentica
 * na API do app ShinePhone, e sim no login do portal web (/login), que tem
 * outro formato de resposta. Este script varre a matriz endpoint × formato.
 *
 * NADA aqui imprime a senha nem o hash dela.
 *
 *   npm run diag:growatt
 */

const HOST = process.env.GROWATT_BASE_URL || "https://server-api.growatt.com";
const PAUSA_MS = 1500;

const md5 = (s: string) => createHash("md5").update(s, "utf8").digest("hex");

interface Tentativa {
  endpoint: string;
  campoUsuario: string;
  formato: string;
  transformar: (senha: string) => string;
}

const TENTATIVAS: Tentativa[] = [
  {
    endpoint: "newTwoLoginAPI.do",
    campoUsuario: "userName",
    formato: "MD5 com troca de '0' por 'c'",
    transformar: hashSenhaGrowatt,
  },
  {
    endpoint: "newTwoLoginAPI.do",
    campoUsuario: "userName",
    formato: "MD5 puro",
    transformar: md5,
  },
  {
    endpoint: "login",
    campoUsuario: "account",
    formato: "texto puro",
    transformar: (s) => s,
  },
  {
    endpoint: "login",
    campoUsuario: "account",
    formato: "MD5 com troca de '0' por 'c'",
    transformar: hashSenhaGrowatt,
  },
  {
    endpoint: "login",
    campoUsuario: "userName",
    formato: "texto puro",
    transformar: (s) => s,
  },
];

function inspecionarArquivoEnv(): void {
  console.log("1) Como o .env está escrito\n");
  let linhas: string[];
  try {
    linhas = readFileSync(".env", "utf8").split(/\r?\n/);
  } catch {
    console.log("   Não consegui ler o .env na raiz do projeto.\n");
    return;
  }

  for (const chave of ["GROWATT_USER", "GROWATT_PASSWORD"]) {
    const linha = linhas.find((l) => l.trimStart().startsWith(`${chave}=`));
    if (!linha) {
      console.log(`   ${chave}: não encontrado no arquivo`);
      continue;
    }
    const valorBruto = linha.slice(linha.indexOf("=") + 1);
    const aspas = /^\s*["']/.test(valorBruto);
    const avisos: string[] = [];

    if (valorBruto.includes("#") && !aspas) {
      avisos.push("CONTÉM # SEM ASPAS — o dotenv corta a partir do #");
    }
    if (!aspas && /\s/.test(valorBruto.trim())) avisos.push("tem espaço sem aspas");
    if (aspas && !/^\s*["'].*["']\s*$/.test(valorBruto)) {
      avisos.push("abre aspas mas não fecha");
    }

    console.log(
      `   ${chave}: ${aspas ? "entre aspas" : "sem aspas"}` +
        (avisos.length ? `\n      ⚠ ${avisos.join("\n      ⚠ ")}` : ""),
    );
  }
  console.log("");
}

function inspecionarValores(usuario: string, senha: string): void {
  console.log("2) O que o dotenv entregou para o código\n");
  console.log(
    `   Usuário: ${usuario.length} caracteres, ` +
      `${usuario.includes("@") ? "parece e-mail" : "não é e-mail"}`,
  );
  console.log(`   Senha:   ${senha.length} caracteres`);

  const problemas: string[] = [];
  if (usuario !== usuario.trim()) problemas.push("usuário tem espaço nas pontas");
  if (senha !== senha.trim()) problemas.push("senha tem espaço nas pontas");
  if (/^["'].*["']$/.test(senha)) problemas.push("senha veio COM aspas dentro do valor");
  if (/^["'].*["']$/.test(usuario)) problemas.push("usuário veio COM aspas dentro do valor");

  if (problemas.length) console.log(`\n   ⚠ ${problemas.join("\n   ⚠ ")}`);
  console.log("");
}

/** Interpreta os dois formatos de resposta que a Growatt usa. */
function interpretar(texto: string, status: number): { ok: boolean; detalhe: string } {
  let json: unknown;
  try {
    json = JSON.parse(texto);
  } catch {
    return {
      ok: false,
      detalhe: `resposta não-JSON (HTTP ${status}): ${texto.slice(0, 60).trim()}`,
    };
  }

  // Formato do app ShinePhone: { back: { success, error, msg } }
  const back = (json as { back?: { success?: boolean; error?: string; msg?: string } })
    .back;
  if (back) {
    if (back.success) return { ok: true, detalhe: "LOGIN ACEITO" };
    return { ok: false, detalhe: back.error ?? back.msg ?? "recusado sem detalhe" };
  }

  // Formato do portal web: { result, msg }
  const web = json as { result?: number; msg?: string };
  if (web.result !== undefined) {
    if (web.result === 1) return { ok: true, detalhe: "LOGIN ACEITO" };
    return { ok: false, detalhe: `result=${web.result} ${web.msg ?? ""}`.trim() };
  }

  return { ok: false, detalhe: `formato desconhecido: ${texto.slice(0, 60).trim()}` };
}

async function tentar(t: Tentativa, usuario: string, senha: string) {
  const res = await fetch(`${HOST}/${t.endpoint}`, {
    method: "POST",
    headers: {
      "User-Agent": "Dalvik/2.1.0 (Linux; U; Android 12; ShinePhone)",
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
    },
    body: new URLSearchParams({
      [t.campoUsuario]: usuario,
      password: t.transformar(senha),
    }).toString(),
  });
  return interpretar(await res.text(), res.status);
}

async function main() {
  const usuario = process.env.GROWATT_USER ?? "";
  const senha = process.env.GROWATT_PASSWORD ?? "";

  if (!usuario || !senha) {
    console.error("Faltam GROWATT_USER e GROWATT_PASSWORD no .env.");
    process.exit(1);
  }

  console.log(`Host: ${HOST}\n`);
  inspecionarArquivoEnv();
  inspecionarValores(usuario, senha);

  console.log("3) Matriz endpoint × formato de senha\n");
  for (const t of TENTATIVAS) {
    const r = await tentar(t, usuario, senha);
    console.log(
      `   ${r.ok ? "✓" : "·"} /${t.endpoint}  campo "${t.campoUsuario}"  ${t.formato}\n` +
        `     → ${r.detalhe}\n`,
    );
    if (r.ok) {
      console.log("   Achamos. Me diga qual linha passou que eu ajusto o cliente.\n");
      process.exit(0);
    }
    await new Promise((r) => setTimeout(r, PAUSA_MS));
  }

  console.log(
    "Nenhuma combinação passou.\n\n" +
      "Isso encerra o caminho da API de sessão para esta conta, e o motivo não\n" +
      "é senha errada: o OSS e o ShineServer são dois sistemas separados. A\n" +
      "conta de distribuidor do OSS não existe no ShineServer, então não\n" +
      "autentica nem na API do ShinePhone nem em openapi.growatt.com (testado\n" +
      "nos dois hosts).\n\n" +
      "O token do distribuidor sai do próprio OSS, num formulário fácil de\n" +
      "não achar porque o menu chama System Setting, não System set:\n\n" +
      "  oss.growatt.com → System Setting → System Management\n" +
      "    → aba \"API management\" → + Add API Request\n\n" +
      "Aprovado, o token é permanente e chega por e-mail. Aí a API vira\n" +
      "https://openapi.growatt.com/v1/ com o token no header `token`.\n" +
      "Se o pedido empacar: br.service@growatt.com.\n",
  );
  process.exit(1);
}

main().catch((erro) => {
  console.error("Falhou:", erro instanceof Error ? erro.message : erro);
  process.exit(1);
});
