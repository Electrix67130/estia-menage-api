#!/usr/bin/env bash
# Nettoyage disque du VPS Estia.
#
# Le VPS n'a que 7,9 Go. Le 2026-09-07 un deploiement a echoue sur
# « no space left on device » : cache de build Docker, journaux systemd et
# caches apt/npm avaient rempli le disque. Ce script recupere tout ce qui se
# regenere tout seul, et rien d'autre.
#
# JAMAIS `docker system prune --volumes` ici : le volume `estia_db_data` porte
# la base de production. Un volume efface ne se regenere pas.
#
# Usage :
#   vps-cleanup.sh              nettoyage complet
#   vps-cleanup.sh --si-moins-de 2   ne nettoie que s'il reste moins de 2 Go
#
# Sur le VPS, lier ce script depuis le home du user de deploiement :
#   ln -sf /home/estia/api/scripts/vps-cleanup.sh /home/estia/vps-cleanup.sh

set -euo pipefail

# Le cache de build Docker est le premier poste : il grossit a chaque `docker
# build`. 512 Mo suffisent a garder les couches utiles d'un deploiement a
# l'autre sans manger le disque.
CACHE_DOCKER_MAX="512MB"
JOURNAUX_MAX="100M"

# En megaoctets : `df -BG` arrondit au gigaoctet superieur, ce qui affichait
# « +1 Go » pour 400 Mo reellement liberes.
libre_mo() {
  df -BM --output=avail / | tail -1 | tr -dc '0-9'
}

main() {
  local seuil=""
  if [ "${1:-}" = "--si-moins-de" ]; then
    seuil="${2:?--si-moins-de attend un nombre de Go}"
  fi

  local avant
  avant="$(libre_mo)"

  if [ -n "$seuil" ] && [ "$avant" -ge $((seuil * 1024)) ]; then
    echo "[cleanup] ${avant} Mo libres (seuil ${seuil} Go) — rien a faire."
    return 0
  fi

  echo "[cleanup] Avant : ${avant} Mo libres."

  echo "[cleanup] Images et conteneurs orphelins..."
  docker image prune -f >/dev/null
  docker container prune -f >/dev/null

  echo "[cleanup] Cache de build Docker (garde ${CACHE_DOCKER_MAX})..."
  docker builder prune -f --keep-storage "$CACHE_DOCKER_MAX" >/dev/null

  echo "[cleanup] Journaux systemd (garde ${JOURNAUX_MAX})..."
  sudo journalctl --vacuum-size="$JOURNAUX_MAX" >/dev/null 2>&1 || true

  echo "[cleanup] Caches apt..."
  sudo apt-get clean
  sudo apt-get autoremove -y --purge >/dev/null 2>&1 || true

  echo "[cleanup] Cache npm..."
  npm cache clean --force >/dev/null 2>&1 || true

  # Cache de build de Next.js : reconstruit au prochain `npm run build`, il
  # coute juste un build un peu plus lent.
  if [ -d /home/estia/dashboard/.next/cache ]; then
    echo "[cleanup] Cache de build du dashboard..."
    rm -rf /home/estia/dashboard/.next/cache
  fi

  local apres
  apres="$(libre_mo)"
  echo "[cleanup] Apres : ${apres} Mo libres (+$((apres - avant)) Mo)."
  df -h / | tail -1

  # Sous 1,5 Go, le prochain `docker build` est en danger : on le dit fort,
  # parce que le symptome (« no space left ») arrive toujours au pire moment.
  if [ "$apres" -lt 2048 ]; then
    echo "[cleanup] ⚠️  Moins de 2 Go libres MALGRE le nettoyage." >&2
    echo "[cleanup] ⚠️  Verifier les gros postes :" >&2
    sudo du -sh /var/lib/docker /home/estia/* /var/log /var/cache 2>/dev/null |
      sort -rh | head -6 >&2
  fi
}

main "$@"
