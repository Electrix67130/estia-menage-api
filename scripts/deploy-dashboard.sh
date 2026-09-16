#!/usr/bin/env bash
# Deploiement du dashboard Estia (Next.js natif + systemd) sur le VPS.
# Lance par GitHub Actions en SSH depuis le repo estia-menage-dashboard.
#
# Sur le VPS, lier ce script depuis le home du user de deploiement :
#   ln -sf /home/estia/api/scripts/deploy-dashboard.sh /home/estia/deploy-dashboard.sh
#
# Il vit dans le repo de l'API (et non du dashboard) parce que c'est ce repo
# qui est deja clone sur le VPS et qui porte les scripts d'exploitation.
#
# Usage : deploy-dashboard.sh [ref]   (tag de version, ex 0.1.83, ou 'master')
#
# Corps dans main() : meme raison que deploy-api.sh — le script peut etre
# remplace pendant son execution par un `git checkout` de l'API.

set -euo pipefail

main() {
  local REF="${1:-master}"
  local APP_DIR="/home/estia/dashboard"
  local SCRIPTS="/home/estia/api/scripts"

  cd "$APP_DIR"

  echo "[deploy-dashboard] Recuperation du code (ref: $REF)..."
  git fetch origin --tags --prune --force
  if git rev-parse -q --verify "refs/tags/$REF" >/dev/null; then
    echo "[deploy-dashboard] checkout tag $REF"
    git checkout --force "refs/tags/$REF"
  else
    echo "[deploy-dashboard] checkout branche $REF"
    git checkout --force "$REF"
    git reset --hard "origin/$REF"
  fi

  # `npm ci` + `next build` sont gourmands en disque : on fait de la place
  # avant, pas apres l'echec.
  "$SCRIPTS/vps-cleanup.sh" --si-moins-de 3

  echo "[deploy-dashboard] Dependances..."
  npm ci

  echo "[deploy-dashboard] Build..."
  npm run build

  echo "[deploy-dashboard] Redemarrage du service..."
  sudo systemctl restart estia-dashboard

  "$SCRIPTS/vps-cleanup.sh"

  echo "[deploy-dashboard] OK — ref $REF deployee."
}

main "$@"
