-- O documento passa a pertencer à venda, e a saber em que pé está.
--
-- Três buracos do modelo anterior, todos medidos no Drive real da BB:
--
--   1. O documento pendurava no cliente, não na venda. O Drive já está
--      organizado por projeto — 1.640 dos 2.788 arquivos estão dentro de uma
--      subpasta `PE ...` — e a importação achatava isso. Com pastas
--      `PE Aumento GD` existindo, que é venda nova no mesmo cliente, os dois
--      projetos dividiam uma pilha só e ninguém sabia qual ART era de qual.
--
--   2. Assinatura e versão viviam no nome do arquivo. 98 dos 416 "projetos
--      elétricos" são `.dwg`, 29 dos 238 "memoriais" são planilha, e 9 clientes
--      tinham como único memorial o `.xlsm` do engenheiro — todos contados
--      como documentação em dia.
--
--   3. Não havia quem subiu nem quem baixou, numa tabela com CNH, RG, CPF e
--      conta de luz de 169 pessoas.

CREATE TYPE "public"."status_documento" AS ENUM (
  'indefinido', 'trabalho', 'aguardando_assinatura', 'assinado'
);

CREATE TYPE "public"."acao_documento" AS ENUM (
  'visualizou', 'baixou', 'enviou', 'removeu'
);

ALTER TABLE "documento"
  ADD COLUMN IF NOT EXISTS "projeto_id" uuid REFERENCES "projeto"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "status" "status_documento" NOT NULL DEFAULT 'indefinido',
  ADD COLUMN IF NOT EXISTS "versao" integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "criado_por" uuid REFERENCES "usuario"("id") ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS "documento_projeto_idx" ON "documento" ("projeto_id", "tipo");

-- Trilha de auditoria. `documento_id` é SET NULL e não CASCADE de propósito:
-- auditoria que some junto com o objeto auditado não é auditoria, por isso a
-- descrição do arquivo fica copiada em texto.
CREATE TABLE IF NOT EXISTS "documento_acesso" (
  "id"           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "empresa_id"   uuid NOT NULL REFERENCES "empresa"("id") ON DELETE CASCADE,
  "documento_id" uuid REFERENCES "documento"("id") ON DELETE SET NULL,
  "descricao"    text NOT NULL,
  "usuario_id"   uuid REFERENCES "usuario"("id") ON DELETE SET NULL,
  "acao"         "acao_documento" NOT NULL,
  "ocorrido_em"  timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "documento_acesso_doc_idx"
  ON "documento_acesso" ("documento_id", "ocorrido_em");
CREATE INDEX IF NOT EXISTS "documento_acesso_usuario_idx"
  ON "documento_acesso" ("usuario_id", "ocorrido_em");

-- A partir de qual etapa cada documento é exigido.
--
-- Tabela e não código, pelo mesmo motivo de `etapa`: o fluxo é da empresa e
-- mudar a regra precisa ser conversa virando dado, não migration. É isto que
-- impede a tela de gritar à toa — quem fechou contrato semana passada não
-- deve aparecer em vermelho por não ter ART.
CREATE TABLE IF NOT EXISTS "exigencia_documento" (
  "id"               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "empresa_id"       uuid NOT NULL REFERENCES "empresa"("id") ON DELETE CASCADE,
  "tipo"             "tipo_documento" NOT NULL,
  "etapa_id"         uuid NOT NULL REFERENCES "etapa"("id") ON DELETE RESTRICT,
  "obrigatorio"      boolean NOT NULL DEFAULT true,
  "exige_assinatura" boolean NOT NULL DEFAULT false,
  "observacao"       text
);

CREATE UNIQUE INDEX IF NOT EXISTS "exigencia_documento_uq"
  ON "exigencia_documento" ("empresa_id", "tipo");
