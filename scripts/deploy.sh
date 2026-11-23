#!/usr/bin/env bash
# Deploy do Selebi na VM, do começo ao fim, sem esquecer nenhum passo.
#
#   ./scripts/deploy.sh            atualiza o sistema
#   ./scripts/deploy.sh --voltar   volta para a versão de antes do último deploy
#
# O que ele faz, nesta ordem — e para no primeiro erro:
#   1. cópia de segurança do banco (local e cifrada no Drive)
#   2. git pull (só avança; recusa se a VM tem alteração solta)
#   3. guarda as imagens atuais como ":anterior" (é o que permite voltar)
#   4. constrói as imagens novas
#   5. aplica as migrações que faltam (cada uma numa transação)
#   6. sobe os containers
#   7. limpa o cache do Docker (o que sobra de cada build)
#   8. confere /api/saude e mostra o disco
#
# As imagens ":anterior" ficam até o próximo deploy (~1,6 GB; o disco tem 77 GB
# desde 30/10/2026): um problema achado horas depois ainda se desfaz com
# `--voltar`. O banco não volta junto — se a migração mexeu nele, restaure a
# cópia do passo 1. Com o disco apertado de novo, `LIMPAR_ANTERIOR=1` apaga
# as ":anterior" no fim do deploy que deu certo.
#
# Rode na pasta do projeto (~/BBsolucoes), como o usuário que roda o Docker.

set -euo pipefail
cd "$(dirname "$0")/.."

SERVICOS=(site coletor)

dominio() {
  grep -E '^DOMINIO=' .env | head -1 | cut -d= -f2- | tr -d '"' | tr -d "'" | tr -d '\r'
}

# 0 = tudo certo; 2 = o site está de pé, mas alguma verificação pede atenção
# (o 503 com o banco respondendo: coletor, backup, Drive); 1 = não respondeu.
conferir_saude() {
  local url="https://$(dominio)/api/saude"
  local saida codigo
  echo "Conferindo ${url} ..."
  for tentativa in 1 2 3 4 5 6; do
    sleep 5
    # O corpo, uma linha "|", e o código HTTP no fim.
    saida=$(curl -sS --max-time 15 -w '|%{http_code}' "$url" 2>/dev/null) || saida="|000"
    codigo="${saida##*|}"
    saida="${saida%|*}"
    if [[ "$codigo" == "200" ]]; then
      echo "$saida" | head -c 600; echo
      return 0
    fi
    if [[ "$codigo" == "503" && "$saida" == *'"nome":"banco","ok":true'* ]]; then
      echo "$saida" | head -c 900; echo
      return 2
    fi
    echo "  ainda não respondeu (tentativa ${tentativa}/6)"
  done
  return 1
}

if [[ "${1:-}" == "--voltar" ]]; then
  echo "Voltando para a versão de antes do último deploy..."
  for s in "${SERVICOS[@]}"; do
    if ! docker image inspect "bbsolucoes-${s}:anterior" >/dev/null 2>&1; then
      echo "Não há imagem anterior de ${s}: nada para voltar." >&2
      exit 1
    fi
    docker tag "bbsolucoes-${s}:anterior" "bbsolucoes-${s}:latest"
  done
  docker compose up -d --no-build "${SERVICOS[@]}"
  echo "Voltou. Atenção: o BANCO não volta sozinho — se a migração do deploy mexeu nele, restaure a cópia (SETUP.md)."
  conferir_saude || true
  exit 0
fi

