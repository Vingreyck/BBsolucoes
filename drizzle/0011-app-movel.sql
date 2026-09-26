-- App do técnico: login por CPF dentro de uma empresa, com cadastro que espera
-- aprovação.
--
-- Três mudanças, todas aditivas e seguras de rodar duas vezes:
--
-- 1. `empresa.codigo_acesso_hash` — o código que só o desenvolvedor entrega a
--    cada empresa (`npm run empresa:codigo`). Aqui mora apenas o SHA-256 do
--    código normalizado; o código em si não fica salvo em lugar nenhum, e o
--    repositório é público.
--
-- 2. `usuario.cpf`, e-mail opcional e aprovação. No app a pessoa se cadastra
--    sozinha com o código da empresa, e o cadastro nasce DESATIVADO e sem
--    `aprovado_em`: não entra em nada até um administrador liberar e escolher o
--    papel. Isso separa dois estados que antes eram um só: "desativado sem
--    aprovação" é quem pediu para entrar; "desativado com aprovação" é quem
--    saiu da empresa.
--
-- 3. `sessao.origem` separa o login do navegador do login do app. O token do
--    app dura mais (60 dias, renovados com o uso), porque o técnico não pode
--    ficar digitando senha em cima de um telhado; o do navegador segue com 30.

ALTER TABLE "empresa" ADD COLUMN IF NOT EXISTS "codigo_acesso_hash" varchar(64);
CREATE UNIQUE INDEX IF NOT EXISTS "empresa_codigo_acesso_uq"
  ON "empresa" ("codigo_acesso_hash") WHERE "codigo_acesso_hash" IS NOT NULL;

ALTER TABLE "usuario" ADD COLUMN IF NOT EXISTS "cpf" varchar(11);
ALTER TABLE "usuario" ALTER COLUMN "email" DROP NOT NULL;
-- CPF único por empresa, e não no sistema todo: um técnico que presta serviço
-- para duas integradoras tem duas contas, uma em cada, sem uma enxergar a outra.
CREATE UNIQUE INDEX IF NOT EXISTS "usuario_cpf_uq"
  ON "usuario" ("empresa_id", "cpf") WHERE "cpf" IS NOT NULL;

ALTER TABLE "usuario" ADD COLUMN IF NOT EXISTS "aprovado_em" timestamptz;
ALTER TABLE "usuario" ADD COLUMN IF NOT EXISTS "aprovado_por_id" uuid
  REFERENCES "usuario" ("id") ON DELETE SET NULL;

-- Quem já existia foi criado por um administrador ou pelo seed: já é aprovado.
-- O filtro `cpf IS NULL` é o que torna isto seguro de rodar de novo: cadastro
-- vindo do app sempre tem CPF, então nunca é aprovado por esta linha.
UPDATE "usuario" SET "aprovado_em" = "criado_em"
  WHERE "aprovado_em" IS NULL AND "cpf" IS NULL;

ALTER TABLE "sessao" ADD COLUMN IF NOT EXISTS "origem" varchar(10) NOT NULL DEFAULT 'web';
ALTER TABLE "sessao" ADD COLUMN IF NOT EXISTS "dispositivo" text;
ALTER TABLE "sessao" ADD COLUMN IF NOT EXISTS "ultimo_uso_em" timestamptz;
