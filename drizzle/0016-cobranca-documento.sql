-- Registro de cada cobrança de documento feita ao cliente (pelo WhatsApp).
--
-- Aplicada pelo `npm run migrar` (ou ./scripts/deploy.sh). Pode rodar de novo.

CREATE TABLE IF NOT EXISTS "cobranca_documento" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "empresa_id" uuid NOT NULL REFERENCES "empresa"("id") ON DELETE CASCADE,
  "projeto_id" uuid NOT NULL REFERENCES "projeto"("id") ON DELETE CASCADE,
  "cliente_id" uuid NOT NULL REFERENCES "cliente"("id") ON DELETE CASCADE,
  "tipos" text[] NOT NULL,
  "canal" varchar(20) NOT NULL DEFAULT 'whatsapp',
  "usuario_id" uuid REFERENCES "usuario"("id") ON DELETE SET NULL,
  "criado_em" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "cobranca_documento_projeto_idx" ON "cobranca_documento" ("projeto_id", "criado_em");
