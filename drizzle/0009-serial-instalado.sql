-- O número de série anotado na instalação.
--
-- É a cura do cadastro duplicado, e funciona porque inverte a ordem em que as
-- coisas se conhecem. Hoje o sistema descobre uma usina quando ela aparece no
-- portal do fabricante, dias depois de instalada, com o nome que o técnico
-- digitou lá — "José Fernando7", "micaely 03". Sem forma de ligar àquele
-- cliente, que já existe no Selebi desde que a venda foi fechada.
--
-- O serial do inversor é a única coisa que os dois lados têm em comum, e é
-- única: está na etiqueta do aparelho e não muda. Se o técnico anotar aqui no
-- dia da instalação, o coletor reconhece a usina quando ela aparecer no portal
-- e liga sozinho ao cliente certo. Nunca mais nasce duplicata.
--
-- `usina_id` fica nulo até o portal confirmar. É essa coluna que separa "o
-- técnico disse que instalou" de "o portal confirmou que existe" — e a
-- diferença entre as duas é informação útil: serial anotado há uma semana e
-- ainda sem confirmação costuma ser datalogger que não conectou.
CREATE TABLE IF NOT EXISTS "serial_instalado" (
  "id"             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "empresa_id"     uuid NOT NULL REFERENCES "empresa"("id") ON DELETE CASCADE,
  "projeto_id"     uuid NOT NULL REFERENCES "projeto"("id") ON DELETE CASCADE,
  "numero_serie"   varchar(60) NOT NULL,
  "observacao"     text,
  "usina_id"       uuid REFERENCES "usina"("id") ON DELETE SET NULL,
  "confirmado_em"  timestamp with time zone,
  "registrado_por" uuid REFERENCES "usuario"("id") ON DELETE SET NULL,
  "registrado_em"  timestamp with time zone NOT NULL DEFAULT now()
);

-- Um serial existe uma vez só na empresa. Dois projetos reivindicando o mesmo
-- aparelho é erro de digitação ou inversor remanejado, e nos dois casos é para
-- alguém olhar, não para o sistema escolher um.
CREATE UNIQUE INDEX IF NOT EXISTS "serial_instalado_uq"
  ON "serial_instalado" ("empresa_id", "numero_serie");

CREATE INDEX IF NOT EXISTS "serial_instalado_projeto_idx"
  ON "serial_instalado" ("projeto_id");

-- A varredura de reconciliação procura por aqui: seriais ainda sem usina.
CREATE INDEX IF NOT EXISTS "serial_instalado_pendente_idx"
  ON "serial_instalado" ("empresa_id") WHERE "usina_id" IS NULL;
