import "dotenv/config";

import { existsSync } from "node:fs";

import { decifrar, senhaDoBackup } from "./cofre-backup";

/**
 * Abre uma cópia cifrada que veio do Drive (`selebi-….sql.gz.cifrado`).
 *
 * É o primeiro passo de uma restauração depois de perder a VM: baixe o arquivo
 * da pasta "Backups do Selebi (cifrados)" do Drive da empresa e rode, em
 * qualquer máquina com o repositório e o Node:
 *
 *   BACKUP_SENHA='a senha do cofre' npm run backup:abrir -- selebi-2026-10-28-0700.sql.gz.cifrado
 *
 * Sai o `.sql.gz` ao lado, pronto para o `gunzip -c … | psql` de sempre.
 */

async function main() {
  const origem = process.argv[2];
  if (!origem || !existsSync(origem)) {
    console.error("Diga qual arquivo abrir: npm run backup:abrir -- caminho/selebi-….sql.gz.cifrado");
    process.exit(1);
  }
  const senha = senhaDoBackup();
  if (!senha) {
    console.error("Falta a BACKUP_SENHA (a do cofre de senhas), no .env ou na frente do comando.");
    process.exit(1);
  }
  const destino = process.argv[3] ?? origem.replace(/\.cifrado$/, "");
  if (destino === origem) {
    console.error("O arquivo não termina em .cifrado; diga o destino: npm run backup:abrir -- origem destino");
    process.exit(1);
  }

  await decifrar(origem, destino, senha);
  console.log(`Aberto: ${destino}`);
  console.log(
    "\nPara restaurar num banco vazio:\n" +
      `  gunzip -c ${destino} | docker compose exec -T db psql -U postgres -d bbsolucoes -v ON_ERROR_STOP=1`,
  );
}

main().catch((erro) => {
  console.error("Falhou:", erro instanceof Error ? erro.message : erro);
  process.exit(1);
});
