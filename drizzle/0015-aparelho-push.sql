-- Aparelhos que aceitaram receber aviso (push) de OS atribuída, reagendada ou cancelada.
--
-- Aplicada pelo `npm run migrar` (ou ./scripts/deploy.sh). Pode rodar de novo.

CREATE TABLE IF NOT EXISTS "aparelho_push" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "usuario_id" uuid NOT NULL REFERENCES "usuario"("id") ON DELETE CASCADE,
  "sessao_id" varchar(64) NOT NULL REFERENCES "sessao"("id") ON DELETE CASCADE,
  "token" text NOT NULL,
  "plataforma" varchar(10) NOT NULL,
  "atualizado_em" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "aparelho_push_token_uq" ON "aparelho_push" ("token");
CREATE INDEX IF NOT EXISTS "aparelho_push_usuario_idx" ON "aparelho_push" ("usuario_id");
