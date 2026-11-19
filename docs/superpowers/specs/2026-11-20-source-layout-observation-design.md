# 固定取得元の読み取り専用配置診断

Issue1219 / Goal goal-fcc81c97e09153f7 / rotation-recovery-37。実機44629314535はUNKNOWN_SOURCE_OBJECT、変更0で停止。既存Sourceスコープのplan上限1は消費済み、apply0。作成元コードは同じSourceにstate.sqlite等も置く。実際の項目名は未確認で、所有者への読み取り依頼は保留中。

## 方針
所有者の「完全解消まで進める」「So needs to do.」に基づく通常のMEDIUM診断。選択は実装者の判断。所有者に新たな設計承認は求めず既存の完遂指示で進める。権限修復の範囲・回数を拡張するものではない。
既存の取得元・self-development直下だけを読み、名前を公知のBroker/Compassファイルの閉じたenumに分類する。名前、パス、SID、内容、例外全文はログへ出さない。未知名はOTHERとして数える。
既存の汎用inventoryは元workspaceをcheckout cleanする経路や原本DBを直接開く経路があるため使わない。元repairの未知対象拒否を変える方法も使わない。専用の手動metadata-only workflowを採用する。

## 契約
- 操作入口Invoke-GoriqSourceLayoutObservationは引数なし。Windows PS5、Microsoft署名、FullLanguage、所有者/main/manual、Runner21 ZBookと現在SID/単一Listener一致を確認する。
- 固定KnownFolderのLocal/GAIWorker/goal-1218-bridge-stateと既知self-developmentのみ。親chainのreparseを拒否しNTFS/fixed driveを要求、各branch最大32項目・10秒・hardjob3分。再帰なし。
- 列挙はmetadataのみ。Source以下のcontent read、create、permission/owner/service/credential/claim/Goal書込みは一切ない。
- 出力はversion/status/reason/entries/sourceCount/selfDevelopmentCount/unknownCount/consistency/contentRead/permissionChangedの10keys。entriesはlocation/category/kindの閉じた3keysで最大64。LIVE_SAMPLEDであり原子的証明や修復計画ではない。
- 期限2026-11-20T06:00:00Z。既存contents:read、owner/main/current4CI、source SHA256 pin、runner21のガードを維持。Actions checkout/usesなし。既存readonly concurrency groupを共有。
- Native Source repair/capture/wrapper/workflow/originalReaderはbyte exactのまま。plan consumed1/apply0の予算をリセットしない。診断は別のone-shot metadata budget1。
- 新source/main4CI+署名6を確認後にmetadata診断を1回。許可された新修復対象を決める前に実際の分類結果を確認し、必要な権限拡張は別の具体的なHumanGateにする。

## 検証
純粋な分類・closed JSON・OTHER/例外の非漏えい・32/64境界・temporary treeの非再帰/非変更を実行で検証。workflowをinert時計/HTTP/観測境界で実行し、owner/main/CI/runner/pin/期限とoutput拒否を確認。Windows PS5 fixtureも既存5分CI内で実行。既存上限・テストを弱めない。
