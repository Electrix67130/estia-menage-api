#!/bin/bash
# Lance ngrok pour exposer l'API et affiche l'URL publique.
# Usage: ./scripts/ngrok-start.sh

set -e

echo "🚀 Démarrage du tunnel ngrok pour l'API (port 3001)..."
ngrok http 3001 --log=stdout --log-level=warn &
NGROK_PID=$!

# Attendre que le tunnel soit prêt
sleep 2

# Récupérer l'URL publique
API_URL=$(curl -s http://127.0.0.1:4040/api/tunnels | python3 -c "import sys,json; t=json.load(sys.stdin)['tunnels']; print(t[0]['public_url'])" 2>/dev/null)

if [ -z "$API_URL" ]; then
  echo "❌ Impossible de récupérer l'URL ngrok"
  kill $NGROK_PID 2>/dev/null
  exit 1
fi

echo ""
echo "✅ API accessible sur : $API_URL"
echo ""
echo "📱 Pour que l'app pointe dessus, mets a jour buildr-ui/.env :"
echo "   EXPO_PUBLIC_API_URL=$API_URL"
echo ""
echo "🔗 Dashboard ngrok : http://127.0.0.1:4040"
echo ""
echo "Appuie sur Ctrl+C pour arrêter le tunnel."

# Mettre à jour le .env automatiquement
ENV_FILE="$(dirname "$0")/../../buildr-ui/.env"
if [ -f "$ENV_FILE" ]; then
  sed -i '' "s|^EXPO_PUBLIC_API_URL=.*|EXPO_PUBLIC_API_URL=$API_URL|" "$ENV_FILE"
  echo "✅ buildr-ui/.env mis à jour automatiquement"
  echo ""
fi

wait $NGROK_PID
