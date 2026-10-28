-- Observação obrigatória, vídeo e "agendar" no roteiro da vistoria.
--
-- Pedido do Vinícius (anotações de 17/10): sem foto, a observação passa a ser
-- obrigatória; aterramento, vagas no quadro, "vai precisar rasgar", local do
-- inversor e aumento de consumo pedem observação sempre; o local do inversor
-- aceita foto ou vídeo; e sombra, espaço útil e caminho do cabo podem ficar para
-- uma visita de volta ("agendar"), marcada no fim da vistoria.
--
-- Aplicada à mão, como as outras:
--
--   docker compose exec -T db psql -U postgres -d bbsolucoes -v ON_ERROR_STOP=1 < drizzle/0014-observacao-obrigatoria.sql
--
-- Pode rodar de novo sem estragar nada.

-- 1. As colunas. `exige_observacao`: nao | sem_foto | sempre.
ALTER TABLE "modelo_os_item"
  ADD COLUMN IF NOT EXISTS "exige_observacao" varchar(10) NOT NULL DEFAULT 'nao',
  ADD COLUMN IF NOT EXISTS "permite_agendar" boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "aceita_video" boolean NOT NULL DEFAULT false;

ALTER TABLE "os_checklist_item"
  ADD COLUMN IF NOT EXISTS "exige_observacao" varchar(10) NOT NULL DEFAULT 'nao',
  ADD COLUMN IF NOT EXISTS "permite_agendar" boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "aceita_video" boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "agendar" boolean NOT NULL DEFAULT false;

-- 2. O modelo da vistoria que a empresa já tem gravado. `MODELOS_PADRAO` só
--    vale para modelo novo — este é o ajuste do que já existe. Casa pela
--    `chave` do item; o que o admin criou por conta própria não é tocado.
--
--    Observação SEMPRE obrigatória (além da foto, onde há):
UPDATE "modelo_os_item" i
   SET "exige_observacao" = 'sempre'
  FROM "modelo_os" m
 WHERE i."modelo_id" = m."id"
   AND m."tipo" = 'vistoria'
   AND i."chave" IN ('aterramento', 'qdg_vagas', 'rasgar_parede', 'inversor_local', 'ampliacao');

--    Nos demais itens que pedem foto, a observação entra no lugar da foto que
--    não deu para tirar:
UPDATE "modelo_os_item" i
   SET "exige_observacao" = 'sem_foto'
  FROM "modelo_os" m
 WHERE i."modelo_id" = m."id"
   AND m."tipo" = 'vistoria'
   AND i."fotos_minimas" > 0
   AND i."exige_observacao" = 'nao';

--    Pode ficar para a visita de volta:
UPDATE "modelo_os_item" i
   SET "permite_agendar" = true
  FROM "modelo_os" m
 WHERE i."modelo_id" = m."id"
   AND m."tipo" = 'vistoria'
   AND i."chave" IN ('cabo_caminho', 'sombra', 'area_util');

--    O local do inversor aceita vídeo:
UPDATE "modelo_os_item" i
   SET "aceita_video" = true
  FROM "modelo_os" m
 WHERE i."modelo_id" = m."id"
   AND m."tipo" = 'vistoria'
   AND i."chave" = 'inversor_local';

--    O aumento de consumo vira sim ou não (o detalhe vai na observação):
UPDATE "modelo_os_item" i
   SET "tipo_resposta" = 'sim_nao',
       "descricao" = 'Aumento de consumo previsto?',
       "ajuda" = 'Ar-condicionado, piscina, carro elétrico… Responda e explique na observação: "2 ar-condicionados até o verão".',
       "obrigatorio" = true
  FROM "modelo_os" m
 WHERE i."modelo_id" = m."id"
   AND m."tipo" = 'vistoria'
   AND i."chave" = 'ampliacao';

-- 3. As OS de vistoria ainda não começadas ganham as regras novas: o item copia
--    o modelo quando a OS nasce, então uma OS já aberta ficaria de fora. Só as
--    que ninguém respondeu — o que já está respondido não muda no meio.
UPDATE "os_checklist_item" c
   SET "exige_observacao" = mi."exige_observacao",
       "permite_agendar" = mi."permite_agendar",
       "aceita_video" = mi."aceita_video"
  FROM "ordem_servico" o, "modelo_os" m, "modelo_os_item" mi
 WHERE c."ordem_servico_id" = o."id"
   AND o."tipo" = 'vistoria'
   AND o."status" IN ('aberta', 'agendada')
   AND m."empresa_id" = o."empresa_id" AND m."tipo" = 'vistoria'
   AND mi."modelo_id" = m."id" AND mi."chave" = c."chave"
   AND c."respondido_em" IS NULL
   AND c."concluido" = false;
