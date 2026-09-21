# JARVIS Owner Operator Guide

このガイドは、日常の確認と通常操作をJARVISの画面だけで行うためのものです。開発者向けコマンドは日常操作の前提にしません。

## 普段の使い方

1. `/jarvis` Home
   - 全体の状態を確認する。
   - 異常や待機があれば、表示された状態を成功扱いせず次の確認先へ進む。

2. `/jarvis/tasks` Tasks
   - 進行中、待機中、完了済みのタスクを確認する。
   - Human Gateが表示された場合は、理由を確認し、通常操作で解除しない。

3. `/jarvis/devices` Devices / Remote Assist
   - 接続状態と既存のRemote Assist入口を確認する。
   - 端末の再登録や権限変更は日常操作に含めない。

4. `/jarvis/diagnostics` Diagnostics
   - `ready`、`blocked`、`pending`、`unknown`を確認する。
   - `unknown`は正常ではなく「確認できていない」状態として扱う。

5. `/jarvis/recovery` Recovery
   - blockerとnext actionを確認する。
   - この画面は状態確認用であり、復旧の強制実行、Human Gate解除、Production切替を行わない。

## 初回セットアップ

`/jarvis/setup` は初回構成や再確認が必要な場合に使います。日常操作の入口にはしません。

Setup画面が存在していても、次の操作を自動承認した意味にはなりません。

- 端末の再登録
- 端末アプリの更新
- secrets / credentialsの変更
- permission / token scopeの変更
- firewall / network公開範囲の変更
- billingの変更
- Human Gateの解除
- 実機受入やProduction切替

これらは、それぞれの既存Gateと承認条件に従います。

## 止めるべき状態

次の表示は「成功」ではありません。

- Human Gate
- physical acceptance pending
- blocked
- unknown

理由とnext actionを確認し、根拠が揃うまで状態を勝手に昇格させません。

## 障害時の確認順

1. Homeで全体状態を確認する。
2. Diagnosticsでどの領域が`blocked`、`pending`、`unknown`か確認する。
3. Recoveryでblockerとnext actionを確認する。
4. Human Gateまたはphysical acceptanceが必要なら、そこで止める。

このガイドは復旧操作そのものを自動実行せず、既存の安全境界を迂回しません。
