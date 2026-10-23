# 完成経路の判断機能 — #1858

## 対象と監査

基準main: `f2b56c809fde6f620901001e4186d6e86d35a83d`。
正式GOAL、権限、認証、CI、Human Gateは変更しない。

既存 `GoalControllerRuntime` / `DevelopmentOrchestrator` はGoal解決とTDD作業分解、`WorkState` はDoD・証拠・次工程、`evaluateGoalFromWorkState` は完成判定、`evaluateRiskPolicy` は承認境界、`evaluateRecovery` は再試行/別方式を持つ。既存Planner Enhancementには接続性・資源・失敗に基づく再提案がある。これらを再利用し、候補間の完成寄与・依存関係・早期人間作業・停滞を比較する**助言機能**を追加した。

重複照合: #1817/PR1818は方針文書のみ。#1763/PR1764・1770は継続/起動ロック。#1219/PR1824・1826・1827はBuilder/Verifier経路。別のGoal管理基盤は作らない。Remote Lite PR1832への変更はない。

## 実装契約

- `completion-path.ts`: 既存WorkState/DevelopmentWorkItemを入力し、未達条件へ直接・依存経由で寄与する候補を順位付け。重み/見積りは明示入力で、数学的な最適経路保証ではない。未確認の能力/見積り/根拠は `INVESTIGATE`。
- 完成証拠は種類・環境・検証者・revision・artifact digest・日時を照合。後の失敗、古い版、未来日、Builderだけの主張を採用しない。従来のpassed/waivedだけで実機合格にしない。
- 既存Risk policyを使用。人間操作とHIGHを事前表示し、CRITICALを候補実行から除外。回答は記録だけで、既存Gateへ通す承認トークンにはならない。
- `PREPARED` / `DELIVERED` / `ANSWERED` を区別。実配信はreceiptが必要。延期→後の回答は履歴を保持。同一receiptの改変拒否。対象・操作・理由・期限・影響を保存。
- 完成条件の増減、解消障害、無進捗試行、停滞経過を記録。3回無進捗で再計画。Recoveryの試行はタスク単位で集計し、別タスクの失敗で予算を消費しない。
- `CompassWorkStateStoreAdapter` の既存JSON envelopeへ助言履歴だけを保存。SQLite schema追加なし。既存 `updateActive` transactionを使い、WorkState保存やイベント追加で履歴が失われないようにした。
- 256サイクル/256通知/通知ごと32回答の上限に達したら明示的な整理待ち。未回答を黙って捨てない。Goal変更・異なる履歴混入・古い状態の再利用を拒否。
- Goal ControllerとDevelopmentOrchestratorに明示的な読取メソッドを追加。既存handle/plan/dispatch、Goal/DoD/status/nextActionは変えない。

入力は既存の信頼できるアダプターが作る型付きスナップショット。任意の日本語を自動で漏れなく権限分類する機能や、外部情報の真正性を独力で保証する機能ではない。新しい認証・自然文承認受付・外部送信はない。

## Remote Liteの読み取り専用例

出典: [Issue1831保存点](https://github.com/haji84/AI-/issues/1831#issuecomment-6340796031)、[PR1832](https://github.com/haji84/AI-/pull/1832)。HEAD `08c0f2823634ae2d8fe21294bfd468aeaf9431e5`。保存点の最新セクションを使い、古い未実施記録を現状と混同しない。

```powershell
node scripts/goriq-completion-inspect.ts docs/evidence/1858-remote-lite-snapshot.json
```

結果:

1. `inspect-activation` を **INVESTIGATE** として推奨。発行済み証明書とloopback HTTPSは、常用入口・専用認証・更新運転の完成証拠ではない。既存の有効化計画を照合し、必要な承認差分を確定するのが次の安全な作業。
2. 資格情報/常用起動、Android正式署名鍵、SignPath回答、別回線実機操作の4通知を準備。実際に配信したというreceiptはない。
3. PR1832/Issue1831を再利用する参照を返す。新規Issue/PR作成APIは持たない。
4. 4つの抽出した未達製品条件はすべて未検証。機械的なartifact証明がないため証拠契約を捏造せず `missing_evidence_contract`。これは正式仕様全体の置換/削減ではない。
5. 実機の延期、40台・無人再接続、正式署名の未達を保持。元Issue/PR・端末・資格情報は変更しない。

## 検証と比較

変更前の関連基準テスト: 22 PASS。新規受入テストは未実装モジュールでREDを確認後に実装。実SQLiteファイルをclose→reopenし、通知/回答/評価の復帰・重複抑止・権限状態不変を検査。独立レビューで発見した古い判定再利用、タスク間Recovery混同、代替候補の重複誤判定、延期回答の更新拒否、canonical blocker正規化を修正し回帰テストを追加した。

独立再レビュー: 新規18/18 PASS、別途canonical blockerがある場合の永続/読取同値・replay成功、P1/P2残件なし。`tsc --noEmit` と差分検査成功。ローカル新規worktreeのpnpm展開ではESLint依存の `clear-caches` 欠落を検出したため、そのローカルlint実行は失敗として保持。同一バージョンの既存Remote Lite worktreeのESLint9.39.5/configを明示指定した変更ソースlintは成功。クリーンな通常CIのlint/build/全体テストを別途確認する。

以下はテスト内の**合成FIFO比較モデル**。旧GORIQの実運用速度を測定した値ではない。

|指標|入力順に確認する比較モデル|助言を使った合成シナリオ|
|---|---:|---:|
|1分時点の検証済み条件の前進|0|1（software条件）|
|有用作業までの無効選択|2|0|
|最初の有用作業が終わるモデル時刻|3分|1分|
|人間通知receiptまでのモデル時間|120秒|10秒|

別シナリオでは3回の無進捗後、5分時点の停滞300,000msを検出し別方式を提案。実運用の停滞時間/通知適時性改善は未測定。実機完成条件の増加は **0**。

## 未完了とHuman Gate

現在は明示的に呼ぶ判断/履歴記録まで。通常実行サイクルへの接続、既存所有者UIでの通知配信/回答の取得、受入データの信頼できる自動収集、常用環境での再計画実行は未実装。実行統制を変える次段階は `docs/architecture/goriq-completion-path-activation.md` の具体案で別承認が必要。助言実装・CI成功を全機能の完成としない。

Compass MCPの共有状態は停止中の別件 #1845。今回のscoped write-back先は提供されていないため上書きせず、#1858/専用PRを引継先にする。隔離SQLite試験で実際の永続化を検証する。

## ロールバック

当Issueのコードcommitをレビュー済みrevert。助言履歴は保持し、Goal/鍵/登録/他Issueの状態を削除しない。外部設定・稼働サービス変更はない。
