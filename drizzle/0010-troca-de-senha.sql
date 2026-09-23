-- Senha provisória precisa ser trocada no primeiro acesso.
--
-- Hoje os cinco usuários do sistema são genéricos — um `tecnico`, um `vendas` —
-- e todos com a mesma senha, que está escrita no SETUP.md, que está num
-- repositório PÚBLICO no GitHub. Enquanto o sistema roda em localhost isso é
-- só feio. Com o IP público que a Intec vai anexar, vira porta aberta para a
-- CNH, o CPF e o contrato de 166 pessoas.
--
-- A correção tem duas partes. Esta coluna é a segunda: o administrador cria a
-- conta com uma senha provisória, e o sistema obriga a pessoa a trocar antes
-- de ver qualquer tela. Sem isso, "criar conta nominal" viraria "criar conta
-- nominal com senha que o administrador conhece", e a trilha de auditoria
-- voltaria a não provar nada.
--
-- Os cinco usuários existentes entram marcados: a senha deles é pública.
ALTER TABLE "usuario"
  ADD COLUMN IF NOT EXISTS "deve_trocar_senha" boolean NOT NULL DEFAULT false;

UPDATE "usuario" SET "deve_trocar_senha" = true;
