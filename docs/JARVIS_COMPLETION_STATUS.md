# JARVIS 実装・残作業の再同期監査 — #865

監査日: 2026-09-17 JST。対象main: `14f0651a51ba79a53bff36f15175351d44f0f2fb`。
親Goal: [#681](https://github.com/haji84/AI-/issues/681)。追加仕様: [#783](https://github.com/haji84/AI-/issues/783)、[PR #784](https://github.com/haji84/AI-/pull/784)。今回の作業: [#865](https://github.com/haji84/AI-/issues/865)。

## 結論

**JARVIS全体は未完成。基盤コードは多く存在するが、全機能をつないだ製品と実機Evidenceは不足している。**
以前の「音声・ジェスチャー・UI機能が未実装」という説明は広すぎた。mainには限定実装がある。
反対に、mainのテスト成功や履歴のCOMPLETEを、そのまま全製品の完成と解釈してもいけない。

以下を分ける。

- **main実装あり**: 現在のmainでコード・関連テストを確認できる。全要求達成、配信済み、実機PASSとは別。
- **一部実装**: 共通基盤、限定した操作、UIだけなど。要求の全範囲には達していない。
- **未統合**: 修正は別PR/branchにある。現在のmain機能として数えない。
- **未実装／未特定**: 監査範囲で要求全体を担う実装を特定できない。関連基盤の存在は別途記載。
- **実機検証待ち**: 対象commit・端末・操作・結果を結合したEvidenceが足りない。

## 分野別

| 分野 | mainにあるもの | 未完成・不足範囲 |
|---|---|---|
| 登録・Fleet | 所有者画面の複数選択登録、Worker署名、登録端末を遠隔一覧へ反映、100/101台のソフトウェア境界テスト | 実機100台、更新の全端末展開、登録中断なしの長時間運用証明 |
| Android遠隔操作 | Android 11+のnative Wi-Fi screenshot/input、署名mailbox、USB/ADB経路 | 各端末への配信・権限・OS別動作確認、Android 8、画面OFF復帰の本番受入 |
| Live View | 単体・分割・grid関連UI、静止画更新、H.264/WebCodecsの60秒限定試行 | 常時低遅延のWi-Fi動画、全browser・長時間品質・同時負荷。試行版を完成streamingと呼ばない |
| 手順記録 | JARVIS経由操作記録、手順保存、機種条件、限定再現・検証 | 任意アプリ・機種の自動適応、画面変化時の修復、日付で変わる作業の汎用判断 |
| 録画から学習 | 動画場面抽出、手動説明、local VLMの限定安全navigation推論・検証経路 | 任意tap/swipe/textの完全理解、誤操作・訂正の意味理解、任意アプリの独立した実機再現PASS |
| iPhone | Keychain・stable ID・署名結果・reconnectの実装と過去の実機Evidence | 最新main・新Coordinatorでの再検証。Android同等の自由操作とは扱わない |
| Windows/Mac Worker | Worker契約・profile・adapter基盤 | Office/browser/filesystem等すべての実操作が使える証明。profile宣言だけでは実装完了ではない |
| UI | Home/Devices/Tasks/Research/Settings、20 theme/20 persona、独立設定、widget操作・履歴、search、各mode、通知・接続表示 | 全画面統合、端末別Visual QA、3〜5m視認性、支援技術、本番状態との一致 |
| 音声・context | 限定コマンド、共有履歴、選択・履歴による「これ／さっき／2番目」、発話制御UI | 任意画面の意味理解、自由なGoal操作、OS/browser別barge-inなどの実機受入 |
| Gesture/IMU | local粗い動き検出、4リンク選択、明示確定、IMU navigation | 指・手の意味理解、汎用端末操作、誤検知率・距離・照明条件の実測 |
| 自律実行 | Goal/DoD/state、durable task、retry、replan、verifier、dynamic teamの基盤 | 「なんとかしといて」から任意の仕事を製品品質まで完了する統合、自律実行の長期実測 |
| Memory/Skills | 永続memory、成功条件付きskill、continual learning・self-improvementの基盤 | 信頼・期限・用途・訂正伝播の全経路制御、実演の誤操作修正学習、実運用効果の評価 |
| Offline/Recovery | queue/checkpoint/lease/idempotency/sync/self-healing基盤、Windows起動修正履歴 | 実際のOS再起動、停電、長期切断、再接続後の無重複再開と復元試験 |
| Security | Owner Auth、署名、nonce/replay/clock、Human Gate、private ingress、negative tests、限定secret scanner、privacy UI | 全体Security Kernel統合、default-deny egress、即時失効伝播、tenant分離、保持・削除・DR・独立監査 |
| Fact/Numerical Verification | 一般Verifier・benchmark基盤 | Claim別出典権威、独立origin、鮮度・矛盾・引用適合・confidence・Evidence Graph・数値独立再計算の統合engine |
| Organization | team記憶・一般的な永続化基盤 | 規程・権限・正式template・施行日・版・例外のDigital Twin、組織governance profile、変更影響Graph |
| Home Coordinator移行 | 現行Broker等を再利用可能。別PRにM0監査・baseline比較準備 | 論理role/ID、compatibility bridge、shadow、state replication、single writer、canary、無損失rollback、自動LAN/WAN選択、持出/帰還実証 |
| Release/運用 | 起動・remote関連scriptと操作資料 | 完成したfirst-run wizard、全端末update/rollback、backup restore、SLO/RTO/RPO、terminal不要の日常運用受入 |

### 重要な限定範囲

動画学習の正確な範囲は [video teaching architecture](architecture/jarvis-video-teaching.md) を参照。
512 MiB/3時間までの入力受付と、3時間分の操作を正しく理解して自動実行できることは同じではない。
現行local AIは12 frameを用いる限定経路で、任意のswipe/textや非Android adapterを完成扱いにしない。

UI/音声/ジェスチャーは `src/app/jarvis/` と関連testsに存在する。
ソース契約・純粋関数テストと、実機で見える・聞こえる・操作できる証拠は区別した。
`src/gai/initial-worker-adapters.ts` のhandler登録方式は実装を呼ぶ仕組みであり、全handlerの提供を保証しない。
`src/gai/model-router.ts` の限定tier選択は、データ分類・実績・全modality・hardwareを扱う完成Routerではない。

## main外の作業

本監査のbaseには以下の変更は入っていない。PRの存在を配信成功と数えない。

| PR | 内容 | 残る出口 |
|---|---|---|
| [#784](https://github.com/haji84/AI-/pull/784) | 仕様103–130 | この監査へ原文を取り込み。機能実装の証明ではない |
| [#858](https://github.com/haji84/AI-/pull/858) | Worker更新機構 | 署名系列との互換、OSによるinstall確認、登録保持、全端末での更新結果 |
| [#860](https://github.com/haji84/AI-/pull/860) | Android 8対応 | 署名APKの配信・MediaProjection許可・Android 8実機の画面/操作/再接続 |
| [#862](https://github.com/haji84/AI-/pull/862) | 画面OFFからの復帰 | 安全なwake、lock時停止、対象機種での実機検証。lock解除迂回はしない |
| [#864](https://github.com/haji84/AI-/pull/864) | Coordinator監査準備 | M1以降の実装、shadow/canary、実機移行。Macの常設稼働準備も未完了 |

一般端末のOS許可を回避する「完全無確認更新」を完成条件として偽らない。
利用できる更新能力は端末のmanagement状態と署名互換を検証して表示する。

## 現在の登録baseline

2026-09-17 20:49:22 JST、Windowsのproduction DBをread-only transactionで取得。

- 登録Android **38台**。認証情報が存在しない端末 **0台**。
- 保存状態で直近heartbeat扱い **0台**。これは「登録消失」ではない。
- snapshot中のtask **0件**。他hostや端末local queueまで空と推測しない。
- production commitは監査baseと同じ `14f0651…`。
- snapshot hash: `09eac260feab6fded7938541884656b0698a073b470129cf74adfb712e0c8cd7`。
- 全Device metadata snapshotはlocal `tmp/physical-remote-tools/CURRENT_CONNECTED_DEVICE_BASELINE-865.json` に保持。secret値をrepoへ保存していない。

この取得はlive疎通、全host/iPhone/Macのinventory、migration後比較の代替ではない。
現行ingressは従来LAN IPへの依存があるため、持出し時にそのまま繋がると保証できない。
ZBookを家に置く旅行時の暫定運用と、完成後のmobile ZBook構成は別。
今回はcredential・登録・service・endpoint・firewallを変更していない。

## Ledgerの数値と読み方

340件 = 元の244 ID + MIG 30件 + 最新section 2–35のCORE 34件 + #784のGOV 28件 + 過去に確定したAndroid追加4件。
元IDは削除していない。新規の大きなRequirementはsubconditionを含むため、件数は実装工数や完成率ではない。

- VERIFIED: **0**
- IMPLEMENTED_UNVERIFIED: **2**（100-node/101st overflow software項目）
- PARTIAL: **276**
- MISSING: **62**
- PLATFORM_LIMITED: **0**

0 VERIFIEDは「動く機能が0」の意味ではない。要求全体・必要Evidence Class・commitの結合が完了していないという保守的判定。
ACCのMISSINGは**要求された現行受入Evidenceが不足**という意味で、基盤コード不存在とは別。
MIGのMISSINGも、既存Brokerや署名を作り直す指示ではない。
未確認をPLATFORM_LIMITEDへ逃がさない。

全行は [正本](JARVIS_PRODUCT_SPEC.md)、[machine-readable matrix](jarvis-requirements.json)、
[監査範囲と配信確認状態](jarvis-implementation-audit.json)、[source crosswalk](jarvis-spec-crosswalk.json) を参照。
`CARRIED_FORWARD_EVIDENCE_MAPPING` は既存mappingを保持した行。全行の動的再検証を新規に行ったという意味ではない。

## 確認できたEvidenceと限界

- 対象main: `node --test` **972/972 PASS、skip 0**。最初はGit BashがPATHに無くshell syntax testが起動できず1件失敗。PATHを修正して再実行し、testは変更していない。
- この監査変更: requirement validatorと追加したsource/migration evidence gate testsを実行。全974件PASS（skip 0）、対象ESLint・git diff --check PASS。
- 過去iPhone: [exact-SHA証拠](audit/jarvis-p4-iphone-physical-evidence-2026-09-16.md) の `553b58a…`、task `iphone-physical-e2e-004`。current mainや新CoordinatorのPASSへ流用しない。
- [#852登録・Wi-Fi実装Evidence](evidence/852-unified-enrollment.md) はscope付きで再利用する。
- [P8独立監査](audit/jarvis-p8-independent-security-audit.md) は独立review未完了。実装者が独立PASSを自認しない。
- #783/#784は過去のowner sections 1–102を参照するが、その原文全部は確認したrepo資料に含まれない。最新0–67、既存244、MIG30、addendum103–130の対応は保持したが、過去原文との完全な意味一致は未証明。P0の完全監査完了とは宣言しない。

## 次の順序

1. 現在の38台について接続経路とheartbeat復帰を確認。再登録・鍵交換で直さない。
2. #858/#860/#862を相互依存と署名系列を含めreviewし、1台canaryで更新・Android 8・wakeを検証する。進行中の登録を保護する。
3. #681/#783の過去原文とcarry-forward行の未再監査部分を照合し、各行の受入条件と証拠を埋める。
4. Home Coordinator M1/M2を既存endpointに追加し、M3/M4は副作用なし。新host準備前にZBookを外しても稼働するとは扱わない。
5. 既存Android/iPhone各1台のM5/M6実機PASS後に段階展開。ZBook持出・帰還・rollbackを証明する。
6. P5/P6の既存UI/voice/gestureを再利用し実機QA。P7のGoal completion・Fact・Input Recovery・Organization統合を小さなIssueへ分解する。
7. P8独立auditとP9電源/切断/long-horizon/physical acceptance、P10 owner-ready運用を満たすまで完成扱いにしない。

## 変更とRollback

このissueは台帳・監査・検証器の変更。Production runtimeや登録DBを変更していない。
Rollbackはこのissueのdocumentation/validation commitをrevertするだけでよい。既存deviceに再Enrollmentは不要。
