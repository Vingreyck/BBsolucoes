-- A chave do documento passa a incluir o caminho.
--
-- Com a varredura recursiva, o mesmo nome de arquivo pode existir em duas
-- subpastas do mesmo cliente — "Memorial_Assinado.pdf" solto e dentro de
-- "Documentos Assinados", por exemplo. Com a chave antiga, um sobrescreveria o
-- outro e o segundo sumiria.
--
-- `caminho` fica NOT NULL com default vazio de propósito: nulo não colide em
-- índice único no Postgres, e aí a proteção não valeria para os arquivos da
-- raiz, que são a maioria.
ALTER TABLE "documento" ALTER COLUMN "caminho" SET DEFAULT '';
UPDATE "documento" SET "caminho" = '' WHERE "caminho" IS NULL;
ALTER TABLE "documento" ALTER COLUMN "caminho" SET NOT NULL;

DROP INDEX IF EXISTS "documento_arquivo_uq";
CREATE UNIQUE INDEX IF NOT EXISTS "documento_arquivo_uq"
  ON "documento" USING btree ("cliente_id", "caminho", "nome_arquivo");
