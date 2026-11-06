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

conferir_saude() {
  local url="https://$(dominio)/api/saude"
  echo "Conferindo ${url} ..."
  for tentativa in 1 2 3 4 5 6; do
    sleep 5
    if saida=$(curl -fsS --max-time 15 "$url" 2>/dev/null); then
      echo "$saida" | head -c 600; echo
      return 0
    fi
    echo "  ainda não respondeu (tentativa ${tentativa}/6)"
  done
  # O 503 também é resposta: o site está de pé, só alguma verificação pede atenção.
  curl -sS --max-time 15 "$url" || true; echo
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
  docker compose exec -T coletor npm run backup

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

echo "== 3/8 Guardando as imagens atuais como :anterior"
for s in "${SERVICOS[@]}"; do
  docker image inspect "bbsolucoes-${s}:latest" >/dev/null 2>&1 && docker tag "bbsolucoes-${s}:latest" "bbsolucoes-${s}:anterior" || true
done

echo "== 4/8 Construindo"
docker compose build "${SERVICOS[@]}"

echo "== 5/8 Migrações"
docker compose run --rm --no-deps -T site npm run migrar

echo "== 6/8 Subindo"
mkdir -p backups estado mapeamentos anexos-pendentes
docker compose up -d

echo "== 7/8 Limpando o cache do Docker"
docker builder prune -af >/dev/null
docker image prune -f >/dev/null

echo "== 8/8 Saúde e disco"
if conferir_saude; then
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
