# GORIQ 自律開発 GOAL 完了までの実証ゲート

基準日: 2026-11-12 JST
対象: haji84/AI- / Issue #1219 / 既存 Draft PR #1907
確認したソースHEAD: `5c07a013f8ccc1864a8fbe51c6cecda5ba1040a2`
確認したActions: https://github.com/haji84/AI-/actions/runs/43064482325 (4/4成功)
状態: **本番GOAL未達成**。これは次の開発に使う優先順位・合格条件の台帳であり、実行権限や完了宣言ではない。

## 最終GOAL（変更不可）

所有者がGOALを1度与える → 既存のUnified Intakeが本人認証・重複防止・Goal Resolverを通す → 同じ正本Goalを読み、Jobへ分解 → 既存の能力ルータで適格な実行先を選ぶ → 実AIがコードを変更する → 本当に独立した実行者が完全な検証と署名を返す → 失敗なら原因を分析し別の修正を試す → 再起動／Actions／ホスト変更後も同じGoal／途中Jobを復元 → 次Jobを無人開始 → 許可範囲内で安全に統合し、成果物の実動作と原本一致を確認 → Goal達成を根拠で宣言し、結果を所有者に返す。

- 永続化されたGoalテキスト、Issuesコメント、緑のCI、合成検証は、本番の自律完走とは別物。
- 同じGoal `goal-fcc81c97e09153f7`、Job `rotation-recovery-37` は過去文書上の識別子。稼働中のCompass/Brokerからの認証済み存在、現行承認範囲は未確認。IDを元に再作成・自動承認しない。
- リポジトリPublic維持。GitHub Actions主体・通常JobのPC常駐依存なし。秘密情報をPublic GitHubに書かず、支払い／秘密鍵／権限／重大な公開・統合・破壊的変更は既存Human Gateを維持。Codex、CodeRabbit、Copilotへの依存を新設しない。

## 状況の読み方

- **SOURCE_CI_PASS** = 現在のソース／合成・統合テストを正確なHEADで確認済み。実Goalの本番合格とは異なる。
- **PARTIAL_SOURCE** = 実装や一部検証はあるが、同一Jobの実行証拠が不足。
- **HOLD_LIVE** = 本番の署名・所有者・遠隔原本などが認証できず、実証未完了。
- **DONE_PRODUCTION** = 実Goalを本番で原本・実行者・成果物・人間の権限境界まで独立に証明した場合だけ。

## 最優先の作業ゲート（依存順）

### G0. 現在のソースCIと回帰の固定
状態: **SOURCE_CI_PASS**。
実装と証拠: HEAD `5c07a013f8ccc1864a8fbe51c6cecda5ba1040a2` の通常CI 4/4 成功。通常テスト3,700 PASS / 0 FAIL / 条件付き26 SKIP。P8 security 332 PASS / 0 FAIL。CI用6検査独立コンテナ成功。Brokerの現在／過去Goal区別とローカル排他競合後の有限回復旧テストが含まれる。
次の合格条件: 変更ごとに当該HEADに対する全必須CIを再実行し、実際の失敗ログを原因別に修正。テスト削除・スキップ追加・時間制限緩和を合格と扱わない。
証拠: https://github.com/haji84/AI-/actions/runs/43064482325

### G1. 現行所有者GoalとJobの認証済み読戻し
状態: **HOLD_LIVE**。
対象: 既存 `goal-fcc81c97e09153f7` と `rotation-recovery-37`。
作業: 所有者認証付きの既存Broker/Compassから、現行Goal ID/契約digest/DoD/制約/承認スコープ/現在Job/WorkRun/停止状態/原本の更新時刻を読み戻す。過去のWorkRunは `HISTORICAL_WORK_RUN`、現在は `CURRENT_COMPASS_GOAL` と区別し、HTTP 200やGoal文字列だけでは権限を与えない。秘密値は取得・ログ出力しない。
合格: 現行ホストから正本とJobの真正性を確認し、同じID・契約・承認・状態を別読戻しで照合。HUMAN_GATE・PAUSED等は保持。
不可なら: 存在を推測せず `HOLD` と原因を記録。勝手に新Goalへ置換しない。

### G2. 認証済み入出力から実行開始までの接続
状態: **PARTIAL_SOURCE**。
作業: 既存の認証済み入口 -> Unified Intake -> Goal Resolver -> Compass WorkRun作成／継続 -> Brokerの実Job起動を、本人の1回の操作で実証。再送・二重入力・Goal契約の衝突・過去ID・承認待ちを試す。
合格: 1回の正式受付で同じ正本Goalの同じ非終端Jobが起動し、2回目の送信では重複Job／重複支払い／重複副作用を起こさない。GitHubのIssueコメント保存のみでは合格にしない。
コード: `scripts/jarvis-broker.ts`, `src/orchestrator/goal-controller-runtime.ts`, `src/orchestrator/compass-goal-controller.ts`。

