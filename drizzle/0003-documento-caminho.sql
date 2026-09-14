-- Onde o arquivo estava dentro da pasta do cliente.
--
-- Vazio = solto na raiz da pasta. Preenchido = dentro de um pacote, tipo
-- "PE Solar ... / Documentos Assinados". Sem isto não dá para responder se a
-- ART está solta ou dentro do projeto elétrico, e foi justamente um arquivo
-- dois níveis abaixo que ficou de fora da primeira importação.
ALTER TABLE "documento" ADD COLUMN IF NOT EXISTS "caminho" text;
