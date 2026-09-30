-- A ordem de serviço completa: ligada à venda, com histórico, checklist com
-- resposta de verdade, modelo por tipo, anexos rastreados e relatório para o
-- cliente.
--
-- Aplicada à mão, como as outras (psql sem BEGIN: o ADD VALUE do enum precisa
-- ser confirmado antes de alguém usar o valor novo):
--
--   docker compose exec -T db psql -U postgres -d bbsolucoes -v ON_ERROR_STOP=1 < drizzle/0012-ordem-servico.sql
--
-- Pode rodar de novo sem estragar nada: tudo é IF NOT EXISTS.

-- 1. O técnico saiu para o endereço. É o "Deslocamento" do IXC: o escritório
--    vê quem está a caminho, e o tempo de estrada deixa de se misturar com o
--    tempo de serviço.
ALTER TYPE "status_os" ADD VALUE IF NOT EXISTS 'em_deslocamento' BEFORE 'em_andamento';

-- 2. A OS
ALTER TABLE "ordem_servico" ADD COLUMN IF NOT EXISTS "projeto_id" uuid REFERENCES "projeto" ("id") ON DELETE SET NULL;
ALTER TABLE "ordem_servico" ADD COLUMN IF NOT EXISTS "os_origem_id" uuid REFERENCES "ordem_servico" ("id") ON DELETE SET NULL;
ALTER TABLE "ordem_servico" ADD COLUMN IF NOT EXISTS "resultado" varchar(20);
ALTER TABLE "ordem_servico" ADD COLUMN IF NOT EXISTS "assinatura_nome" text;
ALTER TABLE "ordem_servico" ADD COLUMN IF NOT EXISTS "relatorio_token" varchar(64);
ALTER TABLE "ordem_servico" ADD COLUMN IF NOT EXISTS "cancelada_em" timestamptz;
ALTER TABLE "ordem_servico" ADD COLUMN IF NOT EXISTS "atualizado_em" timestamptz NOT NULL DEFAULT now();
CREATE UNIQUE INDEX IF NOT EXISTS "os_relatorio_token_uq" ON "ordem_servico" ("relatorio_token") WHERE "relatorio_token" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "os_projeto_idx" ON "ordem_servico" ("projeto_id");
CREATE INDEX IF NOT EXISTS "os_agenda_idx" ON "ordem_servico" ("empresa_id", "agendada_para");

-- 3. O item do checklist passa a ter tipo de resposta e a guardar a resposta
ALTER TABLE "os_checklist_item" ADD COLUMN IF NOT EXISTS "secao" text;
ALTER TABLE "os_checklist_item" ADD COLUMN IF NOT EXISTS "ajuda" text;
ALTER TABLE "os_checklist_item" ADD COLUMN IF NOT EXISTS "tipo_resposta" varchar(20) NOT NULL DEFAULT 'check';
ALTER TABLE "os_checklist_item" ADD COLUMN IF NOT EXISTS "opcoes" jsonb;
ALTER TABLE "os_checklist_item" ADD COLUMN IF NOT EXISTS "unidade" varchar(20);
ALTER TABLE "os_checklist_item" ADD COLUMN IF NOT EXISTS "fotos_minimas" integer NOT NULL DEFAULT 0;
ALTER TABLE "os_checklist_item" ADD COLUMN IF NOT EXISTS "apenas_camera" boolean NOT NULL DEFAULT false;
ALTER TABLE "os_checklist_item" ADD COLUMN IF NOT EXISTS "tipo_documento" "tipo_documento";
ALTER TABLE "os_checklist_item" ADD COLUMN IF NOT EXISTS "chave" varchar(60);
ALTER TABLE "os_checklist_item" ADD COLUMN IF NOT EXISTS "valor" jsonb;
ALTER TABLE "os_checklist_item" ADD COLUMN IF NOT EXISTS "respondido_por_id" uuid REFERENCES "usuario" ("id") ON DELETE SET NULL;
ALTER TABLE "os_checklist_item" ADD COLUMN IF NOT EXISTS "respondido_em" timestamptz;

-- 4. O anexo sabe de qual item é, onde foi tirado e se virou documento do dossiê
ALTER TABLE "os_anexo" ADD COLUMN IF NOT EXISTS "checklist_item_id" uuid REFERENCES "os_checklist_item" ("id") ON DELETE SET NULL;
ALTER TABLE "os_anexo" ADD COLUMN IF NOT EXISTS "id_cliente" uuid;
ALTER TABLE "os_anexo" ADD COLUMN IF NOT EXISTS "mime" varchar(100);
ALTER TABLE "os_anexo" ADD COLUMN IF NOT EXISTS "drive_id" varchar(100);
ALTER TABLE "os_anexo" ADD COLUMN IF NOT EXISTS "latitude" numeric(10, 7);
ALTER TABLE "os_anexo" ADD COLUMN IF NOT EXISTS "longitude" numeric(10, 7);
ALTER TABLE "os_anexo" ADD COLUMN IF NOT EXISTS "documento_id" uuid REFERENCES "documento" ("id") ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "os_anexo_id_cliente_uq" ON "os_anexo" ("empresa_id", "id_cliente") WHERE "id_cliente" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "os_anexo_item_idx" ON "os_anexo" ("checklist_item_id");

