#!/bin/bash
# Demo externe : 2 tunnels cloudflared (API + Expo Metro).
#
# Usage : ./scripts/demo-externe.sh
# Ctrl+C pour tout arreter et remettre en local.
#
# Ce script est idempotent : on peut le relancer apres un crash, une fermeture
# de terminal, des tunnels expires, etc. Il nettoie tout l'etat residuel avant.

set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
API_DIR="$(dirname "$SCRIPT_DIR")"
UI_DIR="$API_DIR/../estia-menage-ui"
URLS_FILE="/tmp/estia-menage-demo-externe.urls"
PID_FILE="/tmp/estia-menage-demo-externe.pid"

reset_local_env() {
  IP=$(ipconfig getifaddr en0 2>/dev/null || echo "localhost")
  if [ -f "$UI_DIR/.env" ]; then
    sed -i '' "s|^EXPO_PUBLIC_API_URL=.*|EXPO_PUBLIC_API_URL=http://$IP:3010|" "$UI_DIR/.env"
  fi
  if [ -f "$API_DIR/.env" ]; then
    sed -i '' "s|^APP_URL=.*|APP_URL=http://$IP:3010|" "$API_DIR/.env"
    docker restart estia-menage-api >/dev/null 2>&1 || true
  fi
}

cleanup() {
  echo ""
  echo "🛑 Arret des tunnels..."
  pkill -f "cloudflared tunnel" 2>/dev/null || true
  reset_local_env
  if docker ps --format '{{.Names}}' 2>/dev/null | grep -q "^estia-menage-ui-web$"; then
    cd "$UI_DIR" && docker compose up -d --force-recreate >/dev/null 2>&1 || true
  fi
  rm -f "$URLS_FILE" /tmp/cf-api.log /tmp/cf-expo.log "$PID_FILE"
  echo "✅ Remis en local"
  exit 0
}
trap cleanup INT TERM

# 0. Pre-cleanup : tue toute instance precedente du script + tunnels orphelins.
echo "🧹 Nettoyage de l'etat residuel..."
if [ -f "$PID_FILE" ]; then
  OLD_PID=$(cat "$PID_FILE" 2>/dev/null || true)
  if [ -n "$OLD_PID" ] && [ "$OLD_PID" != "$$" ] && kill -0 "$OLD_PID" 2>/dev/null; then
    echo "   Ancienne instance detectee (PID $OLD_PID), arret..."
    kill -TERM "$OLD_PID" 2>/dev/null || true
    # Laisse le temps au trap cleanup de l'ancienne instance de tourner
    for i in $(seq 1 5); do
      kill -0 "$OLD_PID" 2>/dev/null || break
      sleep 1
    done
    kill -KILL "$OLD_PID" 2>/dev/null || true
  fi
fi
pkill -f "cloudflared tunnel" 2>/dev/null || true
rm -f /tmp/cf-api.log /tmp/cf-expo.log "$URLS_FILE"
echo "$$" > "$PID_FILE"
sleep 1

# 1. S'assurer que l'API tourne. Si elle est down, on tente un docker compose up.
echo "🔍 Verification de l'API..."
if ! curl -fs http://localhost:3010/health >/dev/null 2>&1; then
  echo "⚠️  API down, demarrage du conteneur..."
  cd "$API_DIR"
  docker compose up -d >/dev/null 2>&1 || true
  for i in $(seq 1 20); do
    if curl -fs http://localhost:3010/health >/dev/null 2>&1; then break; fi
    sleep 1
  done
  if ! curl -fs http://localhost:3010/health >/dev/null 2>&1; then
    echo "❌ Impossible de demarrer l'API. Lance manuellement : docker compose up -d"
    exit 1
  fi
fi
echo "✅ API OK"

# 2. S'assurer que cloudflared est dispo
if ! command -v cloudflared >/dev/null 2>&1; then
  echo "❌ cloudflared introuvable. Installe-le : brew install cloudflared"
  exit 1
fi

# 3. Tunnel API
echo ""
echo "🌐 Tunnel API (port 3010)..."
cloudflared tunnel --url http://localhost:3010 --no-autoupdate > /tmp/cf-api.log 2>&1 &
API_PID=$!

