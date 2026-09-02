import "dotenv/config";

import { writeFileSync } from "node:fs";

import {
  FoxEssClient,
  SEPARADOR_CONTROLE,
  SEPARADOR_LITERAL,
} from "./client";

/**
 * Primeiro contato com a conta FoxESS.
 *
 * Resolve empiricamente a única dúvida que sobrou da documentação: qual
 * separador a assinatura exige. Testa os dois e diz qual passou, em vez de
 * deixar você adivinhar diante de um 401 mudo.
 *
 * Não grava nada no banco.
 *
 *   npm run probe:foxess
 */

async function tentar(chave: string, separador: string, rotulo: string) {
  const cliente = new FoxEssClient(chave, { separador });
  try {
    const r = await cliente.listarUsinas(1, 10);
    const lista = (r.result as { data?: unknown[] })?.data ?? [];
    return { ok: true, rotulo, cliente, quantas: lista.length, bruto: r };
  } catch (erro) {
    return {
      ok: false,
      rotulo,
      motivo: erro instanceof Error ? erro.message : String(erro),
    };
  }
}

async function main() {
  const chave = process.env.FOXESS_API_KEY;
  if (!chave) {
    console.error(
      "Falta FOXESS_API_KEY no .env.\n" +
        "A chave sai no FoxCloud OpenPlatform, em API Keys → Generate Key.",
    );
    process.exit(1);
  }

  console.log(`Chave carregada: ${chave.length} caracteres.\n`);
  console.log("Testando os dois separadores de assinatura...\n");

  const literal = await tentar(chave, SEPARADOR_LITERAL, "literal \\r\\n (4 caracteres)");
  console.log(`  ${literal.ok ? "✓" : "·"} ${literal.rotulo}`);
  if (!literal.ok) console.log(`     ${literal.motivo}`);

  let vencedor = literal.ok ? literal : null;

  if (!literal.ok) {
    await new Promise((r) => setTimeout(r, 1500));
    const controle = await tentar(chave, SEPARADOR_CONTROLE, "caracteres de controle CR LF");
    console.log(`  ${controle.ok ? "✓" : "·"} ${controle.rotulo}`);
    if (!controle.ok) console.log(`     ${controle.motivo}`);
    if (controle.ok) vencedor = controle;
  }

  if (!vencedor || !vencedor.ok || !vencedor.cliente) {
    // Distingue os dois casos: a mensagem antiga mandava desconfiar da chave
    // mesmo quando a autenticação tinha passado e o problema era outro.
    const pareceParametro =
      literal.motivo?.includes("40257") || literal.motivo?.includes("parâmetro");

    if (pareceParametro) {
      console.log(
        "\nA autenticação PASSOU — errno 40257 é parâmetro inválido, não\n" +
          "credencial recusada. A chave e a assinatura estão certas; o que a\n" +
          "FoxESS não aceitou foi o corpo da requisição.\n",
      );
    } else {
      console.log(
        "\nNenhum dos dois passou, e o erro é de credencial. Em ordem:\n" +
          "  1. a chave foi copiada incompleta — ela aparece uma vez só e\n" +
          "     costuma ser truncada quando se troca de tela antes de copiar;\n" +
          "  2. a chave é de outra região do FoxCloud;\n" +
          "  3. a conta Agent não tem permissão de API.\n",
      );
    }
    process.exit(1);
  }

  console.log(`\nAssinatura correta: ${vencedor.rotulo}\n`);

  const cliente = vencedor.cliente;

  const usinas = await cliente.listarUsinas(1, 100);
  const listaUsinas = (usinas.result as { data?: Record<string, unknown>[] })?.data ?? [];
  console.log(`Usinas: ${listaUsinas.length}`);
  if (listaUsinas[0]) {
    console.log("Campos disponíveis na usina:");
    console.log("  " + Object.keys(listaUsinas[0]).sort().join(", "));
  }

  await new Promise((r) => setTimeout(r, 1200));

  const dispositivos = await cliente.listarDispositivos(1, 100);
  const listaDisp =
    (dispositivos.result as { data?: Record<string, unknown>[] })?.data ?? [];
  console.log(`\nDispositivos: ${listaDisp.length}`);
  if (listaDisp[0]) {
    console.log("Campos disponíveis no dispositivo:");
    console.log("  " + Object.keys(listaDisp[0]).sort().join(", "));
  }

  const destino = "probe-foxess.json";
  writeFileSync(destino, JSON.stringify({ usinas, dispositivos }, null, 2));
  console.log(`\nRespostas cruas em ${destino} (está no .gitignore).`);
  process.exit(0);
}

main().catch((erro) => {
  console.error("\nFalhou:", erro instanceof Error ? erro.message : erro);
  process.exit(1);
});
