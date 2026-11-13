-- Quando o engenheiro enviou o projeto à Energisa (pedido de 13/11/2026).
--
-- Gravado pelo botão "Já enviei" do dossiê, junto com o número que o portal deu
-- (vai para `protocolo_concessionaria`, que liga o projeto à linha lida pela
-- extensão). É a base de "há quantos dias está na Energisa" no cartão da etapa
-- Aprovação da concessionária.
--
-- Aplicada pelo `npm run migrar` (ou ./scripts/deploy.sh). Pode rodar de novo.

ALTER TABLE "projeto" ADD COLUMN IF NOT EXISTS "energisa_enviado_em" timestamptz;
