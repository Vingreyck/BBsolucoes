-- Estoque (pedido de 26/11/2026): saldo por item, entrada pela nota fiscal ou
-- pelo pedido do fornecedor (XML lido direto, foto e PDF lidos pela Groq) e
-- baixa sozinha quando o técnico registra o material usado na OS.
--
-- Um depósito só, e o saldo pode ficar negativo (o técnico não trava em campo
-- porque a nota ainda não foi lançada): a tela marca em vermelho.
--
-- O saldo é a soma dos movimentos. Nada se apaga: corrigir a OS ou cancelá-la
-- grava um estorno, e o histórico mostra as duas linhas.
--
-- Aplicada pelo `npm run migrar` (ou ./scripts/deploy.sh). Pode rodar de novo.

-- Cada coisa que a empresa guarda na prateleira: módulo, inversor, cabo,
-- conector, estrutura. Pode apontar para o modelo do catálogo de equipamentos.
CREATE TABLE IF NOT EXISTS "item_estoque" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "empresa_id" uuid NOT NULL REFERENCES "empresa"("id") ON DELETE CASCADE,
  "nome" text NOT NULL,
  -- O nome sem acento, caixa e pontuação: é o que impede dois "Cabo solar 6mm".
  "chave" text NOT NULL,
  -- O código do fornecedor (cProd da nota), para reconhecer o item na próxima nota.
  "codigo" text,
  "unidade" varchar(10) NOT NULL DEFAULT 'un',
  "modelo_equipamento_id" uuid REFERENCES "modelo_equipamento"("id") ON DELETE SET NULL,
  -- Abaixo disto a tela avisa que está acabando. Nulo: sem aviso.
  "minimo" numeric(12, 3),
  "ativo" boolean NOT NULL DEFAULT true,
  "criado_em" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "item_estoque_chave_uq" ON "item_estoque" ("empresa_id", "chave");

-- Uma compra que chegou: a nota fiscal e/ou o pedido. Nasce como rascunho com
-- os itens lidos; só mexe no saldo quando alguém confere e lança.
CREATE TABLE IF NOT EXISTS "entrada_estoque" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "empresa_id" uuid NOT NULL REFERENCES "empresa"("id") ON DELETE CASCADE,
  -- rascunho | lancada | desfeita
  "situacao" varchar(12) NOT NULL DEFAULT 'rascunho',
  "numero" text,
  "fornecedor" text,
  "cnpj_fornecedor" varchar(14),
  "emitida_em" date,
  -- A chave de 44 dígitos da NF-e: a mesma nota não entra duas vezes.
  "chave_acesso" varchar(44),
  "valor_total" numeric(14, 2),
  -- xml | ia | manual
  "leitura" varchar(10),
  -- O que a leitura avisou ("a Groq limitou", "o kit veio na observação").
  "aviso" text,
  "itens_lidos" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "criado_por" uuid REFERENCES "usuario"("id") ON DELETE SET NULL,
  "criado_em" timestamptz NOT NULL DEFAULT now(),
  "lancada_por" uuid REFERENCES "usuario"("id") ON DELETE SET NULL,
  "lancada_em" timestamptz,
  "desfeita_por" uuid REFERENCES "usuario"("id") ON DELETE SET NULL,
  "desfeita_em" timestamptz
);
CREATE INDEX IF NOT EXISTS "entrada_estoque_empresa_idx" ON "entrada_estoque" ("empresa_id", "criado_em");
CREATE UNIQUE INDEX IF NOT EXISTS "entrada_estoque_chave_uq"
  ON "entrada_estoque" ("empresa_id", "chave_acesso")
  WHERE "chave_acesso" IS NOT NULL AND "situacao" = 'lancada';

-- Os arquivos da entrada (nota e pedido), guardados no Drive como o dossiê.
CREATE TABLE IF NOT EXISTS "entrada_estoque_arquivo" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "empresa_id" uuid NOT NULL REFERENCES "empresa"("id") ON DELETE CASCADE,
  "entrada_id" uuid NOT NULL REFERENCES "entrada_estoque"("id") ON DELETE CASCADE,
  -- nota | pedido
  "papel" varchar(10) NOT NULL,
  "nome" text NOT NULL,
  "mime" varchar(100) NOT NULL,
  "tamanho" integer,
  "drive_id" text,
  "drive_link" text,
  "criado_em" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "entrada_estoque_arquivo_entrada_idx" ON "entrada_estoque_arquivo" ("entrada_id");

-- O material que o técnico registrou como usado na OS (site ou app).
-- O item não se apaga enquanto houver material ou movimento dele (NO ACTION,
-- o padrão: ainda deixa apagar a empresa inteira em cascata). Item que saiu de
-- linha fica "fora da lista" (ativo = false).
CREATE TABLE IF NOT EXISTS "os_material" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "empresa_id" uuid NOT NULL REFERENCES "empresa"("id") ON DELETE CASCADE,
  "ordem_servico_id" uuid NOT NULL REFERENCES "ordem_servico"("id") ON DELETE CASCADE,
  "item_id" uuid NOT NULL REFERENCES "item_estoque"("id"),
  "quantidade" numeric(12, 3) NOT NULL CHECK ("quantidade" > 0),
  "observacao" text,
  "registrado_por" uuid REFERENCES "usuario"("id") ON DELETE SET NULL,
  "registrado_em" timestamptz NOT NULL DEFAULT now(),
  -- Id gerado no celular: o reenvio da fila do app não duplica o material.
  "id_cliente" varchar(64)
);
CREATE INDEX IF NOT EXISTS "os_material_os_idx" ON "os_material" ("ordem_servico_id");
CREATE UNIQUE INDEX IF NOT EXISTS "os_material_id_cliente_uq"
  ON "os_material" ("empresa_id", "id_cliente") WHERE "id_cliente" IS NOT NULL;

-- O livro do estoque: cada entrada, saída, ajuste e estorno. O saldo é a soma.
CREATE TABLE IF NOT EXISTS "movimento_estoque" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "empresa_id" uuid NOT NULL REFERENCES "empresa"("id") ON DELETE CASCADE,
  "item_id" uuid NOT NULL REFERENCES "item_estoque"("id"),
  -- Positivo entra, negativo sai.
  "quantidade" numeric(12, 3) NOT NULL,
  -- entrada | ajuste | os | estorno
  "motivo" varchar(10) NOT NULL,
  "entrada_id" uuid REFERENCES "entrada_estoque"("id") ON DELETE SET NULL,
  "ordem_servico_id" uuid REFERENCES "ordem_servico"("id") ON DELETE SET NULL,
  "observacao" text,
  "usuario_id" uuid REFERENCES "usuario"("id") ON DELETE SET NULL,
  -- web | app | sistema
  "origem" varchar(10) NOT NULL DEFAULT 'web',
  "criado_em" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "movimento_estoque_item_idx" ON "movimento_estoque" ("item_id", "criado_em");
CREATE INDEX IF NOT EXISTS "movimento_estoque_empresa_idx" ON "movimento_estoque" ("empresa_id", "criado_em");
CREATE INDEX IF NOT EXISTS "movimento_estoque_os_idx"
  ON "movimento_estoque" ("ordem_servico_id") WHERE "ordem_servico_id" IS NOT NULL;
