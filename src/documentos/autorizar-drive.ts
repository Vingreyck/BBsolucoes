import "dotenv/config";

import { createServer } from "node:http";

import { ESCOPO } from "./drive";

/**
 * Pega o refresh token do Google, uma vez, na máquina do dono.
 *
 * Roda um servidor local só para receber o retorno do Google, imprime o
 * refresh token e sai. **O token aparece no seu terminal e em lugar nenhum
 * mais** — ninguém além de você o vê, e é você quem cola no `.env`.
 *
 * ANTES DE RODAR, uma vez só, em https://console.cloud.google.com.
 *
 * O Google renomeou isto em 2025: o que era "Tela de permissão OAuth" dentro
 * de "APIs e serviços" virou uma seção própria, **Google Auth Platform**. Se
 * você procurar pelo nome antigo não acha.
 *
 *   1. Criar projeto (nome livre, "Selebi" serve). Se você já tem um projeto
 *      criado sozinho pela Gemini API — nome tipo `gen-lang-client-00721...` —
 *      dá para usar esse mesmo.
 *
 *   2. APIs e serviços → Biblioteca → ativar **Google Drive API**.
 *      Sem isso o resto configura e o Drive responde 403 na primeira chamada.
 *
 *   3. Google Auth Platform → **Público-alvo**
 *        · Tipo de usuário: Externo
 *        · Em **Usuários de teste**, adicionar bbsolucoesengenharia@gmail.com
 *      É o passo que mais some: sem o e-mail nessa lista, o consentimento é
 *      recusado com "app não concluiu o processo de verificação" e não há como
 *      seguir.
 *
 *   4. Google Auth Platform → **Branding**
 *        · Nome do app: Selebi
 *        · E-mail de suporte e de contato: o seu
 *
 *   5. Google Auth Platform → **Clientes** → Criar cliente
 *        · Tipo: Aplicativo da Web
 *        · URI de redirecionamento autorizado: http://localhost:5599/retorno
 *      O endereço precisa bater com o que este script escuta, letra por letra.
 *
 *   6. Copiar o ID e a chave secreta para o `.env`:
 *        GOOGLE_CLIENT_ID=...
 *        GOOGLE_CLIENT_SECRET=...
 *
 *   7. `npm run drive:autorizar`, entrar com a conta bbsolucoesengenharia
 *
 * A tela do Google vai avisar que o app não foi verificado. É esperado: o app
 * é seu, usado só pela sua empresa. Clique em "Avançado" → "Acessar Selebi".
 */

const PORTA = 5599;
const REDIRECIONAMENTO = `http://localhost:${PORTA}/retorno`;

function exigir(nome: string): string {
  const valor = process.env[nome];
  if (!valor) {
    console.error(
      `Falta ${nome} no .env.\n\n` +
        "Leia o cabeçalho de src/documentos/autorizar-drive.ts: são seis passos\n" +
        "no console do Google, e só precisam ser feitos uma vez.",
    );
    process.exit(1);
  }
  return valor;
}

async function trocarPorToken(codigo: string) {
  const corpo = new URLSearchParams({
    code: codigo,
    client_id: exigir("GOOGLE_CLIENT_ID"),
    client_secret: exigir("GOOGLE_CLIENT_SECRET"),
    redirect_uri: REDIRECIONAMENTO,
    grant_type: "authorization_code",
  });

  const resposta = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: corpo,
  });

  const dados = (await resposta.json()) as {
    refresh_token?: string;
    access_token?: string;
    error?: string;
    error_description?: string;
  };

  if (!resposta.ok || !dados.refresh_token) {
    throw new Error(
      dados.error_description ??
        dados.error ??
        "O Google não devolveu refresh token. Se você já autorizou este app antes, " +
          "revogue em myaccount.google.com/permissions e rode de novo — o refresh " +
          "token só vem na primeira autorização.",
    );
  }

  return dados.refresh_token;
}

function main() {
  const clientId = exigir("GOOGLE_CLIENT_ID");
  exigir("GOOGLE_CLIENT_SECRET");

  const autorizar = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  autorizar.searchParams.set("client_id", clientId);
  autorizar.searchParams.set("redirect_uri", REDIRECIONAMENTO);
  autorizar.searchParams.set("response_type", "code");
  autorizar.searchParams.set("scope", ESCOPO);
  // `offline` é o que faz vir refresh token; `consent` força a tela mesmo se
  // já autorizado antes, senão o Google devolve só o access token e o script
  // não teria o que imprimir.
  autorizar.searchParams.set("access_type", "offline");
  autorizar.searchParams.set("prompt", "consent");

  const servidor = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://localhost:${PORTA}`);
    if (url.pathname !== "/retorno") {
      res.writeHead(404).end();
      return;
    }

    const erro = url.searchParams.get("error");
    if (erro) {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(`<p>Autorização cancelada: ${erro}. Pode fechar esta aba.</p>`);
      console.error(`\nAutorização cancelada: ${erro}`);
      servidor.close();
      process.exit(1);
    }

    const codigo = url.searchParams.get("code");
    if (!codigo) {
      res.writeHead(400).end();
      return;
    }

    try {
      const refresh = await trocarPorToken(codigo);
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(
        "<p>Pronto. Volte para o terminal — o token está lá. Pode fechar esta aba.</p>",
      );

      console.log("\n\nCole esta linha no seu .env:\n");
      console.log(`GOOGLE_REFRESH_TOKEN=${refresh}`);
      console.log(
        "\nEle não expira. Guarde como guarda senha: quem tiver este token " +
          "\nacessa o Drive inteiro da empresa.\n",
      );
    } catch (e) {
      res.writeHead(500, { "content-type": "text/html; charset=utf-8" });
      res.end("<p>Falhou. Veja o terminal.</p>");
      console.error("\nFalhou:", e instanceof Error ? e.message : e);
    }

    servidor.close();
    setTimeout(() => process.exit(0), 200);
  });

  servidor.listen(PORTA, () => {
    console.log("Abra este endereço no navegador, com a conta da BB:\n");
    console.log(autorizar.toString());
    console.log("\nEsperando o retorno do Google...");
  });
}

main();
