# #1858 完成経路の実行接続・通知記録

基準main `a500c70dd3585aeb83596f7d85cf7ee2975dbe2a`、2026-10-23。先行助言PR1859に続く同Issueの承認済み接続工程。Remote Lite1831/1832は読取専用の分析例のまま変更しない。

## 実装した境界

- 既存Goal Loop / Planner Enhancement / WorkState / DevelopmentOrchestratorへ、ホストが明示選択する `CompletionSource` を接続。候補と実際のAction、Goal/DoD、能力、依存関係を照合する。HTTPやモデル入力から実行カタログを登録できない。
- Planningの能力名と既存registryの名前はホストの明示対応表で結び付ける。対応表はexecutorを追加しない。必要なBuilderが未設定なら既存経路で停止する。
- 通常実行は既存Risk/Human Gate/Child Work Item/Verifierを通す。実行前にWorkStateとcheckpointをSQLite transaction内で比較。実行途中で停止したcheckpointは再起動後も残し、副作用を再実行せず独立照合を要求する。
- 新たな失敗証拠は修復実行の前に古いPASSを失効させる。結果の評価、検証条件、pending解除を一括保存し、失敗時に一部だけ完成にならない。結果不明の自動再試行やpendingの強制消去はしない。
- 既存所有者Work API・Tasks画面に必要操作/理由/対象/期限/影響を表示。画面に表示された通知だけをPOSTで記録。GETや表示receipt、クライアントのapprovedフィールドは実行承認にならない。既存Action単位承認キーの結果だけを承認回答として記録する。
- 新サーバー、DB schema、秘密情報、権限、公開、課金、workflow変更はない。既存本番呼び出し元は未変更で、機能はホストが明示選択するまで作動しない。

## 実行した検証

```powershell
node --test tests/completion-execution.test.ts tests/development-completion-integration.test.ts tests/completion-notifications-http.test.ts tests/completion-notifications-ui.test.mjs
node node_modules/typescript/bin/tsc --noEmit
```

新規21件が全件成功: SQLite永続化・再起動、実ファイルの書込/独立読戻し、既存DevelopmentPlanの準備→実装→検証依存関係、実CompassGoalExecutionAdapterの既存context.inspect経路、能力名の対応、既存Action承認、Human Gate待ちを残した別作業、3回失敗後の方式変更、CI/実機の分離、競合と失敗注入を検証。型検査、変更ソースlint、差分検査も成功。ローカルlintは先行工程と同様、同バージョンの既存worktreeのESLintを明示使用し、通常環境の全体lintはCIで別途確認する。

独立レビューで5件（子作業binding欠落、予約時の競合、結果の非一括保存、明示承認のhandshake漏れ、riskのfalse上書き）を再現し修正。再レビューの2件（古い完成評価の公開、修復前のPASS失効漏れ）と既存waiver残存もRED→GREENで修正。最終独立レビューは未解消指摘なし。テスト基準や正式要件は緩和していない。全体CI・統合後main CIの結果はIssue1858と対応PRに保存する。

ローカルWindowsの `node --test` は2,660件中2,617 PASS / 18 FAIL / 1 CANCEL / 24 SKIPで失敗。失敗箇所は変更外のPowerShell/DPAPI、Mac/Bash、workflow文字列照合、symlink/移行、端末登録のタイムアウト。今回の21件と逆引き台帳検査は成功している。変更外ファイルは本差分に含めず、GitHubの通常CIとWindows専用検査を別に確認する。全体成功として記録しない。

実Broker HTTP: 所有者認証なし401、未知通知/承認フィールド409、有効な表示receiptと再送200、SQLite再読込でDELIVERED・approvalなし。UIは実TSX出力検査に加え、Edge155.0.4283.62の隔離ブラウザで実コンポーネントを起動し、IntersectionObserverによる表示後POST1件・DELIVERED・console error0を確認。後者のHTTPはローカルfixtureであり、常用所有者セッションでの動作検証ではない。画面取得と結果はローカル `.jarvis/completion-browser-WDkEYZ/` に保存した。

## 同条件比較

同じ合成Goal/候補から、実SQLiteと実ファイル読戻しを使い、既存Planner経路と接続経路を比較した。

|指標|既存Planner経路|接続経路|
|---|---:|---:|
|検証済みsoftware条件の前進|0|1|
|完成に寄与しない選択|1|0|
|最初の有用実行前の人間通知記録|なし|あり|
|実機条件の前進|0|0|

別の隔離試験では失敗を3回記録して再起動し、別方式で条件が1件前進することを確認。実運用の停滞時間短縮は未測定。先行助言テストの300,000msは合成時計であり、製品の速度実績へ換算しない。

## 残条件と次工程

常用ホストによる対象Goalの候補/証拠adapter選択、実際の端末・外部サービスからの証拠取得、常用Tasks画面への配信/回答の実運用受入は未実施。任意の自然言語Goalから信頼できる全依存関係を自動抽出できると主張しない。未知情報は調査候補として保持する。

次は対象Goal、カタログ、証拠issuer、対象root、稼働時間、停止/復旧方法を固定した常用有効化案をレビューし、別Human Gate後に実運用受入する。今回のCI・隔離成功をRemote Liteの実機成功や全製品完成として扱わない。

Compass共有状態は別件#1845の停止記録であり、scoped書戻し先がないため変更しない。引継ぎはIssue1858と対応PRに記録する。

## ロールバック

本接続のcommitを既存レビュー/CI経由でrevertする。既存Goal、通知履歴、証拠、pending checkpointを削除しない。常用有効化をしていないためサービス停止や鍵の破棄は不要。
