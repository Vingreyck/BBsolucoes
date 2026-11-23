-- Proposta comercial completa, no fluxo do Solarz e com o que ele não tem
-- (pedido de 23/11/2026): várias unidades consumidoras com rateio, consumo mês
-- a mês, tarifa e Fio B buscados na ANEEL, sol da cidade (Atlas do INPE), kit
-- montado da base de equipamentos da ANEEL, custos e margem, formas de
-- pagamento simuladas e o link que conta quantas vezes o cliente abriu.
--
-- Aplicada pelo `npm run migrar` (ou ./scripts/deploy.sh). Pode rodar de novo.

-- O assistente da proposta guarda aqui o que já foi preenchido: dá para parar
-- no meio e continuar depois, de outro computador.
ALTER TABLE "projeto" ADD COLUMN IF NOT EXISTS "proposta_rascunho" jsonb;

-- Quantas vezes o link da proposta foi aberto, e quando (o PDF público /r/p/).
ALTER TABLE "proposta" ADD COLUMN IF NOT EXISTS "visualizacoes" integer NOT NULL DEFAULT 0;
ALTER TABLE "proposta" ADD COLUMN IF NOT EXISTS "primeira_visualizacao_em" timestamptz;
ALTER TABLE "proposta" ADD COLUMN IF NOT EXISTS "ultima_visualizacao_em" timestamptz;

-- O catálogo da empresa ligado à base pública de equipamentos, com o preço de
-- custo e os dados técnicos (tensão, corrente, entradas do micro…).
ALTER TABLE "modelo_equipamento" ADD COLUMN IF NOT EXISTS "base_id" text;
ALTER TABLE "modelo_equipamento" ADD COLUMN IF NOT EXISTS "preco_custo" numeric(12, 2);
ALTER TABLE "modelo_equipamento" ADD COLUMN IF NOT EXISTS "especificacoes" jsonb;
CREATE UNIQUE INDEX IF NOT EXISTS "modelo_equipamento_base_uq"
  ON "modelo_equipamento" ("empresa_id", "base_id") WHERE "base_id" IS NOT NULL;

-- A tarifa de cada distribuidora como a ANEEL homologou (TE, TUSD e o Fio B
-- da TUSD), sem impostos, em R$/kWh. É cache: a fonte é a API de dados abertos
-- da ANEEL, e quando ela não responde vale a última guardada.
CREATE TABLE IF NOT EXISTS "tarifa_distribuidora" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "cnpj" varchar(14) NOT NULL,
  "subgrupo" varchar(4) NOT NULL,
  "te" numeric(10, 6) NOT NULL,
  "tusd" numeric(10, 6) NOT NULL,
  "fio_b" numeric(10, 6),
  "vigencia_inicio" date NOT NULL,
  "vigencia_fim" date,
  "resolucao" text,
  "buscado_em" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "tarifa_distribuidora_uq"
  ON "tarifa_distribuidora" ("cnpj", "subgrupo", "vigencia_inicio");
