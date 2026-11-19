# AI社員の品質改善 第1巡（2026-11-19 JST）

対象: haji84/AI-、既存Issue #1216（再発防止学習）、関連Issue #1219（GORIQ実働Goal）。新しいGoal・Controller・モデル・API・認証・本番権限は作らない。現行のState/Gate/Verifierの権威を変更しない。

## 1. 最近の実失敗と原因分類

| 分類 | 現象・事実 | 根拠 | 未解決の境界 |
| --- | --- | --- | --- |
| PARSE_BOUNDARY | 正規32文字の登録トークンが偶然ji_で始まると招待と誤分類され403 | [PR #1934](https://github.com/haji84/AI-/pull/1934) | ソース修正・CI合格と本番Goal達成は別 |
| TEST_ADMISSION_TIMEOUT | Windows CI 5分停止、別ホスト7ケース10秒超 | [PR #1933](https://github.com/haji84/AI-/pull/1933) | 実行分割・並列化で検証成功、CI揺らぎの根本原因未確定 |
| PRIVATE_SOURCE_ACCESS | 保全準備段階で原本のprivate storage取得を拒否 | [Issue #1219](https://github.com/haji84/AI-/issues/1219)、[PR #1932](https://github.com/haji84/AI-/pull/1932) | OS承認期限切れ、実機plan/apply各0、原本回収不明 |
| GOAL_COMPLETION_GAP | コード/CI成功でも元Goalの実Job継続・成果物完走証拠がない | [Issue #1219](https://github.com/haji84/AI-/issues/1219) | goal-fcc81c97e09153f7 / rotation-recovery-37 は NOT_ACHIEVED / G1 HOLD |

優先して扱う代表仕事は、実例が繰り返しある「不具合の再現→原因診断→修正→テスト→対象SHAのCI→実運用判定→報告」。全業務の頻度を統計的に計測したとは主張しない。

## 2. AI社員へ渡す完成見本と合格条件

次の各欄を一件ごとに埋める。埋められない欄は未確認とし、適当なPASSで埋めない。

1. **依頼とID**：既存Issue・Goal・Job、現行mainと対象SHA、認証範囲と期限。既存Goal重複を拒否。
2. **完成の定義**：ユーザーが欲しい成果物、コード完了の条件、実稼働完了の条件を別々に明記。
3. **再現証拠**：修正前の実テスト・ログ・条件・日時・失敗署名。原因を推測から確定へ昇格させる条件も明示。
4. **修正戦略**：過去の失敗との相違点、最小のコード差分、対象外ファイル・安全制約を保持した証拠。
5. **検証**：同じ条件のRED→GREEN、既存回帰、失敗数・skip数。テストの緩和・削除でPASSを作らない。
6. **CI・保存**：PR HEADと対応CI、統合後は統合mainのCI。署名/ハッシュ/真正性を別途確認し、古い成功を使い回さない。
7. **本番**：実データ・実端末・再起動復旧・次Job・成果物を必要な範囲で確認。未実行はUNVERIFIEDのまま。
8. **本人の手直し**：追加指示・修正件数・手直し時間を実測し、欠測時はnull（ゼロにしない）。
9. **最終報告**：source/テスト/CI/実GoalのPASS・FAIL・UNVERIFIEDと、未達の理由・安全な次アクション。

### 完成見本（PR #1934）

発行済み32文字トークンが偶然ji_で始まると招待キーへ誤ルーティングされる事象を再現。既発行Mapの存在確認のみで分岐を修正し、期限・mode・回数・replay・招待失効の既存検証を維持。新規5回帰は修正前RED、修正後GREEN。関連検査・保護されたmainの全4job CIにPASS記録がある。ただし元の原本回収と同一Goalの完走は未検証であり、GORIQ全体をDONEにしない。最後まで誤認なく報告できて初めて報告品質に合格。

## 3. 修正前後の実行済み比較

- データ: docs/evidence/1216-20261119-ai-employee-quality-cases.json
- 実行: node scripts/ai-employee-quality-audit.mjs
- 回帰: node --test tests/ai-employee-quality-audit.test.mjs

既存2件を「失敗再現・原因裏付け・回帰テスト・対象SHAのCI・本番Goal」の同一5ゲートで採点。各PASS/FAILには当該GitHub根拠URLを要求。Unknownを0件やPASSにせずUNVERIFIEDのまま扱う。

PR1934: 2/5→4/5。PR1933: 1/5→3/5。合計ゲートPASSは3/10→7/10。

**これは過去のコード修正記録の事後比較。AI社員の正答率が30%→70%に改善した証明ではなく、同じAI社員を改善前後で実行したA/Bテストでもない。** 元の手直し件数/時間は未記録で、減少は未測定。本番Goalは引き続きNOT_ACHIEVED。

## 4. 実際にAI社員の精度が上がったかを判定する手順

実案件で現行AI社員の指示・入力・モデル・失敗・最終成果と本人手直しの回数/分数をFreeze。改善候補にはこの完成見本と関係する失敗記録を与え、条件をそろえた未使用課題で比較する。正答と実完遂が改善し、本人手直しが減り、費用・安全性・未使用課題の成績を悪化させていない時だけ昇格する。元の答案を使って候補を調整したなら、その案件を未使用テストと呼ばない。

既存のR6内部ベンチマーク120件・heldout20件、Goal Controller/Compass/Verifier/Human Gate、追加課金ゼロ方針を維持する。モデル実行・原本接続・実機証拠が取れなければ未実施として報告。これらの文書は実AI実行の代用品にならない。
