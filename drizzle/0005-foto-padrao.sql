-- Fotos do padrão de entrada: exigência da NDU 013 da Energisa ("fotos do
-- padrão, tampa aberta e fechada"). No Drive aparecem como MEDIDOR, QUADRO e
-- PADRAO, e estavam caindo em `outro` — ou seja, um item obrigatório da
-- homologação não contava para lugar nenhum.
ALTER TYPE "public"."tipo_documento" ADD VALUE IF NOT EXISTS 'foto_padrao';