-- 5. O histórico da OS: quem fez o quê, quando, de onde e por quê
CREATE TABLE IF NOT EXISTS "os_evento" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "empresa_id" uuid NOT NULL REFERENCES "empresa" ("id") ON DELETE CASCADE,
  "ordem_servico_id" uuid NOT NULL REFERENCES "ordem_servico" ("id") ON DELETE CASCADE,
  "tipo" varchar(30) NOT NULL,
  "usuario_id" uuid REFERENCES "usuario" ("id") ON DELETE SET NULL,
  "origem" varchar(10) NOT NULL DEFAULT 'web',
  "ocorrido_em" timestamptz NOT NULL DEFAULT now(),
  "registrado_em" timestamptz NOT NULL DEFAULT now(),
  "latitude" numeric(10, 7),
  "longitude" numeric(10, 7),
  "precisao_m" integer,
  "dados" jsonb,
  "id_cliente" uuid
);
CREATE INDEX IF NOT EXISTS "os_evento_os_idx" ON "os_evento" ("ordem_servico_id", "ocorrido_em");
CREATE UNIQUE INDEX IF NOT EXISTS "os_evento_id_cliente_uq" ON "os_evento" ("empresa_id", "id_cliente") WHERE "id_cliente" IS NOT NULL;

-- A OS que já existia ganha o evento de criação, para o histórico não começar
-- no meio.
INSERT INTO "os_evento" ("empresa_id", "ordem_servico_id", "tipo", "usuario_id", "origem", "ocorrido_em", "registrado_em")
SELECT o."empresa_id", o."id", 'criada', o."aberta_por_id", 'sistema', o."criado_em", o."criado_em"
FROM "ordem_servico" o
WHERE NOT EXISTS (
  SELECT 1 FROM "os_evento" e WHERE e."ordem_servico_id" = o."id" AND e."tipo" = 'criada'
);

-- 6. O modelo de cada tipo de OS — o "assunto" do IXC: checklist padrão,
--    prazo, se exige assinatura e qual etapa da esteira a OS cumpre.
CREATE TABLE IF NOT EXISTS "modelo_os" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "empresa_id" uuid NOT NULL REFERENCES "empresa" ("id") ON DELETE CASCADE,
  "tipo" "tipo_os" NOT NULL,
  "nome" text NOT NULL,
  "instrucoes" text,
  "prazo_horas" integer,
  "exige_assinatura" boolean NOT NULL DEFAULT false,
  "etapa_slug" varchar(40),
  "atualizado_em" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "modelo_os_tipo_uq" ON "modelo_os" ("empresa_id", "tipo");

CREATE TABLE IF NOT EXISTS "modelo_os_item" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "empresa_id" uuid NOT NULL REFERENCES "empresa" ("id") ON DELETE CASCADE,
  "modelo_id" uuid NOT NULL REFERENCES "modelo_os" ("id") ON DELETE CASCADE,
  "ordem" integer NOT NULL DEFAULT 0,
  "secao" text,
  "descricao" text NOT NULL,
  "ajuda" text,
  "tipo_resposta" varchar(20) NOT NULL DEFAULT 'check',
  "opcoes" jsonb,
  "unidade" varchar(20),
  "obrigatorio" boolean NOT NULL DEFAULT false,
  "fotos_minimas" integer NOT NULL DEFAULT 0,
  "apenas_camera" boolean NOT NULL DEFAULT false,
  "tipo_documento" "tipo_documento",
  "chave" varchar(60)
);
CREATE INDEX IF NOT EXISTS "modelo_os_item_modelo_idx" ON "modelo_os_item" ("modelo_id", "ordem");

-- 7. As notas da OS (a tabela `comentario`, a mesma do site) também saem do
--    app, escritas sem sinal: o id dado pelo celular impede a nota repetida.
ALTER TABLE "comentario" ADD COLUMN IF NOT EXISTS "id_cliente" uuid;
CREATE UNIQUE INDEX IF NOT EXISTS "comentario_id_cliente_uq" ON "comentario" ("empresa_id", "id_cliente") WHERE "id_cliente" IS NOT NULL;