# `--continuar`: a volta do próprio script depois de o `git pull` trazer uma
# versão nova dele (ver abaixo) — a cópia e o pull já foram feitos.
if [[ "${1:-}" != "--continuar" ]]; then
  echo "== 1/8 Cópia de segurança"
  # Código 2: a cópia local foi gravada e só a cifrada do Drive falhou (rede,
  # Google fora do ar). O deploy precisa da local; segue com aviso, e o coletor
  # tenta mandar ao Drive de novo na próxima rodada. Qualquer outra falha para.
  codigo=0
  docker compose exec -T coletor npm run backup || codigo=$?
  if [[ $codigo -eq 2 ]]; then
    echo "Aviso: a cópia cifrada não subiu para o Drive agora; a cópia local foi gravada e o deploy segue." >&2
  elif [[ $codigo -ne 0 ]]; then
    echo "A cópia de segurança falhou — o deploy parou antes de mexer em qualquer coisa." >&2
    exit 1
  fi

  echo "== 2/8 Código novo"
  if [[ -n "$(git status --porcelain --untracked-files=no)" ]]; then
    echo "A VM tem alteração solta no código. Resolva antes (git status) — o deploy parou." >&2
    exit 1
  fi
  antes=$(git hash-object scripts/deploy.sh)
  git pull --ff-only
  git log --oneline -1
  # O bash já leu a versão velha deste arquivo: se o pull trouxe outra,
  # recomeça com ela, senão os passos seguintes seguem as regras antigas.
  if [[ "$(git hash-object scripts/deploy.sh)" != "$antes" ]]; then
    echo "O deploy.sh mudou neste pull — continuando com a versão nova."
    exec ./scripts/deploy.sh --continuar
  fi
fi

# O segundo fator só liga com a APP_ENCRYPTION_KEY no .env (ela cifra o segredo de
# cada pessoa). Sem ela o site sobe do mesmo jeito, só que SEM 2FA — avisa aqui
# para não descobrir semanas depois.
if ! grep -qE '^APP_ENCRYPTION_KEY=.{16,}' .env; then
  echo "AVISO: APP_ENCRYPTION_KEY não está no .env — o segundo fator (Google Authenticator) vai ficar DESLIGADO." >&2
  echo "       Gere uma, ponha no .env e rode 'docker compose up -d site' (veja .env.example). Não troque depois." >&2
fi

echo "== 3/8 Guardando as imagens atuais como :anterior"
for s in "${SERVICOS[@]}"; do
  docker image inspect "bbsolucoes-${s}:latest" >/dev/null 2>&1 && docker tag "bbsolucoes-${s}:latest" "bbsolucoes-${s}:anterior" || true
done

echo "== 4/8 Construindo"
# `--pull`: busca a versão mais nova da imagem base (node:22-slim) em vez de
# reaproveitar a que está no cache da VM desde o primeiro deploy. É assim que as
# correções de segurança do Debian e do Node chegam ao site.
docker compose build --pull "${SERVICOS[@]}"
# O mesmo para o banco e o HTTPS (postgres:16 e caddy:2-alpine): a etiqueta
# fica na mesma versão maior, só entram as correções. O `up` abaixo troca o
# container se a imagem mudou.
docker compose pull db caddy

echo "== 5/8 Migrações"
docker compose run --rm --no-deps -T site npm run migrar

echo "== 6/8 Subindo"
mkdir -p backups estado mapeamentos anexos-pendentes
docker compose up -d
# O Caddyfile entra no container como um arquivo montado sozinho, e o `git pull`
# troca o arquivo por outro: o container continua preso ao antigo (o `caddy
# reload` lia a versão velha e dizia "config is unchanged" — foi o que manteve o
# limite de 2 MB na administração em 20/11). Se o de dentro do container é
# diferente do que está no disco, recria só o Caddy: uns segundos fora do ar,
# o certificado fica no volume e não é pedido de novo.
if ! docker compose exec -T caddy cat /etc/caddy/Caddyfile | cmp -s - Caddyfile; then
  echo "O Caddyfile mudou: recriando o Caddy."
  docker compose up -d --force-recreate --no-deps caddy
fi

echo "== 7/8 Limpando o cache do Docker"
docker builder prune -af >/dev/null
docker image prune -f >/dev/null

echo "== 8/8 Saúde e disco"
saude=0
conferir_saude || saude=$?
if [[ "$saude" == "2" ]]; then
  df -h / | tail -1
  echo "Deploy concluído. O site está no ar, mas uma verificação acima pede atenção (ok:false). Não precisa voltar a versão."
  exit 0
fi
if [[ "$saude" == "0" ]]; then
  if [[ "${LIMPAR_ANTERIOR:-}" == "1" ]]; then
    for s in "${SERVICOS[@]}"; do docker image rm "bbsolucoes-${s}:anterior" >/dev/null 2>&1 || true; done
  fi
  df -h / | tail -1
  echo "Deploy concluído."
else
  df -h / | tail -1
  echo "O site NÃO respondeu como esperado. Para voltar: ./scripts/deploy.sh --voltar" >&2
  exit 1
fi
