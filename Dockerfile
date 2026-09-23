# Imagem única, dois papéis: o site e o coletor.
#
# Podia ser a build `standalone` do Next, que sai bem menor. Não é, de
# propósito: o coletor roda os scripts em TypeScript com `tsx`, e o standalone
# joga fora o código-fonte e as dependências de desenvolvimento. Manter uma
# imagem só, com tudo dentro, custa algumas centenas de megabytes num disco de
# 40 GB e evita duas imagens que saem de sincronia sem ninguém perceber.

FROM node:22-slim

# `pg_dump` da versão **16**, e não o do Debian.
#
# O `postgresql-client` que vem no Debian 12 é o 15, e o `pg_dump` 15 se recusa
# a copiar um servidor 16: "aborting because of server version mismatch". O
# backup falharia todo dia, e o erro só apareceria em quem lesse o log.
#
# Daí o repositório oficial do PostgreSQL, que tem o cliente na mesma versão do
# servidor. `tzdata` para o container saber que hora é em Sergipe — sem ele o
# log sai em UTC, três horas fora, confuso justo quando se está investigando.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl gnupg tzdata \
  && curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc \
     | gpg --dearmor -o /usr/share/keyrings/pgdg.gpg \
  && echo "deb [signed-by=/usr/share/keyrings/pgdg.gpg] https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" \
     > /etc/apt/sources.list.d/pgdg.list \
  && apt-get update \
  && apt-get install -y --no-install-recommends postgresql-client-16 \
  && rm -rf /var/lib/apt/lists/*

ENV TZ=America/Sao_Paulo
ENV NODE_ENV=production

WORKDIR /app

# Instala as dependências antes de copiar o código: enquanto o package.json não
# mudar, o Docker reaproveita esta camada e o deploy leva segundos em vez de
# minutos.
COPY package.json package-lock.json* ./
RUN npm ci

COPY . .

# O build precisa das dependências de desenvolvimento, que `npm ci` já trouxe.
# Elas ficam depois também, porque o coletor usa `tsx`.
RUN npm run build

EXPOSE 3000

CMD ["npm", "run", "start"]
