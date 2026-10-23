# #1858 次段階の実行接続案 — 未承認・未実装

Ownerの2026-10-23指示にある「実行権限や開発統制を変更する部分は具体差分とリスクを提示しHuman Gate後に実装」に従う。

## 今回検証する部分

`GoalControllerRuntime.inspectCompletionPath` / `DevelopmentOrchestrator.assessCompletionPath` と、既存Compass WorkState envelopeへの助言記録。既存実行経路から自動呼び出しはしない。

## 次段階の変更案

|変更対象|追加する処理|残す境界|
|---|---|---|
|`src/orchestrator/work-state-integration.ts`|既存サイクルの計画前に、現在Goal/DoD・検証結果・既存job/能力状態から信頼済みCompletionInputを作る。検証後に同じWorkState journalへ記録|Goal/DoDの書換え・passedの昇格なし|
|`src/orchestrator/planner-enhancement.ts`|助言の上位候補を既存Plannerへ渡す。承認待ち候補を保持し、許可済みの別の候補へ再計画。元Actionと候補ID/対象を照合し、対応しないActionは実行へ渡さない|既存のRisk/Human Gate/Child Work Item/Verifier/Recoveryをすべて通す|
|`src/app/api/jarvis/work/[goalId]/route.ts` と既存Tasks通知画面|既存所有者認証の下で必要操作・理由・対象・期限・影響を表示。表示確認と既存承認記録の参照をjournalへ保存|新しい承認入口・権限・token・外部送信は追加しない。画面表示だけで承認済みにしない|
|関連する隔離テスト|再起動後の再計画、承認待ちと別作業、重複通知、対応しないAction拒否、実機証拠不足を検査|CIを実機成功としない|

## リスクと受入

作業順序が変わるため、既存タスクの飢餓・誤った依存関係・古い観測により進行が止まる可能性がある。既存実行権限は増えないが、実行統制に影響する。初期は隔離環境で既存Plannerとの比較/影響記録を取り、未知入力では実行せず調査へ戻す。通知は既存所有者画面だけとし、メール/他者への送信を含めない。

承認対象は **このIssueで上記の実行接続コードと隔離テストを実装すること**。常用環境への有効化、課金、認証情報、OS権限、公開、保護規則変更は含めない。独立レビュー・CI・既存統合規則を満たすまで有効化しない。

## ロールバック

接続差分をrevertして既存Plannerへ戻す。通知/判断履歴と未達Goalを保持。データ削除やGate解除で復旧しない。
