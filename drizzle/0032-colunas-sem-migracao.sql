-- Colunas que o código usa desde o começo, mas que nunca entraram numa
-- migração (achado de 26/11/2026, ao montar um banco do zero para testar o
-- estoque): foram criadas direto no banco de produção no início do projeto.
--
-- Em produção elas já existem, e esta migração não muda nada lá (IF NOT
-- EXISTS). Serve para o banco que nasce só das migrações — servidor novo,
-- restauração do zero, banco de teste —, que sem isto quebrava na tela da OS e
-- do projeto ("column usina.cadastro_passo does not exist").
--
-- Só acrescenta. Ficaram de fora, de propósito, as outras diferenças que o
-- drizzle-kit aponta (tipo_documento como texto e não enum; índices com nome
-- diferente): mexer em tipo ou apagar índice sem ver como está em produção é
-- arriscado, e o sistema funciona com elas como estão.
--
-- Aplicada pelo `npm run migrar` (ou ./scripts/deploy.sh). Pode rodar de novo.

-- A ficha de cadastro de usina em cinco passos: em que passo parou.
ALTER TABLE "usina" ADD COLUMN IF NOT EXISTS "cadastro_passo" integer NOT NULL DEFAULT 5;
-- Pasta do cliente no Drive e o que a vistoria anotou na ficha.
ALTER TABLE "usina" ADD COLUMN IF NOT EXISTS "link_drive" text;
ALTER TABLE "usina" ADD COLUMN IF NOT EXISTS "observacoes_vistoria" text;

-- O que o projeto guarda da venda e da vistoria.
ALTER TABLE "projeto" ADD COLUMN IF NOT EXISTS "consumo_medio_kwh" numeric(10, 2);
ALTER TABLE "projeto" ADD COLUMN IF NOT EXISTS "concessionaria" text;
ALTER TABLE "projeto" ADD COLUMN IF NOT EXISTS "observacoes" text;
ALTER TABLE "projeto" ADD COLUMN IF NOT EXISTS "vistoria_em" timestamp;
ALTER TABLE "projeto" ADD COLUMN IF NOT EXISTS "vistoria_por_id" uuid REFERENCES "usuario"("id") ON DELETE SET NULL;
ALTER TABLE "projeto" ADD COLUMN IF NOT EXISTS "vistoria_observacoes" text;
ALTER TABLE "projeto" ADD COLUMN IF NOT EXISTS "numero_art" text;
