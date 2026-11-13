-- Contrato gerado pelo Selebi (pedido de 13/11/2026).
--
-- Na etapa "Contrato e procuração" o sistema monta o contrato de prestação de
-- serviços com os dados do cliente, do projeto e da empresa, e manda o link do
-- PDF ao cliente pelo WhatsApp. Quando a via assinada volta (sobe no dossiê),
-- a esteira anda sozinha.
--
-- `contrato.dados` guarda o que entrou no contrato no dia em que foi gerado: o
-- PDF que o cliente assinou não muda se alguém corrigir o cadastro depois.
--
-- Os dados da empresa (razão social, endereço, e-mail, logo) moram no banco e
-- não no código: o repositório é público e o sistema serve a mais de uma
-- empresa. Quem preenche é o adm, em Administração → Dados da empresa.
--
-- Aplicada pelo `npm run migrar` (ou ./scripts/deploy.sh). Pode rodar de novo.

ALTER TABLE "empresa" ADD COLUMN IF NOT EXISTS "razao_social" text;
ALTER TABLE "empresa" ADD COLUMN IF NOT EXISTS "endereco" text;
ALTER TABLE "empresa" ADD COLUMN IF NOT EXISTS "email" text;
-- A imagem do logo, como data URL (PNG ou JPEG, até 1 MB).
ALTER TABLE "empresa" ADD COLUMN IF NOT EXISTS "logo" text;

-- O objeto do contrato: inversores, módulos e estrutura.
ALTER TABLE "projeto" ADD COLUMN IF NOT EXISTS "equipamentos" text;

CREATE TABLE IF NOT EXISTS "contrato" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "empresa_id" uuid NOT NULL REFERENCES "empresa"("id") ON DELETE CASCADE,
  "projeto_id" uuid NOT NULL REFERENCES "projeto"("id") ON DELETE CASCADE,
  "token" varchar(64) NOT NULL,
  "dados" jsonb NOT NULL,
  "representante_id" uuid REFERENCES "usuario"("id") ON DELETE SET NULL,
  "criado_por_id" uuid REFERENCES "usuario"("id") ON DELETE SET NULL,
  "enviado_em" timestamptz,
  "criado_em" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "contrato_token_uq" ON "contrato" ("token");
CREATE INDEX IF NOT EXISTS "contrato_projeto_idx" ON "contrato" ("projeto_id", "criado_em");
