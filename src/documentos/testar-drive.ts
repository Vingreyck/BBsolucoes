import "dotenv/config";

import { and, eq, isNotNull } from "drizzle-orm";

import { db, schema } from "../db";
import { accessToken, baixarArquivo, driveConfigurado, idDoLink } from "./drive";

/**
 * Confere a conexão com o Drive **sem escrever nada**.
 *
 * Existe porque a credencial pode estar errada de seis formas diferentes, e o
 * erro só aparece na hora em que alguém tenta anexar um documento — que é a
 * pior hora possível. Aqui cada etapa falha com o nome do problema e o que
 * fazer.
 *
 * Só lê: renova o token, lista a raiz e baixa o começo de um arquivo real. Não
 * cria pasta, não sobe arquivo, não mexe em nada — o Drive tem documento de
 * cliente de verdade lá dentro.
 *
 *   npm run drive:testar
 */

const API = "https://www.googleapis.com/drive/v3";

async function main() {
  if (!driveConfigurado()) {
    console.error(
      "Faltam variáveis no .env: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET e\n" +
        "GOOGLE_REFRESH_TOKEN. Leia o cabeçalho de src/documentos/autorizar-drive.ts.",
    );
    process.exit(1);
  }

  console.log("1. Renovando o token de acesso...");
  const token = await accessToken();
  console.log("   ok\n");

  console.log("2. Conferindo qual conta o Selebi está usando...");
  const sobre = await fetch(`${API}/about?fields=user,storageQuota`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!sobre.ok) {
    const texto = await sobre.text();
    if (texto.includes("accessNotConfigured") || sobre.status === 403) {
      console.error(
        "   A Google Drive API não está ativada neste projeto.\n" +
          "   Console do Google → APIs e serviços → Biblioteca → Google Drive API → Ativar.",
      );
      process.exit(1);
    }
    console.error(`   Falhou (${sobre.status}): ${texto}`);
    process.exit(1);
  }
  const dados = (await sobre.json()) as {
    user: { emailAddress: string; displayName: string };
    storageQuota: { limit?: string; usage?: string };
  };
  console.log(`   Conta: ${dados.user.emailAddress}`);
  const gb = (n?: string) => (n ? `${(Number(n) / 1024 ** 3).toFixed(1)} GB` : "?");
  console.log(
    `   Espaço: ${gb(dados.storageQuota.usage)} de ${gb(dados.storageQuota.limit)}\n`,
  );

  const raiz = process.env.GOOGLE_DRIVE_RAIZ;
  if (!raiz) {
    console.error(
      "   Falta GOOGLE_DRIVE_RAIZ no .env — o id da pasta \"Energia solar\".\n" +
        "   Está no cabeçalho de scripts/listar-drive.gs.",
    );
    process.exit(1);
  }

  console.log("3. Abrindo a pasta Energia solar...");
  const q = `'${raiz}' in parents and trashed = false`;
  const lista = await fetch(
    `${API}/files?q=${encodeURIComponent(q)}&fields=files(id,name,mimeType)&pageSize=20`,
    { headers: { authorization: `Bearer ${token}` } },
  );
  if (!lista.ok) {
    const texto = await lista.text();
    if (lista.status === 404) {
      console.error(
        "   Pasta não encontrada. Ou o id em GOOGLE_DRIVE_RAIZ está errado, ou\n" +
          "   a conta que autorizou não é a dona do Drive da BB.",
      );
      process.exit(1);
    }
    console.error(`   Falhou (${lista.status}): ${texto}`);
    process.exit(1);
  }
  const conteudo = (await lista.json()) as {
    files: { id: string; name: string; mimeType: string }[];
  };
  for (const f of conteudo.files) console.log(`   ${f.name}`);
  console.log("");

  console.log("4. Baixando um documento real pelo Selebi...");
  const empresa = await db.query.empresa.findFirst();
  const documento = empresa
    ? await db.query.documento.findFirst({
        where: and(
          eq(schema.documento.empresaId, empresa.id),
          isNotNull(schema.documento.linkDrive),
        ),
        with: { cliente: { columns: { nome: true } } },
      })
    : null;

  if (!documento) {
    console.log("   Nenhum documento importado para testar. Pulei.");
  } else {
    const fileId = idDoLink(documento.linkDrive);
    if (!fileId) {
      console.log(`   "${documento.nomeArquivo}" não tem id no link. Pulei.`);
    } else {
      const { corpo, tipo } = await baixarArquivo(fileId);
      /**
       * Lê só o primeiro pedaço e corta. Não faz sentido puxar 30 MB de um
       * memorial escaneado para confirmar que o cano funciona — e os bytes
       * são de documento de cliente, que não deve ficar na memória à toa.
       */
      const leitor = corpo.getReader();
      const { value } = await leitor.read();
      await leitor.cancel();
      console.log(`   ${documento.nomeArquivo}`);
      console.log(`   cliente: ${documento.cliente?.nome ?? "?"}`);
      console.log(`   ${tipo}, primeiros ${value?.length ?? 0} bytes chegaram`);
    }
  }

  console.log("\nTudo certo. O upload e o download pela tela já funcionam.");
  process.exit(0);
}

main().catch((erro) => {
  console.error("\nFalhou:", erro instanceof Error ? erro.message : erro);
  process.exit(1);
});
