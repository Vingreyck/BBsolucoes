-- Tipo de telhado do projeto (pedido de 13/11/2026).
--
-- A vistoria do técnico pergunta o tipo de telhado; ao concluí-la, o sistema
-- grava a resposta aqui (só se estiver vazio) e a usa na "estrutura" do
-- contrato. O comercial ou o engenheiro corrigem na tela do projeto.
--
-- Aplicada pelo `npm run migrar` (ou ./scripts/deploy.sh). Pode rodar de novo.

ALTER TABLE "projeto" ADD COLUMN IF NOT EXISTS "telhado_tipo" varchar(40);
