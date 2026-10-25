# 共通AI自律開発フレームワーク：完成条件差分監査

監査日：2026-10-25 JST。対象は既存 Issue [#1865](https://github.com/haji84/AI-/issues/1865) / Draft PR [#1866](https://github.com/haji84/AI-/pull/1866)。本記録は進捗・証拠索引であり、GOAL、既存仕様、権限、承認を変更しない。

## 固定した出発点

- GitHub API と `git ls-remote` を照合：PR head `fba2af8f3b352c2f4af567dab65f2bf4fbc1d8c3`、main `99d4e1568fa15c7cab48fc343cd5521c0f8c9512`。OPEN / DRAFT / 未統合、差分29ファイル。
- [通常CI 40052367565](https://github.com/haji84/AI-/actions/runs/40052367565)：SUCCESS。
- [隔離検証 40052367563](https://github.com/haji84/AI-/actions/runs/40052367563)：FAILURE。18 jobs の実状態と失敗ログを取得。全PR集計 job `120752543415` は `BLOCKED`、13/13 batch受領、115 chunks、モデル指摘67、source-location grounded12、pending independent verification67。指摘の所在が合うことと不具合の再現は別。これらは固定v0.5の104件とは異なる集合。
- 正式GitHubレビュー：PR #1866 の review submissions は0件。この監査はレビューや承認を作成しない。
- 有効Ruleset [21173944](https://github.com/haji84/AI-/rules/21173944)：default branchの削除・non-fast-forward禁止、PR必須、strict `project-checks` / `repository-guard`、bypass actorsなし。GitHub上の required approving count=0 はIssue固有のHuman Gateを免除しない。設定変更なし。

読んだ正本：`AGENTS.md`、`PROJECT_STATE.md`、`ROADMAP.md`、Issue #1865本文・PR履歴、`docs/JARVIS_PRODUCT_SPEC.md` の関連要求、`docs/architecture/0011-goal-driven-autonomous-loop.md`、`docs/architecture/chat-first-actions-autonomy.md`、関連実装・CI・Human Gate記録。PROJECT_STATEの他案件の完了表記を共通フレームワークのE2E合格へ転用しない。

## スコープと依存関係

```text
固定v0.5原本・真正なplanの特定
  -> 独立AI09の安全な実行経路・正式レビュー・必要なHuman Gate
  -> 固定対象8件の実推論検証
  -> 固定対象104件 + 指摘再現 + 横断設計審査
  -> 正式承認（各工程と別ゲート）

既存PRの安全な助言判定 -> 認証済みChatとGOAL照合 -> 限定Actions
  -> 非Codex Builder -> 同一PR修正 -> CI -> 対象HEAD独立審査
  -> 必要なHuman Gate -> 許可された統合 -> main実動作
  -> 永続状態から次作業選択・中断復旧 -> 2プロジェクト以上の実統合
```

Issueの既存許可は読み取り専用advisory、隔離テストと既に記録されたpilot。現行PRに含まれるPublisher案は有効化許可ではない。本変更でworkflow、`safe-pr-capability.ts`、`reasoning-router.ts`、AI09本体、資格情報、保護設定を変更しない。

`reasoning-router.ts` の既存稼働方針と、Issueの「Chat-first / 非Codex優先 / Codex例外」の目標には既知の差分がある。既存architecture文書どおり別の審査・承認対象とし、この修正では上書きしない。Codexは今回の実装担当であり、完成するフレームワークの既定Builderへ変更しない。

## 17条件の分類

「部分実装」はコード/pilotが存在しても要求された実環境受入が残る状態。「検証不足」は原本・実測・承認証拠が不足する状態。下記の広い完成条件に対する完了宣言はない。

| # | 完成条件 | 分類 | 確認した実装・証拠 / 残る受入 |
|---|---|---|---|
| 1 | GOAL固定・永続化・進捗 | 部分実装 | `goal-controller-runtime.ts`、`goal-decision-store.ts`、`WorkState`あり。共通v0.5から実Chatへ結合した永続GOALの受入は未確認。 |
| 2 | GOAL/Issue/PR重複防止 | 部分実装 | Goal ResolverとSQLite decision store、PR advisoryあり。本修正で別baseの同一Issue PR見落としを解消。稼働write pathへの結合・競合時実環境受入は未達。 |
| 3 | 依存関係・優先度 | 部分実装 | `development-orchestrator.ts`、`completion-path.ts`、`development-decision-board.ts`が助言。実際の継続executorでの受入は別。 |
| 4 | 不足機能・改善提案 | 部分実装 | decision boardが不足DoD/証拠を列挙する。本監査も不足を記録。提案の採否・正式仕様反映・実環境ループは未達。 |
| 5 | 実装前独立設計レビュー | 検証不足 | 今回の小修正にfresh-context補助レビューを実施。共有workspaceの補助レビューは独立環境AI09や正式設計承認の代用にならない。 |
| 6 | 必要数の並列実行 | 部分実装 | decision boardのresource locks/可変slots、既存Actions batchあり。実Builderの依存/競合/費用を結合した受入は未達。 |
| 7 | 限定Actions実行 | 部分実装 | 実GitHub-hosted isolated jobsと通常CIの証拠あり。認証済みChatから全工程を駆動する受入は未達。 |
| 8 | 同一Issueの既存PR修正 | 部分実装 | 人/Chat媒介で同PRを更新した過去pilotと今回のadvisory修正。`safe-pr-capability.ts` は依然 `autonomy/run-*` + POST `/pulls` の経路を持つ。一般的なActions自律修正への再利用結合は未達。 |
| 9 | CI原因分析・自動復旧 | 部分実装 | retry/triageコード・履歴あり。今回実ログから全PR審査がBLOCKEDと確認。未再現のモデル指摘を自動修正しない。一般CI復旧と継続実行のE2Eは未達。 |
| 10 | 別モデル・独立環境AI09 | 検証不足 | GORIQの実モデルpilotは固定v0.5審査とは別。独立AI09固定対象は0/8、0/104。 |
| 11 | 指摘照合・修正・再審査 | 部分実装 | `chat-actions-ai09-independent-triage.mjs`はsource locationのみを機械照合。67件のpendingを再現済み不具合や解決済みへ換算しない。 |
| 12 | Human Gate・保護ルール | 部分実装 | `risk-policy.ts`、advisory、Publisher owner marker、実Rulesetあり。全write/merge経路への実効適用と独立AI09側の全条件は未受入。 |
| 13 | 許可範囲で安全な統合 | 未実装（本工程の稼働経路） | PR #1866はDRAFT、Publisher未有効化。必要な独立審査・Human Gateを通過した共通経路の統合実証なし。 |
| 14 | main統合後実動作 | 検証不足 | 本PRは未統合。通常PR CI成功をmain CIや製品実動作として扱わない。 |
| 15 | 次の未達タスク自動選択 | 部分実装 | Goal Loop/decision boardは候補とnextを算出。sandboxの固定NEXTはfixture。実統合後の次job起動までの受入は未達。 |
| 16 | 中断・環境喪失復旧 | 部分実装 | SQLite/storeと再生成runtimeのテストあり。共通経路のプロセス断・runner喪失・安全再開の実証は未達。 |
| 17 | 共通API・複数project | 検証不足 | portable v0.5は別成果物でありGORIQに混入させない。過去の2repo metadata観察は実統合テストではない。両projectの権限・原本対応・実受入が必要。 |

限定的に実装・テスト済みとできる範囲は、通常CI、助言モジュールの再利用/衝突/リスク/古いAI09/停止判定と隔離fixture。これを上表の広い完成条件の達成とはしない。

## 固定共通v0.5と独立AI09

- 固定対象SHA-256：`9cf979733d8d4753023b1dd239ba4a5f3be2e0a6a3216c9dda206c089a2b6aa5`、47 files / 104 chunks。[既存凍結記録](https://github.com/haji84/AI-/pull/1866#issuecomment-6379057025)。今回cloneおよび指定作業フォルダ/attachmentsのファイル名探索では原本ZIP・真正なplanを取得できていない。別保管先の不存在を主張しない。原本再検証・全仕様整合性は未達。再圧縮・再分割・代替planの生成なし。
- 独立AI09 [Issue #3](https://github.com/haji84/independent-ai09-reviewer/issues/3) / [PR #2](https://github.com/haji84/independent-ai09-reviewer/pull/2) を読み取り専用で再取得：head `63ed3d35b111a377058775d91c27689683393398`、main `482061676e769d9404d0d742a17fa1eeb6a63992`、未統合。
- [最新CI 40186776236](https://github.com/haji84/independent-ai09-reviewer/actions/runs/40186776236) の既存記録はLinux99/99、隔離fake8/公開toy1/context拒否1。**固定対象8件・104件の実審査ではない**。今回そのCIの再実行はしない。
- 正式レビューAPI：COMMENTED1（作者）、APPROVED0。mainの `protected=true` 単独で全保護/ownership/承認充足を認定しない。
- 最新引継ぎは真正なplan所在、別アカウント承認、private activation/秘密管理/費用/証拠保存のgate待ち。既存の修正予算・停止条件をこちらでリセットしない。
- 独立AI09リポジトリへのcommit/comment/dispatch、原本・鍵の取得/復号/公開は行っていない。全体 `DESIGN_APPROVAL=HOLD / MERGE_AUTHORIZED=false / PUBLISHER_ENABLED=false` を維持。

## 選択した最小修正と受入

優先理由：既存PR再利用は後続write path接続の前提であり、Issue #1865で承認済みのpure advisory範囲で再現・修正できる。権限を要するdispatch/Publisherや未再現のAI09指摘に先行して安全に進められる。

根因：`adviseDevelopmentIntake` が同一repo/Issue候補をbaseBranchでも絞り、別baseのPRを未存在と誤認していた。`new_work`で `NEW_CANDIDATE`、main/release双方にPRがあると `REUSE` を返す。これは読み取り専用の不正な助言であり、実際の重複PR作成や権限突破を実証したものではない。

手順：

1. 元HEADで上の2症状を直接再現し、既存関連31テスト成功を確認。
2. 別base単独、複数base、closed履歴、open+closed履歴、無関係repo/Issue、Chat提案停止の6テスト追加。REDは28中23成功/5失敗。
3. 同一repo/Issueを先に選び、base不一致を `RECONCILE` にする最小変更。`fix_existing_pr` と `new_work` を確認。
4. GREEN：`node --test tests/development-pr-advisory.test.ts tests/development-orchestrator.test.ts tests/development-decision-board.test.ts tests/risk-policy.test.ts` **44/44 PASS**。Chatの `commandJson=null`、既存リスク/停止/非Codex/AI09 advisory境界を維持。
5. `git diff --check` PASS。以降の全suite/CIと補助レビューの実測はPRの最新HEADコメントで追記し、古いHEAD成功を転用しない。

全suiteから判明した今回の更新漏れ：既存 `docs/jarvis-reverse-traceability.json` の該当source SHAが古く、completion audit7件とrequirement traceability1件が失敗した。同一sourceの既存 `surfaceFingerprint` を使って該当SHA1箇所だけ更新（分類・親要求・承認状態は維持）。両関連ファイルを再実行して **18/18 PASS**。

ローカル全suiteの観測を省略しない：Windows / Node24.19.0 / pnpm11.19.0、`pnpm test --test-concurrency=2` は **2797件中2746 PASS、26 FAIL、1 CANCELLED、24 SKIP**、exit1。上記8失敗を修正後、残る18失敗+1cancelledが**修正前の同一HEADの別clone**でも再現することを確認（55件中36 PASS/18 FAIL/1 CANCELLED）。全suiteの最終成功は主張せず、Linuxの最新HEAD CIを別途確認する。

| 修正前HEADでも再現した失敗箇所 | 件数 | 実ログで確認した条件 |
|---|---|---|
| `scripts/owner-code-windows.test.mjs` の DPAPI-incompatible identity | 1 | PowerShell Security moduleをロードできず `ConvertTo-SecureString` 失敗。保護/設定の変更は行わない。 |
| `tests/ai09-live-broker-builder-probe.test.mjs` の trusted-main-only owner-probe workflow | 1 | CRLFのworkflowをLF固定の検査が認識しない。 |
| `tests/ai09-pr-review-workflow-guard.test.mjs` の triggers、preflight、model worker、Ollama、publisher、per-file budget | 6 | CRLFに対するLF固定regex / `missing_job_*`。実workflowの権限変更ではない。 |
| `tests/goriq-fleet-db-secure-migration.test.ts` の fleet DB migration | 1 | `URL.pathname`由来の `/C:/...` / percent encodingを子Nodeに渡しmodule not found。 |
| `tests/goriq-mac-runtime-apk-path.test.mjs` の canonical Mac runtime | 1 | `bash` ENOENT。 |
| `tests/goriq-pc-native-inventory.test.mjs` の native reads reject symlinks | 1 | Windows symlink作成がEPERM。昇格・保護緩和をしない。 |
| `tests/jarvis-mac-zero-touch-bash32-local-order.test.ts` の zero-touch tunnel fallback | 1 | LF固定regexとCRLF。 |
| `tests/mac-code-builder-engine-discovery.test.ts` の outside PATH、npm global prefix、explicit engine、no supported engine | 4 | `/bin/bash` ENOENT。 |
| `tests/macbook-watchdog-contract.test.mjs` の valid bash、conflict cooldown | 2 | bash不在 / LF固定のsource検査。 |
| `tests/jarvis-pc-enrollment-broker.test.ts` の Owner PC proof enrollment | 1 cancelled | 30秒timeout。根因は未確定。今回の変更を含まないbaselineでも再現し、設定や製品コードを推測修正しない。 |

`pnpm install --frozen-lockfile`、`pnpm lint`、`pnpm build` はexit0。buildには未変更のdynamic filesystem tracing警告2件がある。buildが生成した `next-env.d.ts` の差分は除外・復元済み。修正前後ログと失敗名の全件索引は作業フォルダの `evidence-1865/` に保持し、公開進捗へraw環境ログは貼らない。

補助設計レビューはfresh-context subagentに `gpt-6-astra` を指定し、同じ症状を再現・既存22テストを確認、同一修正を推奨した。モデル指定は独立したmodel digestの証明ではなく、workspaceも共有する。AI_ASSERTEDの補助所見であり正式AI09/全framework審査/承認ではない。

別のfresh-context補助実装レビューも `gpt-6-astra` を指定。限定source/test/doc差分にactionable P1/P2なし、関連44件を再実行してPASSとの応答を受領。GitHub由来の監査証拠・全PR・固定v0.5を再審査したものではない。

## 次の作業・停止境界・ロールバック

1. この修正を同一PRへ記録し、最新HEADのCIと審査状態を確認する。既存全PR審査失敗を隠さず保持。
2. 真正な固定ZIP/planの非公開保存先を所有者に照会済み。原本なしで分割仕様を推測しない。
3. 独立AI09側は既存の承認経路で、資格のある別GitHub reviewerの最新HEAD正式APPROVED、workflow所有権と安全なprivate実行gateを満たしてから実8件へ進む。その成功後に104件・指摘再現・横断審査。こちらから書き込まない。
4. GORIQ側の稼働dispatch/一般的なsame-PR writer/統合・次job起動は、正確な差分・リスク・独立審査・必要な所有者承認が別途必要。所有者の完成指示を既存承認境界の拡張としない。

ロールバック：この修正commitを既存PRでrevertし関連テストを再実行。設定・workflow・DB・本番状態の変更はない。revertしても元の重複判定欠陥が戻るため、write path接続は引き続きHOLDとする。

Compassは別の進行状態（#681/#1845 `STOPPED_NEW_WARNING`）を指すことを読み取り確認した。他案件の停止・nextActionを上書きせず、Issue/PRとこの監査を引継ぎ正本とする。chat内GOAL trackerは本タスク未達の追跡だけに使い、稼働Goal Controllerへ新規GOALを作成しない。

**最上位GOAL：未達。計画・単体テスト・PR更新を完成判定にしない。**

## 同一PR追補：repository identityとruntime入力の検証

2026-10-25 JST、クラウド側の作業開始時headは `fba2af8f3b352c2f4af567dab65f2bf4fbc1d8c3`。途中で同PRが `ed70bf77c04e407d7750e112f94007a4aff9bd6f` に進んだため、ローカル作業をstashへ保全しfast-forwardした。先行した別base修正、6テスト、既存監査を保持し、追加修正を未解消のrepository case/不正入力へ限定した。新しいPR、worktree、portable v0.5コピーは作成しない。

最小計画と実施：

1. mixed-case repositoryによる同一PRの見落とし、mixed-case duplicate、array/非record riskSignals、array repository/base/head、null/sparse inventory、array SHAを実コードで再現。
2. 最新 `ed70bf77` に15件の回帰を追加し、sourceを変える前に **43件中28成功/15失敗**を確認。
3. GitHub owner/repo identityの比較だけを小文字化し、Git branch比較はcase-sensitiveのまま保持。plain record・文字列・SHA型を検査し、不正入力を既存エラー/INCONCLUSIVEで拒否。空の正当なrisk recordと既存risk-policyは維持。
4. 修正後 **43/43 PASS**。同じsourceの既存traceability SHAだけを `surfaceFingerprint` で更新し、classification/requirements/承認状態は維持。

変更範囲：`development-pr-advisory.ts`、その回帰テスト、既存reverse-traceability SHA、この既存監査記録のみ。実PR作成・dispatch・merge・provider選定・秘密管理・workflow・保護ルールは変更しない。これは読み取り専用助言の信頼性修正であり、実権限突破の発見という主張ではない。

### 現クラウドでの最終検証

- Node24.19.0 / pnpm11.19.0、frozen-lockfile install成功。追加したPowerShell7.6.8は作業用ディレクトリに展開し、公式GitHub release APIのSHA-256 `59112e38ad83350e4f6dc0195953c66b5926792f300ca2e7691b8242e7a16e7f` を検証した。
- `pnpm lint`、`pnpm build`、buildしたNext serverへの既存healthcheck：すべてexit0。未変更のdynamic filesystem tracing警告2件は残る。生成された `next-env.d.ts` は復元しcommit対象外。
- 関連17ファイルの直接実行：**216/216 PASS**。GOAL永続化、command intake、completion-path、durable task、CI recoveryを含む。fixture/contractの合格を実Chat・実モデル・本番受入へ転用しない。
- `pnpm test:p8-security`：**332/332 PASS**。
- CIのPowerShell判断fixture3本：PASS。Windows nativeの受入とは区別する。
- 最終 `pnpm test --test-concurrency=4`：**2812件、2807 PASS / 0 FAIL / 5 SKIP / 0 CANCELLED**、28.688秒、exit0。PowerShellをPATHに追加し、この合成テストプロセスだけCI同等のumask022で実行した。本番/ホストのpermission設定は変更しない。
- 初回のsandbox実行は子プロセスEPERMで中止。続く実行では更新前source fingerprintに起因する8失敗と、PowerShell不在、umask077で合成weak directoryが0700になる2失敗を記録した。ハッシュ整合と実行環境を修正して上記最終全件を再実行し、テスト/assertionの無効化や製品コードの推測変更は行っていない。

実装前・実装後のfresh-context補助レビューに別モデル `gpt-6-astra` を指定。最新差分で43件と追加edge casesを独立実行し、actionableなsource欠陥なしとの結果。モデルdigestのattestationや独立実行環境はなく、**AI_ASSERTEDの補助所見のみ**。正式AI09・GitHub APPROVED・所有者承認には数えない。

リモート受入は別ゲート：この追補の親 `ed70bf77` の通常CI [40195829413](https://github.com/haji84/AI-/actions/runs/40195829413) は3 jobs SUCCESS、隔離AI09 [40195829366](https://github.com/haji84/AI-/actions/runs/40195829366) はFAILUREとAPIで確認。正式review submissionsは0件。今回の新HEADのCI/審査はPRコメントで別途記録し、親の成功を流用しない。ログ取得APIにはアクセス拒否があり、未取得の実ログから原因を推測しない。

固定v0.5の真正なZIP/planの承認済み非公開参照先は所有者へ照会中。固定対象 **0/8・0/104（独立AI09の現引継ぎ記録）**、正式設計承認、Publisher有効化、許可されたmain統合/main検証、実Chat起点E2E、実2project統合は未達。この修正を親GOALの完了としない。独立AI09リポジトリには書き込まない。

この追補のrollbackは追加commitを同PR上でrevertし、関連回帰・traceability・標準CIを再確認する。先行 `ed70bf77` の別base修正や他作業を巻き戻さない。current cloudにはCompass toolsがなく、Compass書戻しは未実施。