### G3. 共有する永続実行原本と権限所有者の接続
状態: **HOLD_LIVE**。最重要のアーキテクチャ／運用ゲート。
作業: 現在のCompass正本とJob/ChangeSet/試行/承認/署名済みreceiptを失わず、ホスト／Actions実行を越えて扱う、真正性・アクセス制御がある永続ストアを決める。既存原本との移行前照合、専用権限の承認、バックアップ・独立読戻しを用意する。GitHubのIssueや手元JSONコピーを実行権限そのものとみなさない。
必須不変条件: 原子的CAS、単調なepoch、fencing token、lease期限と安全な更新、アクティブ1所有者、古い所有者の拒否、クライアントと署名者の権限分離、改ざん/部分書込拒否、append-onlyの失敗履歴。新しい秘密鍵・アカウント・権限は明示承認が必要。
合格: 別ホストで原本SHA・契約・履歴を独立読戻しでき、衝突時・旧epochの書込が拒否される。
備考: `src/gai/distributed-coordinator.ts` のMemory/JSON CASと `src/gai/cognitive-lease.ts` はローカル境界。分散合意の本番証明ではない。

### G4. GitHub Actions主体の実Jobスケジューラとホスト切替
状態: **PARTIAL_SOURCE**。
作業: G3の原本／leaseで、同じJobを適格なActionsランナーへ復旧 dispatch。公開可・LOW・追加課金ゼロの仕事はGitHub-hostedを優先し、GPU・端末・機密データ必須の場合だけ認証済みローカル資源を使う。正本のpause/human_gate/期限/承認・未完Job依存を必ず再確認。
合格: runnerが消失しても別runnerが同じJob ID・履歴・epochで継続。失敗した前実行が副作用を出せない。ローカルPCが不在でも独立したGitHub適格Jobは進む。

### G5. 実データからのAI開発とTDD候補の保存
状態: **PARTIAL_SOURCE**（実モデルからの失敗候補・合成テストは存在、実Goalの正しい修正完走は未認証）。
作業: 既存Jobに必要なソース・失敗ログ・DoDを渡し、実在する許可済みモデルの実応答からREDと異なるGREEN修正候補を生成。モデル名・digest・入力・出力・時刻・ベースコミット・許可ファイルを保存する。ローカル不可なら適格な既存モデルを選ぶが、有料API・無断キー発行へは移行しない。
合格: 対象Job IDに紐づく実コード差分、候補SHA、モデル実応答、独立した元ソース復元、元失敗を再現したRED試験がある。合成Builderでは代用しない。

### G6. ChangeSet／試行／成果物の不変保存と独立読戻し
状態: **PARTIAL_SOURCE**。
作業: intent → model response → prepared candidate → TDD evidence → ChangeSet → verifier request → result/receiptの各SHAを原本へ追記。新runnerが同じ候補を読めることを確認。失敗した候補、消費済み推論、元のエラーログは削除・改変しない。
合格: プロセス終了・再実行後も既存候補のSHAとJob履歴が一致し、同じ候補を再生成せず継続する。異なるバイト／欠損・破損・リプレイを拒否。

### G7. 実際に独立した検証ランナーと署名者の接続
状態: **HOLD_LIVE**。
作業: 既存の `scripts/jarvis-verifier-request-transfer.mjs`, `scripts/jarvis-independent-check-runner.mjs`, `src/orchestrator/signed-local-verifier-receipt.ts` に、本物の独立主体が管理する署名を接続する。ソース・Job/ChangeSet・base・artifact SHA・期限・全6チェック結果をバインド。署名秘密鍵はBuilder、公開repo、モデルからアクセス不能とする。
合格: lint/typecheck/unit/integration/security/buildの実行記録と、別主体が発行した真正な署名receiptを保存し、別runnerで署名・公開鍵pin・候補一致を検証。期限切れ／不完全／自己署名／改ざんはFAIL/HOLD。
重要: CI用fixture署名やCI独立コンテナ6/6 PASSは本番署名の証拠ではない。鍵や権限が不足する場合はHuman Gate。

### G8. 実際の検証FAILから異なる修正への自動Recovery
状態: **PARTIAL_SOURCE**。
作業: G7が確認した本物のFAILから失敗種類・仮説・再試行対象を決め、前と異なる修正案を同じGoal/Jobで実行し再検証する。既存の修復回数・予算・モデル・スコープ・Human Gate・中断証拠は保持。
合格: 最初の失敗候補→署名付きFAIL→原因分析→別の候補→新たな独立検証で改善／通過までを一巡。類似候補を名前だけ変えた再試行や後付け成功を拒否。安全に解けない場合は理由を示してHOLD。

### G9. Goal全体の評価と次Jobの無人開始
状態: **PARTIAL_SOURCE**。
作業: Jobが1件COMPLETEDでもGoalの全DoD未充足なら、依存関係・承認・リソース状態に基づき次Jobを自動発行／選択して実行する。goal_completeを各Criterionの真正な証拠でのみ判断する。
合格: 複数Jobの1件目が終了後、所有者が再指示せず2件目が同じ正本Goal上で起動。全Criteriaを満たさない限りGoalは未達成。中断後も継続し、同一Jobを二重処理しない。

