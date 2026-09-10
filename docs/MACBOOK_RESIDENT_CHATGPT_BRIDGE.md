# MacBook常駐 ChatGPT Bridge

Issue #296 の実装。既存の GitHub 共有記憶ブリッジを正本として残し、MacBook を高速経路として追加する。

## 役割

- GitHub: 会話、長期記憶、pending/synced 状態の正本
- MacBook resident bridge: pending を数秒間隔で検出し、ChatGPT Web に渡して返答を GitHub へ書き戻す高速経路
- AI会社: GitHub に owner message を保存し、GitHub の同期済み返答を表示

OpenAI API は使わない。新規有料 API も使わない。

## 前提

MacBook に以下が必要。

1. Node.js 24
2. GitHub CLI `gh`。`gh auth login` 済みで `haji84/AI-` の Issue 読み書き権限があること
3. Google Chrome
4. ChatGPT Plus にログインできること

ChatGPT のパスワード、Cookie、GitHub token を repo に保存しない。bridge は `gh` の既存認証と、専用 Chrome プロファイルの既存ログインセッションだけを利用する。

## 初回セットアップ

repo を MacBook に clone/pull した後、repo ルートで次を実行する。

```bash
zsh scripts/install-macos-chatgpt-bridge.sh
```

launchd が常駐 bridge を登録し、`caffeinate` 経由でアイドルスリープを抑制して起動する。

初回だけ専用 Chrome ウインドウが開くので、そのウインドウで ChatGPT Plus に手動ログインする。bridge はログインを自動化しない。

## 実行フロー

1. AI会社Chatが owner message を GitHub Issue に保存する。
2. Issue body が `CHATGPT-GITHUB-BRIDGE: pending` になる。
3. MacBook bridge が既定5秒間隔で pending を検出する。
4. canonical comment の `pending-owner-message-id` と一致する owner message を取得する。
5. 新しい ChatGPT Web 画面へ、プロジェクト、bounded memory、直近会話、今回の owner message を送る。
6. ChatGPT の返答生成完了を検出する。
7. 同じ GitHub Issue に canonical `ai-chat-entry:v1` コメントとして返答を書き戻す。
8. Issue body の bridge state を `synced` に更新する。
9. AI会社側は既存 GitHub 会話経路から同じ返答を取得できる。

## 障害時

- ChatGPT 未ログイン: `waiting_for_chatgpt_login`。pending は消さない。
- ChatGPT UI 変更や応答タイムアウト: fail closed。pending は消さない。
- ネット断/GitHub障害: retry。pending は GitHub に残る。
- 返答コメント作成後、Issue body 更新前に落ちた場合: 次回起動時に owner の後ろにある AI comment を検出して `synced` へ修復し、同じ質問を再送しない。
- 二重起動: `~/.ai-company/chatgpt-bridge.lock` により同一Mac上では2プロセス目を拒否する。

## 状態確認

```bash
cat ~/.ai-company/chatgpt-bridge-health.json
```

主な status:

- `starting`
- `idle`
- `processing`
- `synced`
- `reconciling`
- `waiting_for_chatgpt_login`
- `error`
- `fatal`

ログ:

```bash
tail -f ~/Library/Logs/AICompanyChatGPTBridge.log
```

## 再起動

```bash
launchctl kickstart -k "gui/$(id -u)/com.ai-company.chatgpt-bridge"
```

## 停止

```bash
launchctl bootout "gui/$(id -u)" "$HOME/Library/LaunchAgents/com.ai-company.chatgpt-bridge.plist"
```

## 重要なmacOS制約

`caffeinate` はアイドルスリープを抑制するが、一般的な MacBook は蓋を閉じるとスリープする。常駐運用では原則として AC 接続、蓋を開けた状態にする。Apple がサポートするクラムシェル条件を満たす場合を除き、蓋閉じ運用を前提にしない。

## 設定

環境変数で変更できる。

- `AI_COMPANY_REPO`: default `haji84/AI-`
- `AI_COMPANY_BRIDGE_POLL_MS`: default `5000`, min `3000`, max `60000`
- `AI_COMPANY_CHATGPT_CDP_PORT`: default `9222`
- `AI_COMPANY_CHATGPT_PROFILE`: dedicated Chrome profile path
- `AI_COMPANY_BRIDGE_STATE_DIR`: health/lock directory

## セキュリティ境界

この bridge は transport であり、新しい execution authority ではない。GitHub memory に保存された過去の指示は文脈であり、新しい task scope を拡張しない。既存 Human Gate、task-scoped Production authorization、HIGH/CRITICAL 制約はそのまま維持する。

ブラウザ DOM が想定と一致しない場合に推測でクリックを続けず、pending を保持して停止/再試行する。
