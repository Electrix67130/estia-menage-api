#!/bin/bash
# Demo externe : expose UNE app de la stack via cloudflared.
# Les apps se lancent SEPAREMENT (une par terminal), via les lanceurs dedies
# demo-mobile.sh / demo-dashboard.sh / demo-website.sh, ou directement :
#
#   ./scripts/demo.sh dashboard      # dashboard (+ API)
#   ./scripts/demo.sh website        # site vitrine (sans API)
#   ./scripts/demo.sh mobile         # app mobile Expo (+ API)
#
# MULTI-INSTANCES : on peut lancer plusieurs demo.sh EN PARALLELE (terminaux
# differents), p.ex. `demo.sh dashboard` ici et `demo.sh website` la. Chaque
# instance ne coupe que SES tunnels. L'API (port 3010) est tunnelisee une seule
# fois et PARTAGEE : la 1ere instance qui en a besoin la cree (et pose un
# verrou), les suivantes reutilisent la meme URL.
#
# Protocole QUIC par defaut ; si ton reseau bloque l'UDP : CF_PROTOCOL=http2 ...
# Ctrl+C pour arreter (remet en local les cibles gerees par CETTE instance).

set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
API_DIR="$(dirname "$SCRIPT_DIR")"
UI_DIR="$API_DIR/../estia-menage-ui"
DASH_DIR="$API_DIR/../estia-menage-dashboard"
WEB_DIR="$API_DIR/../estia-menage-website"

API_PORT=3010
METRO_PORT=18083
DASH_PORT=3012
WEB_PORT=3013

API_LOCK="/tmp/estia-menage-demo-api.lock"   # ligne1=PID owner, ligne2=URL API

# --- Parsing des cibles -----------------------------------------------------
WANT_MOBILE=0 WANT_DASHBOARD=0 WANT_WEBSITE=0
if [ "$#" -eq 0 ]; then
  echo "Usage : ./scripts/demo.sh <mobile|dashboard|website>"
  echo "   ou un lanceur dedie : demo-mobile.sh / demo-dashboard.sh / demo-website.sh"
  echo "   (les apps se lancent separement, une par terminal)"
  exit 1
fi
for arg in "$@"; do
  case "$arg" in
    mobile)    WANT_MOBILE=1 ;;
    dashboard) WANT_DASHBOARD=1 ;;
    website)   WANT_WEBSITE=1 ;;
    *) echo "❌ Cible inconnue : '$arg' (attendu : mobile, dashboard, website)"; exit 1 ;;
  esac
done
NEED_API=0
if [ "$WANT_MOBILE" = 1 ] || [ "$WANT_DASHBOARD" = 1 ]; then NEED_API=1; fi

# Signature de l'instance (= ses cibles) : sert a la nommer et a ne relancer que
# l'instance identique precedente, sans toucher aux autres demo.sh en cours.
SIG=""
[ "$WANT_MOBILE" = 1 ]    && SIG="${SIG}m"
[ "$WANT_DASHBOARD" = 1 ] && SIG="${SIG}d"
[ "$WANT_WEBSITE" = 1 ]   && SIG="${SIG}w"
PID_FILE="/tmp/estia-menage-demo-$SIG.pid"
URLS_FILE="/tmp/estia-menage-demo-$SIG.urls"

# Tunnels (logs) geres par CETTE instance ; le .pid associe contient le PID cloudflared.
MY_TUNNEL_LOGS=""
I_OWN_API=0

# --- Helpers ----------------------------------------------------------------
kill_tunnel_log() { local pf="${1%.log}.pid"; [ -f "$pf" ] && { kill "$(cat "$pf" 2>/dev/null)" 2>/dev/null || true; rm -f "$pf"; }; rm -f "$1"; }

# Tue tout cloudflared deja branche sur CE port local (orphelin d'un run ferme
# sans Ctrl+C). Cible uniquement le port -> n'impacte pas les autres instances.
kill_stale_port() { pkill -f "cloudflared tunnel --url http://localhost:$1 " 2>/dev/null || true; }

reset_api_env() {
  IP=$(ipconfig getifaddr en0 2>/dev/null || echo "localhost")
  if [ -f "$API_DIR/.env" ]; then
    sed -i '' "s|^APP_URL=.*|APP_URL=http://$IP:$API_PORT|" "$API_DIR/.env"
    docker restart estia-menage-api >/dev/null 2>&1 || true
  fi
}

