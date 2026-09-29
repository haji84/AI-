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
RUNTIME_DIR="$STATE_DIR/runtime"
BRIDGE_SCRIPT="$RUNTIME_DIR/chatgpt-resident-bridge-v2.mjs"
BRIDGE_LIB="$RUNTIME_DIR/chatgpt-resident-bridge-lib.mjs"
ROUTER_DIR="$STATE_DIR/src/orchestrator"
ROUTER_SCRIPT="$ROUTER_DIR/chat-work-session-router.ts"
LAUNCHER="$RUNTIME_DIR/run-chatgpt-bridge.sh"

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
mkdir -p "$HOME/Library/LaunchAgents" "$LOG_DIR" "$STATE_DIR" "$RUNTIME_DIR" "$ROUTER_DIR"

cp "$REPO_DIR/scripts/chatgpt-resident-bridge-v2.mjs" "$BRIDGE_SCRIPT"
cp "$REPO_DIR/scripts/chatgpt-resident-bridge-lib.mjs" "$BRIDGE_LIB"
cp "$REPO_DIR/src/orchestrator/chat-work-session-router.ts" "$ROUTER_SCRIPT"
chmod 600 "$BRIDGE_SCRIPT" "$BRIDGE_LIB" "$ROUTER_SCRIPT"

cat > "$LAUNCHER" <<LAUNCHER
#!/bin/zsh
set -euo pipefail
unset RUNNER_TRACKING_ID
exec /usr/bin/caffeinate -dimsu "$NODE_BIN" "$BRIDGE_SCRIPT"
LAUNCHER
chmod 700 "$LAUNCHER"

xml_escape() {
  printf '%s' "$1" | sed 's/&/\&amp;/g; s/</\&lt;/g; s/>/\&gt;/g; s/"/\&quot;/g; s/'"'"'/\&apos;/g'
}

LAUNCHER_XML="$(xml_escape "$LAUNCHER")"
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
    <string>$LAUNCHER_XML</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>$PATH_XML</string>
    <key>AI_COMPANY_REPO</key>
    <string>haji84/AI-</string>
    <key>AI_COMPANY_BRIDGE_POLL_MS</key>
    <string>5000</string>
    <key>RUNNER_TRACKING_ID</key>
    <string></string>
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

echo "MacBook常駐ブリッジ v2 を永続ランタイムへ登録しました。"
echo "専用Chromeの既存ログインセッションをそのまま利用します。"
echo "health: $STATE_DIR/chatgpt-bridge-health.json"
echo "log:    $LOG_DIR/AICompanyChatGPTBridge.log"
echo "注意: MacBookの蓋を閉じると通常はスリープします。常駐中は蓋を開けたままAC接続で運用してください。"
