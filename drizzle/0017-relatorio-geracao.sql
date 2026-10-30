-- Relatório mensal de geração: o link público de cada usina por mês e o registro do envio.
--
-- Aplicada pelo `npm run migrar` (ou ./scripts/deploy.sh). Pode rodar de novo.

CREATE TABLE IF NOT EXISTS "relatorio_geracao" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "empresa_id" uuid NOT NULL REFERENCES "empresa"("id") ON DELETE CASCADE,
  "usina_id" uuid NOT NULL REFERENCES "usina"("id") ON DELETE CASCADE,
  "mes" varchar(7) NOT NULL,
  "token" varchar(64) NOT NULL,
  "enviado_em" timestamptz,
  "enviado_por_id" uuid REFERENCES "usuario"("id") ON DELETE SET NULL,
  "envios" integer NOT NULL DEFAULT 0,
  "criado_em" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "relatorio_geracao_usina_mes_uq" ON "relatorio_geracao" ("usina_id", "mes");
CREATE UNIQUE INDEX IF NOT EXISTS "relatorio_geracao_token_uq" ON "relatorio_geracao" ("token");
