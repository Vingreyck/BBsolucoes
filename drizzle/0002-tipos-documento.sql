-- Tipos de documento que apareceram na listagem completa do Drive.
--
-- ALTER TYPE ... ADD VALUE não roda dentro de transação no Postgres, e por isso
-- cada um vai numa instrução própria. O IF NOT EXISTS deixa reexecutar.
ALTER TYPE "public"."tipo_documento" ADD VALUE IF NOT EXISTS 'uc_beneficiaria';
ALTER TYPE "public"."tipo_documento" ADD VALUE IF NOT EXISTS 'compensativo';
ALTER TYPE "public"."tipo_documento" ADD VALUE IF NOT EXISTS 'nota_fiscal';
ALTER TYPE "public"."tipo_documento" ADD VALUE IF NOT EXISTS 'ficha_cadastral';
ALTER TYPE "public"."tipo_documento" ADD VALUE IF NOT EXISTS 'datasheet';
ALTER TYPE "public"."tipo_documento" ADD VALUE IF NOT EXISTS 'comprovante';
ALTER TYPE "public"."tipo_documento" ADD VALUE IF NOT EXISTS 'declaracao';
ALTER TYPE "public"."tipo_documento" ADD VALUE IF NOT EXISTS 'orcamento';
