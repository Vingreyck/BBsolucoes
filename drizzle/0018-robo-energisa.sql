-- Robô do portal de projetos da Energisa (AWGPE): o retrato da lista de
-- projetos, o vínculo com o projeto do Selebi e o estado do robô.
--
-- Aplicada pelo `npm run migrar` (ou ./scripts/deploy.sh). Pode rodar de novo.

CREATE TABLE IF NOT EXISTS "energisa_projeto" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "empresa_id" uuid NOT NULL REFERENCES "empresa"("id") ON DELETE CASCADE,
  "numero" varchar(20) NOT NULL,
  "empreendimento" text NOT NULL,
  "endereco" text,
  "tipo" text,
  "data_abertura" timestamptz,
  "codigo_situacao" varchar(4),
  "descricao_situacao" text,
  "fase" varchar(30) NOT NULL,
  "situacao_desde" timestamptz NOT NULL DEFAULT now(),
  "projeto_id" uuid REFERENCES "projeto"("id") ON DELETE SET NULL,
  "vinculo" varchar(12),
  "aplicado_codigo" varchar(4),
  "visto_em" timestamptz NOT NULL DEFAULT now(),
  "criado_em" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "energisa_projeto_numero_uq" ON "energisa_projeto" ("empresa_id", "numero");
CREATE INDEX IF NOT EXISTS "energisa_projeto_projeto_idx" ON "energisa_projeto" ("projeto_id");

CREATE TABLE IF NOT EXISTS "robo_energisa" (
  "empresa_id" uuid PRIMARY KEY REFERENCES "empresa"("id") ON DELETE CASCADE,
  "estado" varchar(20) NOT NULL DEFAULT 'parado',
  "mensagem" text,
  "ultima_leitura_em" timestamptz,
  "total_projetos" integer,
  "pedido" varchar(10),
  "pedido_por_id" uuid REFERENCES "usuario"("id") ON DELETE SET NULL,
  "codigo" varchar(12),
  "codigo_em" timestamptz,
  "atualizado_em" timestamptz NOT NULL DEFAULT now()
);
