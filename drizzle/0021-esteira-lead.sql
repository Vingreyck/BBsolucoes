-- Esteira enxuta no começo (pedido de 13/11/2026).
--
-- "Coleta de informações", "Proposta comercial" e "Forma de pagamento" deixam de
-- ser etapas: tudo isso acontece no Lead. O card do Lead tem "Aprovada" (a
-- proposta foi aceita: o projeto anda) e "Reprovada" (o projeto é excluído).
-- Logo depois do Lead entra "Aguardando OS de vistoria", com o botão que abre a
-- OS de vistoria; abrir a OS leva o projeto para "Vistoria técnica" sozinho.
--
-- As três etapas são desativadas, não apagadas: o histórico (projeto_evento) e
-- as exigências de documento continuam apontando para elas.
--
-- Aplicada pelo `npm run migrar` (ou ./scripts/deploy.sh). Pode rodar de novo.

-- A forma de pagamento que o cliente aceitou, editável depois na tela do projeto.
ALTER TABLE "projeto" ADD COLUMN IF NOT EXISTS "forma_pagamento" varchar(30);
ALTER TABLE "projeto" ADD COLUMN IF NOT EXISTS "pagamento_condicoes" text;

-- A etapa nova, em toda empresa que tem esteira.
INSERT INTO "etapa" ("empresa_id", "slug", "nome", "ordem", "descricao", "papel_responsavel")
SELECT e."empresa_id", 'aguardando_vistoria', 'Aguardando OS de vistoria', 45,
       'Proposta aprovada. Falta abrir a OS de vistoria técnica: ao abrir, o projeto vai sozinho para a Vistoria técnica.',
       'adm'::papel_usuario
FROM "etapa" e
WHERE e."slug" = 'lead'
ON CONFLICT ("empresa_id", "slug") DO NOTHING;

-- O Lead passa a englobar as três.
UPDATE "etapa"
SET "nome" = 'Lead',
    "descricao" = 'Entrada do cliente, informações, proposta comercial e forma de pagamento. Aprovada, o projeto avança; reprovada, é excluído.'
WHERE "slug" = 'lead';

-- Projeto parado numa das três volta para o Lead: aprovar a proposta é decisão de gente.
UPDATE "projeto" p
SET "etapa_id" = l."id", "atualizado_em" = now()
FROM "etapa" velha, "etapa" l
WHERE p."etapa_id" = velha."id"
  AND velha."slug" IN ('coleta_info', 'proposta', 'pagamento')
  AND l."empresa_id" = velha."empresa_id"
  AND l."slug" = 'lead';

UPDATE "etapa" SET "ativa" = false WHERE "slug" IN ('coleta_info', 'proposta', 'pagamento');