### G10. 既存のリリース権限・PR・主系統・デプロイへの安全接続
状態: **HOLD_LIVE**。
作業: 対象変更のリスクと承認スコープに応じ、既存PRに差分・回帰証拠を提出し、必須CI／独立レビュー／保護ルールを守る。許可範囲でのみ統合・リリース・巻戻しを実施。重大変更・秘密鍵・認証範囲・課金・破壊的変更・外部公開は事前承認。
合格: 適用対象の正確な本番revision／artifactと検証された候補SHAが一致し、実行後の機能検査が成功。CI成功・PR作成・マージ済み単独ではGoal達成とみなさない。

### G11. 所有者への成果物と実行証拠の返送
状態: **PARTIAL_SOURCE**。
作業: 過去／現行Goalを区別した画面や既存入口に、同じGoal ID、完了Job、残DoD、現在のBlocker、検証証拠、最終成果物、次の自律Actionを返す。添付物があれば正しいSHAを独立読戻しできるようにする。
合格: 所有者がチャットを変えてもGitHubから現在の開発位置を読める。成果物を利用して実際の動作を確認できる。GitHub引継ぎ文書の更新だけで自律実行は起動しない。

### G12. 本番の故障注入とクロスホスト回復
状態: **HOLD_LIVE**。
作業: 実Job中のプロセス強制終了、Actions中断、ホスト故障、ネットワーク断復旧、競合する2実行者、古いepochでの書込、署名期限切れ、部分書込、二重イベント、Human Gate中の再開要求を試す。各々、原本・試行・承認・検証結果を照合。
合格: 失敗理由と元証拠を保存し、許可されたタスクだけ同じGoal/Jobで自動再開できる。競合・副作用・権限逸脱・記録消失ゼロ。復旧不能な状態を成功に分類しない。

### G13. 実Goalで全工程を連続完走し再現性を確認
状態: **HOLD_LIVE**。
作業: G1で認証した本物のGoalと未完Jobに対して、G2→G12を同一の実行台帳でつなげて確認。最初に非破壊の適格なJobで本番一巡し、より高リスクの元Goal部分は正しい個別承認で進める。別の日／実行で再現し、少なくとも2つの独立した実用作業を区別できることまで拡張する。
最終合格: 実Goal受付（または既存Goal認証読戻し）→適格Job選択→実AI修正→元失敗の再現→独立署名検証→必要な別修正→ホスト越え復旧→次Job自動実行→承認済み統合→本番動作と成果物原本の独立確認→Goal全DoD達成、の証拠が揃う。
追加の成熟度検証: 連続稼働で同じ能力を再現し、定期処理・複数Goal・異なる資源状況でも成立する。安定運用と「最初の本番一巡」は別の合格。

## 実装の推奨グループ

- **優先A（最初の本番復旧）**: G1 → G2。ここで原本の存在、承認境界、実行経路を確定する。
- **優先B（停止しない実行権限）**: G3 → G4 → G6 → G12の基礎。共有原本・CAS・epoch・fencing・別runner復元を先に満たす。
- **優先C（本当のAI自動開発）**: G5 → G7 → G8。実モデルの候補、別主体の全検査、実FAILからの別修正。
- **優先D（結果と次工程）**: G9 → G10 → G11 → G13。次Job・保護統合・本番受領までつなげる。

G5の既存単一ホスト実験とG7の独立環境整備はG3と並行可能。ただし**クロスホスト完走を名乗る前にG3/G4/G6が必須**。

## 次の1工程（推奨）

**G1: 実Goalの所有者認証読戻し**。
- 最新PRとmainを毎回取得してHEAD固定。
- 既存の認証済みBroker / Compass読戻しの実際に使える経路だけを使用。
- `goal-fcc81c97e09153f7` と `rotation-recovery-37` の存在・契約・人間の承認・停止状態を確かめる。
- 既存Jobが別状態ならコードやGoalを勝手に作り直さず、正確な次の実行可能Jobを報告する。
- 接続不可なら「本番読戻し未実証」と記録し、G3/G7の許可済みソース作業を並行して進める。

## GitHub引継ぎ・証拠規則

新チャット冒頭で `docs/handoffs/GORIQ_CURRENT_HANDOFF.md`、本台帳、最新HEAD、Issue #1219、PR #1907、同一HEAD CIを再取得する。次チャットへ引き継ぐ前に当該GitHub文書とIssue／PRのチェックポイントを更新し再取得を確認する。GitHub文書・Issueコメントは実行状態の証拠ではなく、本人の秘密のある原本をPublic repoへ載せない。

**完了したゲートだけ DONE_PRODUCTION に変更**する。ファイルの有無・CI用fixture・モデルの自己申告を「証拠あり」に格上げしない。
