-- Protocolo da Energisa.
--
-- Só apareceu quando a listagem do Drive passou a descer nas subpastas: os
-- arquivos `SE<ano><sequencial>.pdf` são os protocolos da Energisa Sergipe, e
-- vêm junto com `energisa_2via...` e os formulários de adesão à compensação.
-- É o rastro de que o pedido de acesso foi mesmo aberto — a informação que
-- responde "mandei para a concessionária ou só achei que mandei?".
ALTER TYPE "public"."tipo_documento" ADD VALUE IF NOT EXISTS 'protocolo';
