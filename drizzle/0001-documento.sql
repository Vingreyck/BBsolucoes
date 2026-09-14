-- Só a parte nova da 0001: a tabela de documentos.
--
-- O arquivo que o drizzle-kit gerou traz junto colunas de `usina` e `projeto`
-- que já foram aplicadas à mão em agosto e setembro, quando o db:migrate travava
-- nesta máquina. Rodar aquele arquivo inteiro quebraria em "column already
-- exists" na primeira linha e deixaria o resto sem aplicar.
--
-- Este recorte é idempotente de propósito: pode rodar duas vezes.

DO $$ BEGIN
  CREATE TYPE "public"."tipo_documento" AS ENUM(
    'art', 'boleto_art', 'contrato', 'memorial', 'procuracao', 'recibo',
    'documento_pessoal', 'uc_geradora', 'projeto_eletrico', 'simulacao', 'outro'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "documento" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "empresa_id" uuid NOT NULL,
  "cliente_id" uuid NOT NULL,
  "tipo" "tipo_documento" NOT NULL,
  "nome_arquivo" text NOT NULL,
  "link_drive" text,
  "pasta_externa" varchar(80),
  "origem" varchar(40),
  "tamanho_bytes" integer,
  "modificado_em" timestamp,
  "criado_em" timestamp with time zone DEFAULT now() NOT NULL
);

DO $$ BEGIN
  ALTER TABLE "documento" ADD CONSTRAINT "documento_empresa_id_empresa_id_fk"
    FOREIGN KEY ("empresa_id") REFERENCES "public"."empresa"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "documento" ADD CONSTRAINT "documento_cliente_id_cliente_id_fk"
    FOREIGN KEY ("cliente_id") REFERENCES "public"."cliente"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "documento_cliente_idx"
  ON "documento" USING btree ("cliente_id", "tipo");

CREATE UNIQUE INDEX IF NOT EXISTS "documento_arquivo_uq"
  ON "documento" USING btree ("cliente_id", "nome_arquivo");
