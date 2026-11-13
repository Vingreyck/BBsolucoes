-- Catálogo de equipamentos com datasheet (pedido de 13/11/2026).
--
-- O datasheet e o certificado do Inmetro são do fabricante, e iguais para todo
-- cliente que usa o mesmo inversor ou o mesmo módulo. Então sobem uma vez só,
-- no catálogo (Administração → Equipamentos), e o projeto escolhe o inversor e
-- o módulo do kit: o dossiê recebe os dois arquivos sozinho.
--
-- O arquivo fica uma vez no Drive (pasta BIBLIOTECA DE EQUIPAMENTOS). O
-- documento de cada projeto aponta para ele, sem copiar; a coluna
-- `documento.modelo_equipamento_id` marca o que entrou pelo catálogo, para
-- trocar o modelo do projeto trocar também o anexo.
--
-- O projeto elétrico gerado pelo sistema (em estudo) deve usar este mesmo
-- catálogo para saber o inversor e o módulo.
--
-- Aplicada pelo `npm run migrar` (ou ./scripts/deploy.sh). Pode rodar de novo.

CREATE TABLE IF NOT EXISTS "modelo_equipamento" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "empresa_id" uuid NOT NULL REFERENCES "empresa"("id") ON DELETE CASCADE,
  "tipo" "tipo_equipamento" NOT NULL,
  "fabricante" text NOT NULL,
  "modelo" text NOT NULL,
  "potencia_w" numeric(12, 2),
  "datasheet_link" text,
  "datasheet_nome" text,
  "inmetro_link" text,
  "inmetro_nome" text,
  "ativo" boolean NOT NULL DEFAULT true,
  "criado_em" timestamptz NOT NULL DEFAULT now()
);

-- O mesmo modelo não entra duas vezes (sem diferença de maiúscula).
CREATE UNIQUE INDEX IF NOT EXISTS "modelo_equipamento_uq"
  ON "modelo_equipamento" ("empresa_id", "tipo", lower("fabricante"), lower("modelo"));

-- O kit do projeto: inversor e módulo do catálogo, com as quantidades.
ALTER TABLE "projeto" ADD COLUMN IF NOT EXISTS "inversor_modelo_id" uuid REFERENCES "modelo_equipamento"("id") ON DELETE SET NULL;
ALTER TABLE "projeto" ADD COLUMN IF NOT EXISTS "inversor_qtd" integer;
ALTER TABLE "projeto" ADD COLUMN IF NOT EXISTS "modulo_modelo_id" uuid REFERENCES "modelo_equipamento"("id") ON DELETE SET NULL;
ALTER TABLE "projeto" ADD COLUMN IF NOT EXISTS "modulo_qtd" integer;

-- Documento que entrou pelo catálogo (datasheet ou Inmetro de um modelo).
ALTER TABLE "documento" ADD COLUMN IF NOT EXISTS "modelo_equipamento_id" uuid REFERENCES "modelo_equipamento"("id") ON DELETE SET NULL;