API_URL=""
for i in $(seq 1 30); do
  API_URL=$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' /tmp/cf-api.log 2>/dev/null | head -1)
  if [ -n "$API_URL" ]; then break; fi
  if ! kill -0 "$API_PID" 2>/dev/null; then
    echo "❌ cloudflared API a quitte prematurement. Logs :"
    tail -10 /tmp/cf-api.log
    exit 1
  fi
  sleep 1
done
if [ -z "$API_URL" ]; then echo "❌ Tunnel API echoue (timeout 30s)"; exit 1; fi
echo "✅ API : $API_URL"

# 3.5. Mettre a jour APP_URL dans le .env API + restart pour que les uploads renvoient
# l'URL du tunnel (sinon les photos uploadees auront l'IP locale 192.168.x.x, inaccessible).
if [ -f "$API_DIR/.env" ]; then
  echo "📝 Mise a jour APP_URL=$API_URL dans estia-menage-api/.env"
  if grep -q "^APP_URL=" "$API_DIR/.env"; then
    sed -i '' "s|^APP_URL=.*|APP_URL=$API_URL|" "$API_DIR/.env"
  else
    echo "APP_URL=$API_URL" >> "$API_DIR/.env"
  fi
  echo "♻️  Restart estia-menage-api pour prendre en compte..."
  docker restart estia-menage-api >/dev/null 2>&1 || true
  for i in $(seq 1 20); do
    if curl -fs http://localhost:3010/health >/dev/null 2>&1; then break; fi
    sleep 1
  done
fi

# 4. Tunnel Expo Metro
echo "🌐 Tunnel Expo Metro (port 18083)..."
cloudflared tunnel --url http://localhost:18083 --no-autoupdate > /tmp/cf-expo.log 2>&1 &
EXPO_PID=$!

EXPO_URL=""
for i in $(seq 1 30); do
  EXPO_URL=$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' /tmp/cf-expo.log 2>/dev/null | head -1)
  if [ -n "$EXPO_URL" ]; then break; fi
  if ! kill -0 "$EXPO_PID" 2>/dev/null; then
    echo "❌ cloudflared Expo a quitte prematurement. Logs :"
    tail -10 /tmp/cf-expo.log
    exit 1
  fi
  sleep 1
done
if [ -z "$EXPO_URL" ]; then echo "❌ Tunnel Expo echoue (timeout 30s)"; exit 1; fi
echo "✅ Expo : $EXPO_URL"

EXPO_HOST="${EXPO_URL#https://}"

# 5. Mettre a jour .env du UI avec l'URL tunnel API
if [ ! -f "$UI_DIR/.env" ]; then
  echo "❌ Fichier $UI_DIR/.env introuvable"
  exit 1
fi
sed -i '' "s|^EXPO_PUBLIC_API_URL=.*|EXPO_PUBLIC_API_URL=$API_URL|" "$UI_DIR/.env"
echo "✅ .env UI mis a jour"

# 6. Relancer le container Expo avec les variables tunnel
echo "📱 Redemarrage du conteneur Expo..."
cd "$UI_DIR"
REACT_NATIVE_PACKAGER_HOSTNAME="$EXPO_HOST" \
EXPO_PACKAGER_PROXY_URL="$EXPO_URL" \
docker compose up -d --force-recreate >/dev/null 2>&1

# 7. Attendre que Metro reponde sur le tunnel (pas juste localement)
echo "   Attente de Metro..."
for i in $(seq 1 60); do
  if curl -fs "$EXPO_URL" >/dev/null 2>&1; then break; fi
  sleep 2
done

# 8. Sauvegarder les URLs dans /tmp pour les retrouver meme si on perd la sortie
cat > "$URLS_FILE" <<EOF
API_URL=$API_URL
EXPO_URL=$EXPO_URL
EXPO_LINK=exps://$EXPO_HOST
EOF

echo ""
echo "================================================"
echo ""
echo "  🎉 DEMO EXTERNE PRETE"
echo ""
echo "  API   : $API_URL"
echo "  Metro : $EXPO_URL"
echo ""
echo "  📱 Lien a envoyer au testeur :"
echo "  exps://$EXPO_HOST"
echo ""
echo "  (URLs sauvegardees dans $URLS_FILE)"
echo ""
echo "  Le testeur ouvre ce lien avec Expo Go."
echo ""
echo "  Ctrl+C pour tout arreter"
echo ""
echo "================================================"

wait
