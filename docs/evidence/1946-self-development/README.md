# #1946: 実ソース修復と同一Goalの次Jobを接続

基点: main `6b16c31212e8b54c28ef2ca1c81ad34b916fc40d`。親: #681 / #921 / #1944。Owner指示: 「OKならそこを接続して実装して」。原#1219 GoalFCC / rotation37のNOT_ACHIEVED・G1 HOLDは維持。

## 実装

既存の `tracked-source-repair-v1` のステージを抽出し、既存の1つのResidentDevelopmentGoalHostから、承認済みの複数Jobへ委譲する `tracked-source-sequence-v1` を追加した。モデル実行、凍結RED probe、ソース/モデルpin、署名検証、修復履歴、完了判定は既存実装を使う。通常executor・receipt wake・次Goalへの権限持越し拒否へ接続した。

ホスト設定は `GORIQ_TRACKED_REPAIR_SEQUENCE_FILE` と `GORIQ_TRACKED_REPAIR_SEQUENCE_SHA256`。前者は外部manifestの絶対パス、後者はその正確なSHA256。既存profileとは排他。manifestは `{version:1,profile:"tracked-source-sequence-v1",sequence,repairs:[{key,manifestFile,manifestSha256}]}`。各leafは既存の1 Job manifestであり、sequenceのGoal/scope/criteria/expiryと完全に一致する。完全な外側pinをJob識別に含める。

LOWのverified-local-artifactだけを扱う。Jobは最大32、修復はleafが事前に用意した別worktree/receiptだけを使う。入力文やモデルはmanifest、作業範囲、署名者、次Jobを追加できない。Windowsの別名も実ファイルシステムのidentityへ正規化し、全leaf間のworkspace・receipt/request・authorityの重複を拒否する。全ステージが同じJob/Change Set storeを共有する。

実検証で見つかった修復promptの重複を除去し、30KB上限を維持した。初回から凍結probeを提示し、置換は宣言を含む全文であることを明記した。修復時は署名検証済みの前候補を1回だけ提示し、置換対象は元baselineのSLOTと明記する。

## 証拠の区分

- 通常の認証付きBroker subprocess試験: 同じGoalで1件目のreceipt後に2件目が自動開始。各Jobの待機中にBrokerを再起動し、モデル呼出しは各1回、Jobの重複なし。transportと署名はfixture。最終直列実行は4件PASS。
- 新compositionのpin/criteria/排他/Windows別名拒否、pause/authority拒否、2件目Jobの複数回修復、実サイズpromptの回帰を検証。各問題のREDと修正後GREENを保持。
- 本体で見つかった明示null予算と破損済み成果物の完了表示は、Codexが修正した。モデル生成差分は採用していない。公開APIを通る回帰はRED後にGREEN、既存cognitive/material suiteと合わせ16件PASS。
- lint・選択した依存グラフのTypeScript検査・341要求/17認知/20研究/35工程の継承guard・627surfaceの対応表監査を実行。全体lint/test/security/build/healthと独立container検証の正確なPR/main SHA・CI URLはGitHubの最終引継ぎへ保存する。

`index.json` は保持ファイルのSHA256とサイズ。JSON journal、intent、モデル応答、model attestation、実チェックlog、候補diff、Goal/WorkRun snapshotを保持する。`harnesses/*.mjs.txt` は実行した隔離harnessの記録。固定probeは `.mjs.txt` として保持し、通常test discoveryで再実行させない。SQLite本体、実運用の資格情報、端末登録は収録しない。

## 実モデル試験の結果

全ケースは別の隔離Goal/DB/worktreeであり、原#1219や他ケースを置き換えない。ループバックOllamaと導入済みモデルのdigestを実測した。署名は公開RFC8032 test vectorを使うfixtureで、production trustや独立コンテナの証拠ではない。

| 記録 | 実モデル | 結果 |
|---|---|---|
| `initial-3b` | qwen2.5-coder:3b | 宣言を壊す候補。型・unit・integration・buildがFAIL。securityは依存環境不足も含む。FAIL receipt消費を保存。 |
| `3b-recovery-budget` | qwen2.5-coder:3b | 既定値を誤って1にする候補。実6チェック中lint/unit/integrationがFAIL。修復時の30KB重複問題でBLOCKED。この問題の修正前履歴を保持し、Goalをリセットしない。 |
| `7b-repeat-stop` | qwen2.5-coder:7b | 凍結probeがFAIL。事前確保した修復先でも同じ誤修正を返し、`equivalent_failed_candidate` でBLOCKED。 |
| `4b-frozen-first` | qwen3:4b | 初回から凍結probeを提示したが、元のコードを返した。`TRACKED_REPAIR_NO_TARGET_CHANGE` でBLOCKED。 |

この試験で実モデルによるGORIQ自身のソース修復完遂は達成していない。変更の採用やGoal完了を偽装していない。fixtureの次Job成功とモデル能力の成否を別々に記録する。

## 次の作業と範囲

#921を継続する。実モデルに任せる対象の絞込みと能力評価を、保持した同一の凍結回帰に対して行い、根拠のないprompt再試行を増やさない。production verifier trust、実モデル修正からPR公開・mergeまでの連結、端末/本番での完遂は未証明。未承認の鍵・権限・課金・配備・schedulerは追加していない。ホストpinの事前設定は引き続き必要。

既存Windows JSON snapshotの一時的なEPERM renameも並行実行中に観測した。保存方式は変更していない。実モデルとBroker fixtureの共通heavy lane競合では既存のWAITING_FOR_RESOURCEが働いたため、最終Broker確認は直列で行った。これらの失敗記録を残し、Windows全競合条件を解消したとは主張しない。

rollbackはcomposition・ステージ抽出・consumer hooks・関連fingerprint・本体修正を通常のsource revertで戻す。履歴、失敗候補、材料、receiptを削除しない。