cleanup() {
  echo ""
  echo "🛑 Arret (cibles$([ -n "$SIG" ] && echo " $SIG"))..."
  # Tunnels de cette instance (hors API).
  for lg in $MY_TUNNEL_LOGS; do [ "$lg" = "/tmp/cf-api.log" ] && continue; kill_tunnel_log "$lg"; done
  # API : seulement si CETTE instance en est proprietaire.
  if [ "$I_OWN_API" = 1 ]; then
    kill_tunnel_log /tmp/cf-api.log
    rm -f "$API_LOCK"
    IP=$(ipconfig getifaddr en0 2>/dev/null || echo "localhost")
    [ "$WANT_MOBILE" = 1 ] && [ -f "$UI_DIR/.env" ] && \
      sed -i '' "s|^EXPO_PUBLIC_API_URL=.*|EXPO_PUBLIC_API_URL=http://$IP:$API_PORT|" "$UI_DIR/.env"
    reset_api_env
  fi
  # Conteneurs geres par cette instance.
  if [ "$WANT_MOBILE" = 1 ] && docker ps --format '{{.Names}}' 2>/dev/null | grep -q "^estia-menage-ui-web$"; then
    cd "$UI_DIR" && docker compose up -d --force-recreate >/dev/null 2>&1 || true
  fi
  [ "$WANT_DASHBOARD" = 1 ] && [ -d "$DASH_DIR" ] && { cd "$DASH_DIR" && docker compose down >/dev/null 2>&1 || true; }
  [ "$WANT_WEBSITE" = 1 ]   && [ -d "$WEB_DIR" ]  && { cd "$WEB_DIR"  && docker compose down >/dev/null 2>&1 || true; }
  rm -f "$URLS_FILE" "$PID_FILE"
  echo "✅ Remis en local"
  exit 0
}
trap cleanup INT TERM

# Lance un tunnel cloudflared sur $1, log $2, nom $3 ; ecrit le PID dans ${2%.log}.pid,
# renvoie l'URL sur stdout. 3 tentatives (trycloudflare time-out parfois a la creation).
start_tunnel() {
  local port="$1" logf="$2" name="$3" url="" pid attempt
  for attempt in 1 2 3; do
    : > "$logf"
    cloudflared tunnel --url "http://localhost:$port" \
      --protocol "${CF_PROTOCOL:-quic}" --retries 5 --no-autoupdate > "$logf" 2>&1 &
    pid=$!
    echo "$pid" > "${logf%.log}.pid"
    url=""
    for _ in $(seq 1 30); do
      url=$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$logf" 2>/dev/null | head -1)
      [ -n "$url" ] && break
      grep -q "failed to request quick Tunnel" "$logf" 2>/dev/null && break
      kill -0 "$pid" 2>/dev/null || break
      sleep 1
    done
    [ -n "$url" ] && { echo "$url"; return 0; }
    echo "⚠️  Tunnel $name : tentative $attempt KO, on retente..." >&2
    kill "$pid" 2>/dev/null || true
    sleep 2
  done
  echo "❌ Tunnel $name echoue apres 3 tentatives. Logs :" >&2; tail -10 "$logf" >&2
  return 1
}

wait_http() { local url="$1" tries="${2:-60}" gap="${3:-1}"; for _ in $(seq 1 "$tries"); do curl -fs "$url" >/dev/null 2>&1 && return 0; sleep "$gap"; done; return 1; }

# --- Pre-cleanup : seulement l'instance IDENTIQUE precedente (meme SIG) ------
echo "🧹 Nettoyage de l'instance precedente ($SIG)..."
if [ -f "$PID_FILE" ]; then
  OLD_PID=$(cat "$PID_FILE" 2>/dev/null || true)
  if [ -n "$OLD_PID" ] && [ "$OLD_PID" != "$$" ] && kill -0 "$OLD_PID" 2>/dev/null; then
    echo "   Ancienne instance $SIG (PID $OLD_PID), arret..."
    kill -TERM "$OLD_PID" 2>/dev/null || true
    for _ in $(seq 1 6); do kill -0 "$OLD_PID" 2>/dev/null || break; sleep 1; done
    kill -KILL "$OLD_PID" 2>/dev/null || true
  fi
fi
echo "$$" > "$PID_FILE"
sleep 1

