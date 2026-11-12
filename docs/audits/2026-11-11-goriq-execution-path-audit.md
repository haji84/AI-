# GORIQ 実行経路・既存資産監査（2026-11-11）

対象: `haji84/AI-`、Issue [#1219](https://github.com/haji84/AI-/issues/1219)、既存 Draft PR [#1907](https://github.com/haji84/AI-/pull/1907)。本書はソースと履歴の監査であり、本番実行、独立署名者の稼働、実Goalの達成を証明するものではない。

## 1. 結論

採用する接続先は、既存の `GoalControllerExecutionBridge → CompassGoalExecutionAdapter → ResidentDevelopmentGoalHost` である。PR1907の `routeDurableGoalJobs` を、この経路のJob実行直前の判定として利用する。Goal、Job、検証済み進捗、承認の管理主体を追加する必要はない。

mainには認証付き受付、永続化、実Builder、署名検証、次Job選択がある。一方、PR1907のHosted adapterに本番呼出しはない。[executor][executor]、[adapter][adapter]、[PR説明][pr1907]を照合した。#1764の検証修正、#1868の証拠保持は再利用候補だが、別runner・authority・publisherの一括移植は支持しない。

## 2. 基準と確認方法

| 対象 | 固定したリビジョン |
| --- | --- |
| main | `6737e15033eced135461076d72f792516e83c9b3` |
| PR1907の監査開始時HEAD | `1fba7e56bdadfbe5aac6bf3c5741501d373ea6fb` |
| 両者のmerge-base | `6737e15033eced135461076d72f792516e83c9b3` |
| PR1907のmainからの差分 | 9 commits、8 paths、7新規pathsと1既存JSON変更 |

参照: [main基準commit](https://github.com/haji84/AI-/commit/6737e15033eced135461076d72f792516e83c9b3)、[PR基準commit](https://github.com/haji84/AI-/commit/1fba7e56bdadfbe5aac6bf3c5741501d373ea6fb)。本文の既存不具合は原則この基準ソースについて述べる。この後の統合修正・候補HEAD検証は末尾の専用節に記録する。

確認方法: `git ls-tree`、remote refs、`merge-base`、`--is-ancestor`、`rev-list --left-right --count`、`diff --name-status`、blob ID比較、主要実装の読解。GitHub connectorでPRメタデータと6PRのpatchを取得した。remote変更・コメント投稿・サービス操作は含めない。

## 3. 全体台帳とcoverage

### 3.1 tracked paths

| 区分 | main | PR1907基準HEAD |
| --- | ---: | ---: |
| root直下 | 14 | 14 |
| `.github` | 105 | 105 |
| `android` | 30 | 30 |
| `apps` | 14 | 14 |
| `benchmarks` | 8 | 8 |
| `docs` | 291 | 292 |
| `scripts` | 289 | 289 |
| `src` | 541 | 543 |
| `test` | 1 | 1 |
| `tests` | 656 | 660 |
| 合計 | 1,949 | 1,956 |

mainの`src`: `app`194、`application`2、`compass`3、`domain`2、`gai`87、`jarvis`79、`orchestrator`163、`providers`10、`storage`1。PR1907は`orchestrator`165。remote refsは`origin/HEAD`込み229件。全path/参照名の列挙であり、全本文の精読ではない。

### 3.2 workflows

77 YAMLをすべて構文解析し、`jobs.*.runs-on`を集計した。構文解析エラーは0、jobs定義は合計140。mainとPR1907のworkflow集合は同じである。

| `runs-on`に明示されたrunner種別 | workflow数 |
| --- | ---: |
| GitHub-hostedのliteralのみ | 20 |
| self-hostedのliteralのみ | 39 |
| 両方を含む | 17 |
| literalで確定しないもの | 1 |

最後の1件は`goriq-pc-private-network-probe.yml`の`${{ matrix.runner }}`。式の全展開・実際の割当ては未確認。コメント等も拾う本文検索を最終集計に使っていない。140は定義数であり、実稼働数ではない。

実行経路として重点確認したのは[Mobile Autonomy][mobile]、[cloud runner][cloud-run]、`gai-research-control-plane.yml`、通常CI、独立検証関連workflowとその呼出し先である。Mobile Autonomyの定期実行は`status`であり、既存のcache/artifact保存だけから、同じGoalの継続実行やクロスホストの排他制御があるとは判断できない。

### 3.3 open PR

初回の接続アカウント限定APIでは`haji84`作成の109件を取得した。その後、全author対象のGitHub REST `pulls?state=open&per_page=30&page=1..4`で独立照合し、30+30+30+21=111件、重複なしを確認した。authorは`haji84`と`github-actions[bot]`、総Draft27件・非Draft84件。初回一覧に欠けていたbot作成の#897・#172を補い、最終台帳を111件に訂正する。title/state/head branch・SHA/baseがmetadata確認対象。`is:pr`指定で通常Issueを返したIssue検索結果は除外した。出典: [REST page 1](https://api.github.com/repos/haji84/AI-/pulls?state=open&per_page=30&page=1)、[page 2](https://api.github.com/repos/haji84/AI-/pulls?state=open&per_page=30&page=2)、[page 3](https://api.github.com/repos/haji84/AI-/pulls?state=open&per_page=30&page=3)、[page 4](https://api.github.com/repos/haji84/AI-/pulls?state=open&per_page=30&page=4)。

111 headのローカル存在を確認した。初回109件では全headがmainの祖先ではなかった。ただし、squash・別commit・同等実装があり得るため、これだけで全変更を未取り込みとは判定しない。追加bot2件はhead存在とmerge-baseからの差分pathまで確認し、全patchの意味論的レビューはしていない。

| 追加PR（ともに非Draft） | HEAD / branch | mainとのmerge-baseからの差分path |
| --- | --- | --- |
| [#897](https://github.com/haji84/AI-/pull/897) `docs(jarvis): reconcile FLEET-010-011 capacity evidence` | `6060ff90d79d9b37baf0cdf65c918d8b7f6d5df0` / `autonomy/run-35523751968` | 変更: `docs/JARVIS_PRODUCT_SPEC.md`、`docs/jarvis-requirements.json`。追加: `tests/000-issue-725-ledger-reconcile.test.mjs` |
| [#172](https://github.com/haji84/AI-/pull/172) `test: verify one-cycle bounded command completion` | `9cc3ab390619ffd3d1093a3f5d7a9671480baa8b` / `autonomy/run-33814562609` | 追加: `docs/autonomy-one-cycle-smoke.md` |

上表のmerge-baseは#897が`6a2be422b1a5de793a6b0e522b35e678aa5aba53`、#172が`2dfec9bca9cd38ad01eade002e4ec1090f9f5b8c`。path比較は双方成功した。

取得対象番号:

`1907,1906,1905,1872,1870,1868,1866,1832,1822,1819,1818,1806,1800,1795,1770,1764,1759,1558,1515,1510,1457,1426,1377,1370,1365,1281,1210,1208,1204,1202,1201,1199,1198,1197,1196,1195,1182,1181,1166,1164,1162,1161,1156,1154,1153,1152,1151,1149,1147,1145,1144,1142,1135,1126,1115,1112,1107,1101,1098,1096,1085,1083,1082,1080,1076,1074,1070,1066,1062,1051,1031,1022,1019,1018,980,970,916,905,903,898,897,895,894,890,889,884,883,870,868,866,864,862,860,858,784,595,542,541,535,505,493,481,463,450,284,266,264,259,172,132,110`。

6PRはmerge-base、差分path、mainのblob、主要runtime patchを確認。79ファイル項目/74 distinct pathsを取得したが、#1764の大型`docs/audit/1763-development-flow-2026-10-17.json`はpatch本文なし。全commit・CIログ・Issueコメント・artifact・履歴行の精読、`git cherry`の全patch同値検査は未完了。

## 4. 既に接続されている実経路

| 層 | 確認できた実装 | 境界 |
| --- | --- | --- |
| 受付 | `src/app/api/jarvis/work/route.ts`から認証付きBrokerへ。`scripts/jarvis-broker.ts`でGoalControllerを呼び、WorkRunを作成しexecutorを起動 | source文字列だけを認証証拠にしない |
| Goal/状態 | `CompassStore`の既存SQLite Goalとstate.active内のdecision、WorkState、WorkRun、execution context | Goal受付とdecisionの別commit競合は今回の修正対象 |
| Job/Change Set | `JsonFileDevelopmentJobStore`、State Controller、`JsonFileDevelopmentChangeSetStore` | Jsonファイルの存在は共有ホスト間の線形化可能なauthorityを意味しない |
| 実行 | executorが`CompassGoalExecutionAdapter`を生成し、設定された`DevelopmentGoalRuntime`へ渡す | 無設定時の別経路を無条件で同等扱いしない |
| 続行 | `ResidentDevelopmentGoalHost`が検証済み進捗、依存関係、次Job、release条件を評価 | route選択やBuilder成功だけでGoalを完了にしない |
| wake/resume | Brokerのreceipt監視、起動時WorkRun再開、`ResourceWaitScheduler` | 外部の独立signerやoff-run永続基盤の稼働は別途必要 |

基準executorの355–364行でadapterとbridgeの生成・呼出しを確認した。[executor][executor]。Brokerの受付・schedule・receipt wake・再開は[既存Broker][broker]、進捗の正規投影は[既存adapter][adapter]、Job実行とreleaseは[ResidentHost][resident]が出典である。

PR1907の8 pathsはdecision文書、traceability JSON、Hosted adapter、router、fixture、3 tests。本番executor/workflowの接続変更はない。Builder/lease/acceptanceはhost注入interface、fixture署名者はテスト用鍵である。実owner Goal・実コード生成PR・独立本番署名者の証明ではない。[PR1907][pr1907]

## 5. 関連6PRの履歴と再利用判断

以下のbehind/aheadは`main...head`のcommit数であり、競合数ではない。全6PRは取得時点でopen、Draft、`merged=false`だった。

| PR / HEAD | mainとのmerge-base | behind / ahead | 主要差分と判断 |
| --- | --- | ---: | --- |
| [#1819](https://github.com/haji84/AI-/pull/1819) `a63273495091f4c4f57e1fb1ed3576dc6dee0c9d` | `cb6b0fa06492b3d610ecb527645244b9a46ba8eb` | 295 / 10 | 明示承認付きloopback Codex route。今回の禁止条件に合わず、採用しない |
| [#1764](https://github.com/haji84/AI-/pull/1764) `eb7eeb93271715763f8b6c0c44163e0e9597f36d` | `cb6b0fa06492b3d610ecb527645244b9a46ba8eb` | 295 / 122 | 旧bounded runnerの継続、lock/lease、検証済み進捗。局所的な検証修正は有用。全体移植しない |
| [#1770](https://github.com/haji84/AI-/pull/1770) `d9993374c72dab2d7f4055fae17f1b728d6729fb` | `82018fc5de04d122cb99a778613ca5d7b8959e3f` | 330 / 34 | 旧runnerの同一ホストmkdir lock。#1764子branchの重複範囲を含む |
| [#1759](https://github.com/haji84/AI-/pull/1759) `4f7ffa6450747fed204beadb6b3d33c92c711971` | `82018fc5de04d122cb99a778613ca5d7b8959e3f` | 330 / 8 | coordinator/taskを同じCASで扱う契約。実共有storeと本番接続が未提供 |
| [#1868](https://github.com/haji84/AI-/pull/1868) `ba0d9ea6c73736b0681768b99ca17b222ec27d40` | `99d4e1568fa15c7cab48fc343cd5521c0f8c9512` | 272 / 5 | AI09 hunk parserと部分finding保持。既存検証経路の局所修正候補 |
| [#1866](https://github.com/haji84/AI-/pull/1866) `3e19a145207ab35f71d74f4232bb368ebdc3e5bf` | `99d4e1568fa15c7cab48fc343cd5521c0f8c9512` | 272 / 104 | PR再利用advisoryと別Chat/Actions publisher系。resident実行の完成品ではない |

### #1764 / #1770

#1764の新規lease/lock sourceと関連testsはmainにない。`autonomy-run.ts`、`autonomy-event-run.ts`、`runtime-development-planner.ts`、`work-state.ts`、`compass-state-store.ts`は分岐点からmain側無変更。一方、WorkStateの`updateActive`原子的更新相当はmainに既にある。ファイル差異を機能全部の未取り込みと扱わない。[#1764差分](https://github.com/haji84/AI-/pull/1764/files)、[main store][work-store]

#1770のbaseは#1764旧head`8017d5d8aceec184fbfa8d4042f2323a0ddf7817`。固有差分は`autonomy-run.ts`1ファイル、21追加/3削除。mainからは親差分込み6 pathsになる。#1764後続headにも同系lockがあり、重複適用しない。

#1764のleaseには新SQLite lease/effect構造があり、外部副作用のreconciliation不足時は停止する。未接続の別authorityを持ち込んでも現行residentは完成しない。

### #1819 / #1759 / #1866 / #1868

#1819は承認・URL・token・workspaceと認証healthを要求するexternal Codex capability。今回の禁止条件に反する。mainのBuilder sourceは別変更、testsは分岐点から無変更で、このrouteの取り込みは確認できない。

#1759の`shared-workload-authority.ts`/`shared-workload-claim.ts`にはclaim/completionのCAS関数がある。しかしcross-host linearizable storeはinterface契約で、本番store/enqueue/claim接続ではない。source2/tests2はmainになく、Compassと並立するauthorityとして採用しない。

#1866はinspection/advisoryで、`executionAuthority=false`、`PROPOSE_ONLY`、`authenticated_adapter_must_verify_and_dispatch`を返し、dispatchしない。publisher workflow2件など28新規pathsはmainにない。mainのorchestratorには別変更がある。新publisherを増設せず、必要なPR再利用判定だけ既存release境界で検討する。[#1866差分](https://github.com/haji84/AI-/pull/1866/files)

#1868のsource2/tests2はmain側無変更。`goriq-ai09-finding-anchors.mjs`のhunk中`+++`追加行除外を修正し、`ai09-pr-review-automation.mjs`のcoverage不足/overflow時にも最大20件のfindingを保持する。BLOCKEDは維持し、承認・merge権限を増やさない。[#1868差分](https://github.com/haji84/AI-/pull/1868/files)

## 6. 単一resident経路を選ぶ理由

既存adapterは、永続化済みJobと独立acceptanceからWorkState/Goalへ進捗を投影する。ResidentHostには順序付きJob、復旧履歴、検証待ち、release gateがある。PR1907のpure routerをこのhostのBuilder直前・再開時に使えば、既存のState Controllerと承認判定をそのまま利用できる。[adapter][adapter]、[ResidentHost][resident]、[router][router]

Hosted fixtureではacceptance callbackがWorkStateを書き換える。既存hostの正規進捗投影へroute admissionを接続すれば、別engineの導入を避けられる。これは設計判断であり、未実施の本番動作の保証ではない。

hostがnode/capabilityと同じGoal/Jobの権限を再確認する。モデル文・fixture署名を権限の証拠にしない。物理端末/GPU/privateのJobは待機し、許可されたhosted Jobだけ進める。鍵・権限・費用・公開範囲等の既存gateは維持する。

## 7. 旧汎用verifierの未解決課題

基準mainの`autonomy-run.ts`40–42行は`result.ok`をそのままverifierの`ok`にしている。`autonomy-cloud-run.ts`にも同種の実装がある。これは独立検証ではない。[旧runner][old-run]、[cloud runner][cloud-run]

`work-state-integration.ts`では、既存WorkStateのGoal契約を比較せず再利用し、214–228行でBuilderが返した`definitionOfDoneResults`を無条件にmergeする。239行のchild完了も`result.ok`との両立を条件にしていない。#1764は、実行と独立検証の両成功、Builderによるwaiver拒否、Goal/WorkState契約一致を追加している。これらはsourceで確認できる実際の未取り込み修正である。[WorkState統合][work-integration]、[#1764差分](https://github.com/haji84/AI-/pull/1764/files)

resident接続だけでは旧汎用fallbackは安全にならない。実行選択から外すか、残す理由と局所修正・回帰試験を記録する。旧lease一式の移植とは別に判断する。

## 8. 署名付きBuilder profileの複数attempt制約

署名検証はsource/artifact、Goal/Job、Builder、公開鍵を結び付け、別候補への流用を拒否する。[validator][signed-receipt]。この境界と、実モデルが失敗後に別候補を作れることは別に検証する。

`tracked-repair-resident-runtime.ts`145–178行はprepared recordをJob IDで固定し、そのrecordがない場合だけ推論する。intentだけ残った場合は`TRACKED_REPAIR_INFERENCE_INTERRUPTED_NO_RETRY`で止まる。228行のChange Set IDも`jobId + ':tracked-candidate'`。再呼出しで同じprepared候補を返す仕組みは重複推論の防止にはなるが、別仮説・別候補を作る第二attemptの契約にはなっていない。[tracked profile][tracked]

`sequenced-resident-runtime.ts`61行ではattempt/strategy IDを作るが、80行のChange Set IDは`jobId + ':change-set:' + phase`で固定。さらに`runtime-local-ollama-builder.ts`188–191行は既存targetファイルを`local_model_target_unsafe`で拒否する。新しいfileを一度作る限定profileであり、既存候補を修正し続ける汎用Builderとは区別する。[sequence profile][sequence]、[local model Builder][local-model]

receiptとrequestファイルもJobの設定で固定されている。既存requestと候補が変われば`TRACKED_REPAIR_REQUEST_CONFLICT`または`VERIFIER_REQUEST_EXISTING_MISMATCH`で止まり、旧receiptのcandidate/source/artifact binding不一致も拒否する。旧証拠を上書きして第二候補を成功扱いする実装は許されない。[request公開][verifier-request]、[tracked profile][tracked]

残条件は、同じGoal/Jobのattempt・変更strategy、候補別Change Set/workspace/request/receipt、旧失敗証拠を保持する接続。ResidentHostの復旧修正だけで、実profileの複数推論完遂を証明したとは言えない。

## 9. 実証と未確認の線引き

実証済みは、固定リビジョンの構造・呼出し先・永続store・主要ガード、PRの履歴関係と主要差分、本書記載のsource上の欠落である。ローカル修正のRED/GREEN、独立レビュー、最終候補のCIは次節で別記する。

未確認なのは、実owner Goalによる実推論→独立検証→変更戦略→次Job→同一PR成果物、承認後の再開、環境喪失後の復元の一貫した完遂。署名者・host設定・runner外永続化・実readbackをfixture/cacheから推定しない。基準CIはIssue1219全受入の証明ではない。[PR1907][pr1907]

## 10. 今回の統合変更と最終検証

この節は2026-11-11のPR1907候補について記録する。第2節の開始時HEADと、下記の修正後候補を混同しない。公開後のexact-head CIと最終SHAは同じ[PR1907][pr1907]の本文・checksで追跡する。

### 10.1 実装した範囲

1. **受付と契約の原子性。** Compassの既存SQLite writer transaction内でGoal作成とintake decisionを確定する。同じkeyの異なる依頼、同時に届いた異なるGoal、QUESTIONとの競合で、拒否されたGoalを残さない。既存Goalへの異なる明示contractも黙って受け付けない。decision保存に失敗した結果はメモリcacheに受付済みとして残さない。
2. **検証結果からの有界な修復。** 必須チェックが揃い、候補と独立issuerに束縛された明示的FAILだけを修復対象にする。失敗証拠・試行回数・RECOVERINGまたはBLOCKEDを単一Job commitで保存し、その後candidate indexを更新する。途中中断は履歴から照合する。署名待ち、証拠不正、inconclusive、同一失敗候補、上限超過を区別する。
3. **既存本番callerへの接続。** `jarvis-goal-executor`から通常resident、sequence、tracked-repairの各factoryへ同じadmissionを渡す。host設定は実在するexecution manifestのdigest、受理済みGoal、scope、期限、実行node、既存Compassの`authorityPath`をpinする。Model/Goal/contextから実行権を作らない。
4. **既存writerと停止状態。** executorは検証・全bounded run・WorkRun書戻しを通じて既存OS-backed lockを保持する。adapter単独呼出しも同じlockを使う。live capabilityはGoalとpathに束縛され、解放後に無効となる。競合側はWorkRun全体を変更しない。routing前のJob作成・resource wait更新も含め、各await後とlocal candidate書込前に停止・scopeを再確認する。
5. **成果物と次Job。** 実Broker/executorを使う既存process fixtureにhosted admission版を追加した。署名待ち→process再起動→同一候補再開→次Job→2つの成果物ファイル→canonical Goal進捗を確認する。ただし推論応答・署名者・resource telemetryは明示したtest doubleである。

新しいController、Goal ledger、DB schema、モデルfallback、workflow trigger、署名鍵、外部保存サービスは追加していない。2つの新しいadmission moduleは既存要求へ静的に対応付け、変更した既存surfaceのhashを再照合した。要求の受入状態は引き上げていない。設定契約は[同日decision文書](../decisions/2026-11-11-hosted-goal-routing.md)を参照。

### 10.2 再現・独立レビュー・ローカル検証

受付の同時競合、混合intent、契約黙殺、検証失敗後の停止、無効な証拠の再起動、checkpoint中断を修正前に失敗として再現した。別担当のreviewでは、wrong-path writer、guard内await中のpause、待機前処理、terminal WorkRun、競合executorの開始書戻しも再現し、修正後に独立して閉鎖を確認した。現在の変更に未解消のP0/P1は報告されていない。これはコードレビューであり、本番signerによる成果物受入ではない。

| 確認 | 観測した結果 |
| --- | --- |
| 全体ESLint / TypeScript | `eslint .`、`tsc --noEmit`とも成功 |
| 全件Node test | 3,660件: 3,632成功、2失敗、26条件付きskip |
| 失敗2件の切り分け | `jarvis-network-local-runtime.test.mjs`。作業環境で`uv_interface_addresses`がerrno 1となり、private ingressの待機条件も成立しない。固定main6737e150でも独立実行し同じ2失敗・1成功を再現。test変更やskip追加なし |
| P8 Security Regression Suite | 332件成功、失敗0、skip0 |
| traceability / completion audit | 18件成功。要求受入の引上げなし |
| 実processのBroker sequence | 通常版・hosted admission版の2件成功。認証拒否、受付、restart、receipt待ち、次Job、成果物、canonical進捗を確認 |
| production build | `pnpm run build`成功。NextのTypeScript工程も成功 |
| production health | ビルド済みserverの実起動と`/api/health`の確認を実施。詳細結果はPR本文へ記録 |

Nodeは24.22.1、package指定pnpmは11.19.0。PowerShell依存testのため公式7.6.6 Linux binaryを一時導入し、公式release assetのSHA256と一致を確認した。Windows固有fixtureや外部runtimeの条件付きskipをnative完了の証拠に数えない。

全件testはこの作業環境では2件失敗しており、ローカル全件PASSとは記載しない。公開後はPRの実head SHAに一致するGitHub CIを確認する。基準CI42946087355の成功は旧HEAD1fba7e56のものであり、この候補のCI結果として流用しない。GitHub上の独立container検証も、fixture署名と本番signerの権限を分けて読む。

### 10.3 実運用の状態と残条件

**Issue #1219の実Goal受入はNOT_ACHIEVEDのまま。** 本書のsource接続・回帰試験は、以下の不足を解消済みとはしない。

- 受理済みGoalを継続するhosted production triggerと、run/hostをまたいで共有される永続authorityの有効な接続は確認できていない。同filesystem lock、cache、artifactコピーを分散所有権として扱わない。
- 実運用の独立signer、その秘密鍵管理主体、公開鍵pin、期限・候補に束縛された実受入receiptの接続は確認できていない。テスト用の一時署名鍵は代用しない。
- 既存signed Builder profileは固定candidate/prepared/request/receiptの制約を持ち、実モデルによる複数attemptの修復は未完。制御側のRECOVERINGが正しくても、異なる有効候補を実Builderが生成した証明にはならない。
- 現行sequenceは直列契約である。独立したJobのDAG scheduling、物理能力待ちを越えた無関係Jobの選択をこの変更では証明していない。
- 既存release adapterへの実接続、実PR/配布成果物のreadback、承認後の安全な再開、環境喪失後の同Goal継続は実受入として残る。

新しい信頼根・認証情報・権限・課金・本番activationが必要になる場合は、AGENTS.mdの既存gateを適用する。既存scope内の接続が確認できた場合に、架空の追加承認条件を作らない。Compass MCPの利用手段はこのセッションで確認できず、repositoryと既存PRに引継ぎを残した。

[pr1907]: https://github.com/haji84/AI-/pull/1907
[executor]: https://github.com/haji84/AI-/blob/6737e15033eced135461076d72f792516e83c9b3/scripts/jarvis-goal-executor.ts
[broker]: https://github.com/haji84/AI-/blob/6737e15033eced135461076d72f792516e83c9b3/scripts/jarvis-broker.ts
[adapter]: https://github.com/haji84/AI-/blob/6737e15033eced135461076d72f792516e83c9b3/src/orchestrator/compass-goal-execution-adapter.ts
[resident]: https://github.com/haji84/AI-/blob/6737e15033eced135461076d72f792516e83c9b3/src/orchestrator/resident-development-goal-host.ts
[router]: https://github.com/haji84/AI-/blob/1fba7e56bdadfbe5aac6bf3c5741501d373ea6fb/src/orchestrator/hosted-goal-work-router.ts
[mobile]: https://github.com/haji84/AI-/blob/6737e15033eced135461076d72f792516e83c9b3/.github/workflows/autonomy-mobile.yml
[cloud-run]: https://github.com/haji84/AI-/blob/6737e15033eced135461076d72f792516e83c9b3/scripts/autonomy-cloud-run.ts
[old-run]: https://github.com/haji84/AI-/blob/6737e15033eced135461076d72f792516e83c9b3/scripts/autonomy-run.ts
[work-store]: https://github.com/haji84/AI-/blob/6737e15033eced135461076d72f792516e83c9b3/src/orchestrator/compass-work-state-store.ts
[work-integration]: https://github.com/haji84/AI-/blob/6737e15033eced135461076d72f792516e83c9b3/src/orchestrator/work-state-integration.ts
[signed-receipt]: https://github.com/haji84/AI-/blob/6737e15033eced135461076d72f792516e83c9b3/src/orchestrator/signed-local-verifier-receipt.ts
[tracked]: https://github.com/haji84/AI-/blob/6737e15033eced135461076d72f792516e83c9b3/src/orchestrator/tracked-repair-resident-runtime.ts
[sequence]: https://github.com/haji84/AI-/blob/6737e15033eced135461076d72f792516e83c9b3/src/orchestrator/sequenced-resident-runtime.ts
[local-model]: https://github.com/haji84/AI-/blob/6737e15033eced135461076d72f792516e83c9b3/src/orchestrator/runtime-local-ollama-builder.ts
[verifier-request]: https://github.com/haji84/AI-/blob/6737e15033eced135461076d72f792516e83c9b3/src/orchestrator/resident-verifier-request.ts
