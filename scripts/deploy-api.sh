#!/usr/bin/env bash
# Deploiement de l'API Estia sur le VPS. Lance par GitHub Actions en SSH
# (cf. .github/workflows/deploy.yml) ou a la main.
#
# Sur le VPS, lier ce script depuis le home du user de deploiement :
#   ln -sf /home/estia/api/scripts/deploy-api.sh /home/estia/deploy-api.sh
#
# Le script vit DANS le repo pour que les garde-fous (nettoyage disque,
# migrations) soient versionnes. Une copie posee a la main sur le VPS finit
# toujours par diverger — le 2026-09-07, un garde-fou a ete ajoute a un
# `deploy.sh` que la CI n'appelait meme plus.
#
# Usage : deploy-api.sh [ref]   (ref = tag de version, ex 0.1.68, ou 'master')
#
# Tout le corps est dans main() : le script se met a jour lui-meme (git
# checkout) pendant qu'il tourne, or bash relit le fichier au fil de
# l'execution. Sans cette fonction, il reprendrait a un mauvais offset et
# executerait des morceaux de l'ancienne version. Une fonction est parsee en
# entier avant d'etre appelee.

set -euo pipefail

main() {
  local REF="${1:-master}"
  local APP_DIR="/home/estia/api"
  local COMPOSE="docker compose -f docker-compose.prod.yml"

  cd "$APP_DIR"

  echo "[deploy-api] Recuperation du code (ref: $REF)..."
  git fetch origin --tags --prune --force
  if git rev-parse -q --verify "refs/tags/$REF" >/dev/null; then
    echo "[deploy-api] checkout tag $REF"
    git checkout --force "refs/tags/$REF"
  else
    echo "[deploy-api] checkout branche $REF"
    git checkout --force "$REF"
    git reset --hard "origin/$REF"
  fi

  # Faire de la place AVANT le build : un `docker build` qui tombe en cours
  # laisse des couches a moitie ecrites, ce qui aggrave le probleme.
  "$APP_DIR/scripts/vps-cleanup.sh" --si-moins-de 3

  echo "[deploy-api] Build de l'image..."
  $COMPOSE build api

  echo "[deploy-api] Migrations..."
  $COMPOSE run --rm api npm run migrate

  echo "[deploy-api] Demarrage..."
  $COMPOSE up -d

  "$APP_DIR/scripts/vps-cleanup.sh"

  echo "[deploy-api] OK — ref $REF deployee."
}

main "$@"