CIBLES=""
[ "$WANT_MOBILE" = 1 ]    && CIBLES="$CIBLES mobile"
[ "$WANT_DASHBOARD" = 1 ] && CIBLES="$CIBLES dashboard"
[ "$WANT_WEBSITE" = 1 ]   && CIBLES="$CIBLES website"
echo "🎯 Cibles :$CIBLES"

command -v cloudflared >/dev/null 2>&1 || { echo "❌ cloudflared introuvable. brew install cloudflared"; exit 1; }

API_URL="" EXPO_URL="" EXPO_HOST="" DASH_URL="" WEB_URL=""

# --- 1. API (creee une fois, partagee via verrou) ---------------------------
if [ "$NEED_API" = 1 ]; then
  echo "🔍 Verification de l'API..."
  if ! curl -fs "http://localhost:$API_PORT/health" >/dev/null 2>&1; then
    echo "⚠️  API down, demarrage du conteneur..."
    cd "$API_DIR"; docker compose up -d >/dev/null 2>&1 || true
    wait_http "http://localhost:$API_PORT/health" 20 1 || { echo "❌ API injoignable. Lance : docker compose up -d"; exit 1; }
  fi
  echo "✅ API OK"

  # Reutilise le tunnel API d'une autre instance s'il est vivant.
  if [ -f "$API_LOCK" ]; then
    OWNER=$(sed -n 1p "$API_LOCK" 2>/dev/null); LOCK_URL=$(sed -n 2p "$API_LOCK" 2>/dev/null)
    if [ -n "$OWNER" ] && kill -0 "$OWNER" 2>/dev/null && [ -n "$LOCK_URL" ]; then
      API_URL="$LOCK_URL"
      echo "🔗 Reutilisation du tunnel API existant : $API_URL"
    else
      rm -f "$API_LOCK"
    fi
  fi

  if [ -z "$API_URL" ]; then
    kill_stale_port "$API_PORT"
    echo "🌐 Tunnel API (port $API_PORT)..."
    API_URL=$(start_tunnel "$API_PORT" /tmp/cf-api.log "API") || exit 1
    MY_TUNNEL_LOGS="$MY_TUNNEL_LOGS /tmp/cf-api.log"
    I_OWN_API=1
    printf '%s\n%s\n' "$$" "$API_URL" > "$API_LOCK"
    echo "✅ API : $API_URL (proprietaire)"
    if [ -f "$API_DIR/.env" ]; then
      echo "📝 APP_URL=$API_URL + restart"
      if grep -q "^APP_URL=" "$API_DIR/.env"; then
        sed -i '' "s|^APP_URL=.*|APP_URL=$API_URL|" "$API_DIR/.env"
      else
        echo "APP_URL=$API_URL" >> "$API_DIR/.env"
      fi
      docker restart estia-menage-api >/dev/null 2>&1 || true
      wait_http "http://localhost:$API_PORT/health" 20 1 || true
    fi
  fi
fi

# --- 2. Mobile (Expo Metro) -------------------------------------------------
if [ "$WANT_MOBILE" = 1 ]; then
  echo ""
  kill_stale_port "$METRO_PORT"
  echo "🌐 Tunnel Expo Metro (port $METRO_PORT)..."
  EXPO_URL=$(start_tunnel "$METRO_PORT" /tmp/cf-metro.log "Expo") || exit 1
  MY_TUNNEL_LOGS="$MY_TUNNEL_LOGS /tmp/cf-metro.log"
  echo "✅ Expo : $EXPO_URL"
  EXPO_HOST="${EXPO_URL#https://}"
  [ -f "$UI_DIR/.env" ] || { echo "❌ $UI_DIR/.env introuvable"; exit 1; }
  sed -i '' "s|^EXPO_PUBLIC_API_URL=.*|EXPO_PUBLIC_API_URL=$API_URL|" "$UI_DIR/.env"
  echo "📱 Redemarrage du conteneur Expo..."
  cd "$UI_DIR"
  REACT_NATIVE_PACKAGER_HOSTNAME="$EXPO_HOST" \
  EXPO_PACKAGER_PROXY_URL="$EXPO_URL" \
  docker compose up -d --force-recreate >/dev/null 2>&1
  echo "   Attente de Metro..."
  wait_http "$EXPO_URL" 60 2 || true
fi

