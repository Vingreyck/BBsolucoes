-- Os dados da proposta comercial entram já na criação do projeto (pedido de
-- 13/11/2026): consumo, tipo de ligação, kit, potência, telhado e
-- concessionária. Quase tudo já tinha coluna; faltava o tipo de ligação
-- (monofásico, bifásico, trifásico), que define o mínimo que a distribuidora
-- cobra mesmo com a usina gerando.
--
-- E a foto da capa da proposta, opcional, que o adm sobe em Administração →
-- Proposta comercial (sem ela, a capa sai com o desenho dos módulos ao pôr do sol).
--
-- Aplicada pelo `npm run migrar` (ou ./scripts/deploy.sh). Pode rodar de novo.

ALTER TABLE "projeto" ADD COLUMN IF NOT EXISTS "ligacao" varchar(12);
ALTER TABLE "empresa" ADD COLUMN IF NOT EXISTS "proposta_capa" text;
