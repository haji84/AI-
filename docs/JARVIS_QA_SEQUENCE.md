# JARVIS QA Sequence

This flow is intended for owned or explicitly authorized QA environments.

## State machine

1. Open URL 1 exactly once.
2. Observe the Android UI hierarchy without re-opening the URL.
3. If an error marker is detected, force-stop the configured Android package, mark the run `error-no-retry`, and do not open URL 2.
4. If all URL 1 success markers are detected, open URL 2 exactly once.
5. Observe the UI hierarchy again.
6. If an error marker is detected, force-stop the configured Android package, mark the run `error-no-retry`, and do not re-open the URL.
7. If all URL 2 success markers are detected, force-stop the configured Android package and mark the run `done`.
8. If a success state cannot be determined before timeout, stop without automatic re-execution so Remote Assist can inspect the device.

## Default markers

Error has highest priority:
- お友達のお手伝いが出来ませんでした
- あなたのアカウントでエラーが発生しました
- 別のアカウントでお試しください

URL 1 success requires all markers observed in the supplied green success state:
- イベント詳細
- 新規ユーザー
- 30日以上アプリを使っていない人
- その他の既存ユーザー

URL 2 success requires all:
- 受け取りました
- マイQRコードを表示

The marker rules are configuration-driven inside the gateway and can be replaced when the authorized QA UI changes.

## Remote Gateway API

- `POST /api/remote/qa-sequence/start`
- `POST /api/remote/qa-sequence/status`

Only devices in `JARVIS_REMOTE_ALLOWED_SERIALS` are accepted. Raw ADB and arbitrary shell access are not exposed by the gateway.
