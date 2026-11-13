-- Proposta comercial gerada pelo Selebi (pedido de 13/11/2026), no modelo que a
-- BB Soluções já usa: capa, passo a passo, sistema e garantias, geração e
-- finanças, monitoramento, investimento e pós-venda.
--
-- Na etapa Lead o sistema monta a proposta com os dados do cliente, do kit e da
-- vistoria, e manda o link do PDF ao cliente pelo WhatsApp. O cliente decide, e
-- "Aprovada" leva o projeto adiante.
--
-- `proposta.dados` guarda o que entrou na proposta no dia em que foi gerada
-- (preço, economia, validade): corrigir o cadastro ou as premissas depois não
-- muda o PDF que o cliente recebeu. O `numero` é sequencial por empresa.
--
-- `empresa.proposta_config` são as premissas do cálculo (tarifa, Fio B,
-- irradiação, desempenho…) e os textos de pagamento e garantia. Ficam no banco
-- porque o repositório é público; o adm confere e salva em Administração →
-- Proposta comercial. Sem isso salvo, o sistema não gera proposta.
--
-- Aplicada pelo `npm run migrar` (ou ./scripts/deploy.sh). Pode rodar de novo.

ALTER TABLE "empresa" ADD COLUMN IF NOT EXISTS "proposta_config" jsonb;

CREATE TABLE IF NOT EXISTS "proposta" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "empresa_id" uuid NOT NULL REFERENCES "empresa"("id") ON DELETE CASCADE,
  "projeto_id" uuid NOT NULL REFERENCES "projeto"("id") ON DELETE CASCADE,
  "numero" integer NOT NULL,
  "token" varchar(64) NOT NULL,
  "dados" jsonb NOT NULL,
  "criado_por_id" uuid REFERENCES "usuario"("id") ON DELETE SET NULL,
  "enviado_em" timestamptz,
  "criado_em" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "proposta_token_uq" ON "proposta" ("token");
CREATE UNIQUE INDEX IF NOT EXISTS "proposta_numero_uq" ON "proposta" ("empresa_id", "numero");
CREATE INDEX IF NOT EXISTS "proposta_projeto_idx" ON "proposta" ("projeto_id", "criado_em");
