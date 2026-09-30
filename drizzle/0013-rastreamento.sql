-- Rastreamento do técnico em campo: onde ele está agora e por onde passou.
--
-- É o "Acompanhar técnico" do SeeNet. O celular só manda posição entre o
-- "Estou a caminho" e o fim do atendimento (concluir, pausar, não atendida) —
-- fora da OS ninguém é rastreado.
--
-- Aplicada à mão, como as outras:
--
--   docker compose exec -T db psql -U postgres -d bbsolucoes -v ON_ERROR_STOP=1 < drizzle/0013-rastreamento.sql
--
-- Pode rodar de novo sem estragar nada: tudo é IF NOT EXISTS.

-- 1. A última posição de cada técnico: uma linha por pessoa, sobrescrita a
--    cada envio. É o que o mapa do escritório desenha.
CREATE TABLE IF NOT EXISTS "posicao_atual" (
  "usuario_id" uuid PRIMARY KEY REFERENCES "usuario" ("id") ON DELETE CASCADE,
  "empresa_id" uuid NOT NULL REFERENCES "empresa" ("id") ON DELETE CASCADE,
  "ordem_servico_id" uuid REFERENCES "ordem_servico" ("id") ON DELETE SET NULL,
  "latitude" numeric(10, 7) NOT NULL,
  "longitude" numeric(10, 7) NOT NULL,
  "precisao_m" integer,
  "velocidade_ms" real,
  "bateria" smallint,
  -- `deslocamento` (GPS forte, a cada poucos segundos) ou `eco` (no local do
  -- cliente, a cada minuto). Muda o que conta como "sem sinal".
  "modo" varchar(15) NOT NULL DEFAULT 'deslocamento',
  -- A hora do celular: sem sinal, o ponto chega ao servidor bem depois.
  "capturado_em" timestamptz NOT NULL,
  "recebido_em" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "posicao_atual_empresa_idx" ON "posicao_atual" ("empresa_id");

-- 2. A trilha: o caminho percorrido, para desenhar a rota no mapa. Não entra
--    ponto parado nem ponto de antena (precisão ruim) — ver src/rastreamento.
--    Fica 30 dias; a posição de cada ação da OS (saiu, chegou, concluiu) fica
--    para sempre no histórico, que é outra tabela.
CREATE TABLE IF NOT EXISTS "posicao_trilha" (
  "id" bigserial PRIMARY KEY,
  "empresa_id" uuid NOT NULL REFERENCES "empresa" ("id") ON DELETE CASCADE,
  "usuario_id" uuid NOT NULL REFERENCES "usuario" ("id") ON DELETE CASCADE,
  "ordem_servico_id" uuid REFERENCES "ordem_servico" ("id") ON DELETE CASCADE,
  "latitude" numeric(10, 7) NOT NULL,
  "longitude" numeric(10, 7) NOT NULL,
  "precisao_m" integer,
  "velocidade_ms" real,
  "capturado_em" timestamptz NOT NULL,
  "recebido_em" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "posicao_trilha_os_idx" ON "posicao_trilha" ("ordem_servico_id", "capturado_em");
CREATE INDEX IF NOT EXISTS "posicao_trilha_usuario_idx" ON "posicao_trilha" ("usuario_id", "capturado_em");
CREATE INDEX IF NOT EXISTS "posicao_trilha_capturado_idx" ON "posicao_trilha" ("capturado_em");
