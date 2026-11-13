-- Quando o contrato voltou assinado (pedido de 13/11/2026).
--
-- É a base da métrica "há quantos dias o cliente assinou": quem assinou há mais
-- tempo e ainda não tem a obra andando é quem está mais atrasado. Fica no
-- projeto, e não só no documento, porque a métrica precisa de uma data certa
-- mesmo que o arquivo seja trocado depois.
--
-- A data é a do dia em que a via assinada entrou no sistema (o envio pelo
-- dossiê grava; sem envio, o avanço automático da esteira grava o dia em que
-- andou). Só o primeiro valor vale: subir uma versão nova não zera o relógio.
--
-- Aplicada pelo `npm run migrar` (ou ./scripts/deploy.sh). Pode rodar de novo.

ALTER TABLE "projeto" ADD COLUMN IF NOT EXISTS "contrato_assinado_em" timestamptz;

-- Projetos que já têm contrato (assinado ou não marcado como pendente) no dossiê:
-- vale a data do arquivo (a do Drive, nos importados).
UPDATE "projeto" p
SET "contrato_assinado_em" = d."quando"
FROM (
  SELECT "projeto_id", min(coalesce("modificado_em"::timestamptz, "criado_em")) AS "quando"
  FROM "documento"
  WHERE "tipo" = 'contrato' AND "status" <> 'aguardando_assinatura' AND "projeto_id" IS NOT NULL
  GROUP BY "projeto_id"
) d
WHERE p."id" = d."projeto_id" AND p."contrato_assinado_em" IS NULL;