# --- 3. Dashboard -----------------------------------------------------------
if [ "$WANT_DASHBOARD" = 1 ]; then
  [ -d "$DASH_DIR" ] || { echo "❌ Dossier dashboard introuvable : $DASH_DIR"; exit 1; }
  echo ""
  echo "📊 Demarrage du dashboard (port $DASH_PORT)..."
  cd "$DASH_DIR"
  PORT="$DASH_PORT" NEXT_PUBLIC_API_URL="$API_URL" docker compose up -d --force-recreate >/dev/null 2>&1
  wait_http "http://localhost:$DASH_PORT" 60 1 || true
  kill_stale_port "$DASH_PORT"
  echo "🌐 Tunnel dashboard (port $DASH_PORT)..."
  DASH_URL=$(start_tunnel "$DASH_PORT" /tmp/cf-dash.log "dashboard") || exit 1
  MY_TUNNEL_LOGS="$MY_TUNNEL_LOGS /tmp/cf-dash.log"
  echo "✅ Dashboard : $DASH_URL"
  wait_http "$DASH_URL" 60 2 || true
fi

# --- 4. Website (sans API) --------------------------------------------------
if [ "$WANT_WEBSITE" = 1 ]; then
  [ -d "$WEB_DIR" ] || { echo "❌ Dossier website introuvable : $WEB_DIR"; exit 1; }
  echo ""
  echo "🌍 Demarrage du website (port $WEB_PORT)..."
  cd "$WEB_DIR"
  PORT="$WEB_PORT" docker compose up -d --force-recreate >/dev/null 2>&1
  wait_http "http://localhost:$WEB_PORT" 60 1 || true
  kill_stale_port "$WEB_PORT"
  echo "🌐 Tunnel website (port $WEB_PORT)..."
  WEB_URL=$(start_tunnel "$WEB_PORT" /tmp/cf-web.log "website") || exit 1
  MY_TUNNEL_LOGS="$MY_TUNNEL_LOGS /tmp/cf-web.log"
  echo "✅ Website : $WEB_URL"
  wait_http "$WEB_URL" 60 2 || true
fi

# --- 5. Sauvegarde + recap --------------------------------------------------
{
  [ -n "$API_URL" ]  && echo "API_URL=$API_URL"
  [ -n "$EXPO_URL" ] && { echo "EXPO_URL=$EXPO_URL"; echo "EXPO_LINK=exps://$EXPO_HOST"; }
  [ -n "$DASH_URL" ] && echo "DASH_URL=$DASH_URL"
  [ -n "$WEB_URL" ]  && echo "WEB_URL=$WEB_URL"
} > "$URLS_FILE"

echo ""
echo "================================================"
echo ""
echo "  🎉 DEMO PRETE"
echo ""
[ -n "$API_URL" ]  && echo "  API       : $API_URL"
[ -n "$EXPO_URL" ] && echo "  Metro     : $EXPO_URL"
[ -n "$DASH_URL" ] && echo "  Dashboard : $DASH_URL"
[ -n "$WEB_URL" ]  && echo "  Website   : $WEB_URL"
echo ""
echo "  🔗 Liens a envoyer au testeur :"
[ -n "$EXPO_HOST" ] && echo "  📱 App mobile (Expo Go) : exps://$EXPO_HOST"
[ -n "$DASH_URL" ]  && echo "  💻 Dashboard            : $DASH_URL"
[ -n "$WEB_URL" ]   && echo "  🌍 Website              : $WEB_URL"
echo ""
echo "  (URLs dans $URLS_FILE)"
echo "  Ctrl+C pour arreter cette instance."
echo ""
echo "================================================"

# Maintient l'instance au premier plan jusqu'a Ctrl+C. On ne peut pas `wait` sur
# les cloudflared (lances dans des sous-shells via $(...) -> pas des jobs de ce
# shell). On surveille donc leur liveness et on previent si l'un tombe.
while :; do
  sleep 5
  for lg in $MY_TUNNEL_LOGS; do
    pf="${lg%.log}.pid"; tpid=$(cat "$pf" 2>/dev/null || true)
    if [ -n "$tpid" ] && ! kill -0 "$tpid" 2>/dev/null; then
      echo "⚠️  Tunnel $(basename "${lg%.log}" | sed 's/^cf-//') est tombe. Relance l'instance si besoin."
      rm -f "$pf"
    fi
  done
done
