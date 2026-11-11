-- Segundo fator (Google Authenticator) para todo mundo que entra pelo navegador.
--
-- usuario.mfa_segredo        o segredo do aplicativo, CIFRADO (AES-256-GCM). Nulo = a
--                            pessoa ainda não cadastrou o aplicativo: no próximo
--                            login ela é levada a fazer isso antes de entrar.
-- usuario.mfa_ativado_em     quando cadastrou.
-- usuario.mfa_ultimo_passo   o último período de 30 s cujo código foi aceito. Código
--                            só vale uma vez: o mesmo número não entra duas vezes.
-- sessao.mfa_valida_ate      até quando o segundo fator desta sessão vale. A sessão
--                            nunca dura mais que isso; passou, entra de novo com o código.
-- dispositivo_confiavel      aparelho que já provou o segundo fator. Vale 30 dias a partir
--                            da última vez que a pessoa digitou o código; depois disso, e
--                            em qualquer aparelho que não esteja aqui, o código é pedido.
-- mfa_desafio                o meio do caminho: a senha conferiu, falta o código. Dura
--                            10 minutos, aceita 5 tentativas e some.
--
-- Aplicada pelo `npm run migrar` (ou ./scripts/deploy.sh). Pode rodar de novo.

ALTER TABLE "usuario" ADD COLUMN IF NOT EXISTS "mfa_segredo" text;
ALTER TABLE "usuario" ADD COLUMN IF NOT EXISTS "mfa_ativado_em" timestamptz;
ALTER TABLE "usuario" ADD COLUMN IF NOT EXISTS "mfa_ultimo_passo" bigint;

ALTER TABLE "sessao" ADD COLUMN IF NOT EXISTS "mfa_valida_ate" timestamptz;

CREATE TABLE IF NOT EXISTS "dispositivo_confiavel" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "usuario_id" uuid NOT NULL REFERENCES "usuario"("id") ON DELETE CASCADE,
  -- SHA-256 do que o aparelho guarda (cookie no navegador, token no app). Nunca o valor.
  "token_hash" varchar(64) NOT NULL,
  "origem" varchar(10) NOT NULL DEFAULT 'web',
  -- "Chrome · Windows" — para a pessoa reconhecer o aparelho.
  "rotulo" text,
  "mfa_em" timestamptz NOT NULL DEFAULT now(),
  "expira_em" timestamptz NOT NULL,
  "ultimo_uso_em" timestamptz,
  "criado_em" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "dispositivo_confiavel_token_uq" ON "dispositivo_confiavel" ("token_hash");
CREATE INDEX IF NOT EXISTS "dispositivo_confiavel_usuario_idx" ON "dispositivo_confiavel" ("usuario_id");

CREATE TABLE IF NOT EXISTS "mfa_desafio" (
  -- SHA-256 do token que a pessoa carrega (cookie `bb_mfa` ou o corpo da resposta do app).
  "id" varchar(64) PRIMARY KEY,
  "usuario_id" uuid NOT NULL REFERENCES "usuario"("id") ON DELETE CASCADE,
  "origem" varchar(10) NOT NULL DEFAULT 'web',
  -- Só no primeiro cadastro: o segredo novo, cifrado, que ainda não vale nada até o primeiro código certo.
  "segredo_pendente" text,
  "dispositivo" text,
  "tentativas" integer NOT NULL DEFAULT 0,
  "expira_em" timestamptz NOT NULL,
  "criado_em" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "mfa_desafio_usuario_idx" ON "mfa_desafio" ("usuario_id");
