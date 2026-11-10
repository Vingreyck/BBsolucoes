-- Recomeço da operação: a empresa começa do zero com os clientes novos.
--
-- `empresa.recomeco_em`: quando o recomeço foi feito (npm run recomecar).
-- `usina.arquivada_em`: usina do tempo de antes, que segue coletando para
-- análise mas sai das telas, dos alertas, da OS automática e do relatório.
--
-- Aplicada pelo `npm run migrar` (ou ./scripts/deploy.sh). Pode rodar de novo.

ALTER TABLE "empresa" ADD COLUMN IF NOT EXISTS "recomeco_em" timestamptz;
ALTER TABLE "usina" ADD COLUMN IF NOT EXISTS "arquivada_em" timestamptz;
CREATE INDEX IF NOT EXISTS "usina_ativa_idx" ON "usina" ("empresa_id") WHERE "arquivada_em" IS NULL;
