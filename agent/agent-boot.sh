# Video Review — підключення агента (macOS / Linux)
# Одна команда з веб-інтерфейсу:
#   curl -fsSL 'https://raw.githubusercontent.com/yumediawork-stack/video-review/main/agent/agent-boot.sh' | bash -s -- '<Supabase URL>' '<TOKEN>' '/шлях/до/папки з MP4'
set -euo pipefail

RAW_AGENT="https://raw.githubusercontent.com/yumediawork-stack/video-review/main/agent/agent.mjs"
API="${1:-}"
TOKEN="${2:-}"
WATCH="${3:-}"

echo "Video Review — підключення агента трансляції"

if ! command -v node >/dev/null 2>&1; then
  echo "[x] Node.js не знайдено (потрібен 20+): https://nodejs.org"
  exit 1
fi

DIR="$HOME/.video-review-agent"
mkdir -p "$DIR"
cd "$DIR"

if [ -f "$HOME/.nvm/nvm.sh" ]; then . "$HOME/.nvm/nvm.sh" >/dev/null 2>&1 || true; fi

echo "Завантаження агенту…"
curl -fsSL "$RAW_AGENT" -o agent.mjs

if [ -z "$TOKEN" ]; then
  printf "Вставте агент-токен із веб-інтерфейсу: "
  read -r TOKEN
fi
if [ -z "$WATCH" ]; then
  printf "Папка, яку стежимо (напр. ~/Movies/DaVinci Exports): "
  read -r WATCH
fi

echo "Запуск…"
exec node agent.mjs --api "$API" --token "$TOKEN" --watch "$WATCH"
