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
#   7. limpa o cache do Docker (regra do projeto: o disco é pequeno)
#   8. confere /api/saude e mostra o disco
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

echo "== 1/8 Cópia de segurança"
docker compose exec -T coletor npm run backup

echo "== 2/8 Código novo"
if [[ -n "$(git status --porcelain --untracked-files=no)" ]]; then
  echo "A VM tem alteração solta no código. Resolva antes (git status) — o deploy parou." >&2
  exit 1
fi
git pull --ff-only
git log --oneline -1

echo "== 3/8 Guardando as imagens atuais como :anterior"
for s in "${SERVICOS[@]}"; do
  docker image inspect "bbsolucoes-${s}:latest" >/dev/null 2>&1 && docker tag "bbsolucoes-${s}:latest" "bbsolucoes-${s}:anterior" || true
done

echo "== 4/8 Construindo"
docker compose build "${SERVICOS[@]}"

echo "== 5/8 Migrações"
docker compose run --rm --no-deps -T site npm run migrar

echo "== 6/8 Subindo"
mkdir -p backups estado mapeamentos
docker compose up -d

echo "== 7/8 Limpando o cache do Docker"
docker builder prune -af >/dev/null
docker image prune -f >/dev/null

echo "== 8/8 Saúde e disco"
df -h / | tail -1
if conferir_saude; then
  echo "Deploy concluído."
else
  echo "O site NÃO respondeu como esperado. Para voltar: ./scripts/deploy.sh --voltar" >&2
  exit 1
fi
