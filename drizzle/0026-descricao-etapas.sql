-- A descrição de duas etapas passa a dizer como o projeto sai delas (13/11/2026).
--
-- Projeto: anda sozinho quando a Energisa registra o pedido no portal (a
-- extensão do Chrome lê e liga o projeto). Execução: anda sozinha quando a OS
-- de instalação é concluída como resolvida.
--
-- Aplicada pelo `npm run migrar` (ou ./scripts/deploy.sh). Pode rodar de novo.

UPDATE "etapa"
SET "descricao" = 'Projeto elétrico, memorial, ART e datasheet. Anda sozinho quando a Energisa registra o pedido no portal.'
WHERE "slug" = 'projeto';

UPDATE "etapa"
SET "descricao" = 'A obra, pela OS de instalação. Concluída a OS, o projeto vai sozinho para o Pedido de vistoria. É a etapa que mais gera retrabalho, e para onde o projeto volta quando a concessionária reprova.'
WHERE "slug" = 'execucao';
