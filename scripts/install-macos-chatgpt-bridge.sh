#!/bin/zsh
set -euo pipefail

LABEL="com.ai-company.chatgpt-bridge"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
NODE_BIN="$(command -v node || true)"
GH_BIN="$(command -v gh || true)"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG_DIR="$HOME/Library/Logs"
STATE_DIR="$HOME/.ai-company"

if [[ -z "$NODE_BIN" ]]; then
  echo "ERROR: node が見つかりません。Node 24 をインストールしてください。" >&2
  exit 1
fi

if [[ -z "$GH_BIN" ]]; then
  echo "ERROR: gh が見つかりません。GitHub CLI をインストールしてください。" >&2
  exit 1
fi

if [[ ! -d "/Applications/Google Chrome.app" ]]; then
  echo "ERROR: /Applications/Google Chrome.app が見つかりません。Google Chrome をインストールしてください。" >&2
  exit 1
fi

"$GH_BIN" auth status >/dev/null
mkdir -p "$HOME/Library/LaunchAgents" "$LOG_DIR" "$STATE_DIR"

xml_escape() {
  printf '%s' "$1" | sed 's/&/\&amp;/g; s/</\&lt;/g; s/>/\&gt;/g; s/"/\&quot;/g; s/'"'"'/\&apos;/g'
}

NODE_XML="$(xml_escape "$NODE_BIN")"
SCRIPT_XML="$(xml_escape "$REPO_DIR/scripts/chatgpt-resident-bridge.mjs")"
PATH_XML="$(xml_escape "$(dirname "$NODE_BIN"):$(dirname "$GH_BIN"):/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin")"

cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/bin/caffeinate</string>
    <string>-dimsu</string>
    <string>$NODE_XML</string>
    <string>$SCRIPT_XML</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>$PATH_XML</string>
    <key>AI_COMPANY_REPO</key>
    <string>haji84/AI-</string>
    <key>AI_COMPANY_BRIDGE_POLL_MS</key>
    <string>5000</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
  </dict>
  <key>StandardOutPath</key>
  <string>$(xml_escape "$LOG_DIR/AICompanyChatGPTBridge.log")</string>
  <key>StandardErrorPath</key>
  <string>$(xml_escape "$LOG_DIR/AICompanyChatGPTBridge.error.log")</string>
</dict>
</plist>
EOF

plutil -lint "$PLIST"
launchctl bootout "gui/$(id -u)" "$PLIST" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
launchctl kickstart -k "gui/$(id -u)/$LABEL"

echo "MacBook常駐ブリッジを登録しました。"
echo "初回だけ、専用ChromeウインドウでChatGPT Plusへ手動ログインしてください。"
echo "health: $STATE_DIR/chatgpt-bridge-health.json"
echo "log:    $LOG_DIR/AICompanyChatGPTBridge.log"
echo "注意: MacBookの蓋を閉じると通常はスリープします。常駐中は蓋を開けたままAC接続で運用してください。"
