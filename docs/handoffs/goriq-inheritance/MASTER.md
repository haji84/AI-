# GORIQ 完全継承・再構築マスター引継ぎ（#1944、候補）

2026-11-26 JST / owner request: 「今度こそ、何を作るかを忘れない仕組みを作ってから、GORIQ本体の開発を進めよう。」

## 1. Goal と正本

GORIQは特定のPC・外部AIに恒久依存しない汎用自律型AI OS。従来の独自頭脳、記憶・自己学習、汎用実行、自律開発、分散処理、実機/遠隔操作、音声/ジェスチャー/UI、研究・制作、セキュリティを保全し、経営戦略・マーケティング・営業・販売・財務管理能力を追加する方向。機能を削減せず、実際に成果を出せる単位で開発を進める。

本書とbaselineは引継ぎ・比較のための資料で、別のGoal Controller、State Controller、仕様正本、承認権限ではない。正本は既存のAGENTS.md、PROJECT_STATE.md、ROADMAP.md、docs/JARVIS_PRODUCT_SPEC.md、docs/jarvis-requirements.json、owner decisions、#681 / #1205 / #1216 / #1219等、および既存runtimeのCompass/Goal/Job・証拠記録。採用した追加要件は既存Living Specificationの同期手続へ渡し、承認やSPEC_SYNCEDを捏造しない。

## 2. 保存済み基準

- 基準main: ea02180eac6fe46522b62eae6916f26f3844719d。
- baseline-20261126.json: 341件の既存ID・title・description・必要証拠・source_decisions、認知コア17項目のID/名称、R1～R20の行、ROADMAPのCreator 14＋GAI 21見出し、既存owner decisionの出典/関連ID、追加ID割当、原本blob参照を保存。MarkdownとJSONの全行の内容一致を確認した。台帳のステータスは VERIFIED 3 / PARTIAL 256 / IMPLEMENTED_UNVERIFIED 18 / MISSING 64。完了率ではない。
- asset-inventory-20261126.json: open PR111件（100+11）、branch232件（100+100+32）の取得メタデータ。両方とも短い終端ページを確認。時点の棚卸しであって原本のバックアップや各差分の検証ではない。
- 既存の逆監査 report は626 surfaceを登録。現時点で実装→要件の個別再評価は行っていない。既存のvalidator/auditを継続利用し、対象外の制作機能等は別途監査する。

## 3. 機能保全

製品要件の全22分類: NET 7, HOST 8, FLEET 11, DEV-A 15, DEV-I 8, DEV-PC 7, RA 22, UI 38, INT 17, GEST 8, AUTO 31, MEM 8, OFF 12, SEC 19, OPS 18, ACC 9, TEACH 6, MIG 30, CORE 34, GOV 28, DEV-AX 4, OWN 1。

特にRA-001〜022は独立した中核能力。ライブ表示（1/2/4/一覧）、端末能力表示、PC/Android操作、スクリーンショット・録画、セッション認証・暗号化・タイムアウト・監査、AI→本人→AIの再観測と再開、iOS制約内の安全な代替、重要操作のジェスチャー単独確定禁止を省かない。UIは35画面デザイン、自由配置、独立音声設定、PC/スマホ向け表示を保持。分散ノードは特定の恒久main PCを前提にせず、端末の能力・負荷・認証と永続状態に従う。

COG-001〜017はOWN-001の詳細であり重複集計しない。R1〜R20は別の研究評価、Creator Studioは別の制作開発計画。製品リリースとAGI主張を混同しない。

経営領域の追加候補: 経営/事業戦略、市場・競合・需要・価格調査、商品企画、収益/原価/作業時間モデル、営業・顧客・販売支援、財務・実績管理、AI社員/担当/期限/進捗・成果物・判断待ちの司令室、フローチャート。既存のCORE-032等と意味照合し、必要な追加のみ既存Living Specificationで同期する。販売・課金・外部公開・顧客情報・権限は既存ゲートに従う。

## 4. 機械的な脱落防止

毎回、既存の正本検査に加え次を実行する（repository root）:

    node scripts/validate-jarvis-requirements.mjs
    node scripts/jarvis-requirement-audit.mjs --check
    node scripts/goriq-inheritance-guard.mjs --check
    node --test tests/goriq-inheritance-guard.test.mjs

新規guardは初期基準の341 ID、意味の明示変更、必要証拠と所有者出典の削除、認知項目/研究/roadmap/決定・割当の脱落、正本全行の不一致を検出する補助検査。既存要件の進捗・証拠記録の更新や新要件の追加自体は阻害しない。仕様の意味変更はreview-requiredとして検出する。正当な変更は既存owner-decision/traceabilityの手続で審査し、基準履歴を保存した明示的な更新として扱う。基準ファイルの自動生成し直し、検査を無効化して通すこと、意味不変のID一致だけで移植完了扱いすることは禁止。基準自身の改変はGit履歴/既存保護されたレビューで確認する。将来追加要件の保持は既存canonical additional inventoryに従う。

この検査は文章・ID・証拠要件の保存を検査するもの。全機能の動作保証、文章の意味同等性AI判定、全PR差分、記憶/実機バックアップを代替しない。Node testを通常のテスト探索に追加した候補だがCI実行前。既存workflow・権限・本番・デバイス設定は変更しない。

## 5. 進め方 / 完成判定

G0: 本候補の新規テストと既存validator/reverse auditをexact PR HEADで実行。新しいテストが実際に通常CIへ入り、既存テストを壊さないことを確認。失敗は原因と変更点を記録。保全検査PASSは製品完成ではない。

G1: 各既存IDを実装・テスト・証拠・責任モジュールと照合。再利用/接続/修正/再設計/未実装/代替制約の判定は実物を確認して記録。open PRとbranchごとに差分・現在mainとの差・依存・試験・重複・保全/再利用候補を分類。優先PR #1832 遠隔操作、#1935 AI社員評価、#1764 自動再開、#1759 分散制御。closed/staged資産、未コミット作業、Compass/Goal/Jobの原本、端末登録・鍵・記憶・学習・証拠は安全な読取りと承認されたバックアップ経路で別に確認する。秘密や実データをGitHubに書かない。未確認資産は未確認、無断削除・一括merge禁止。

G2: 既存Goal/Gate/State/Capability/Verifierを再利用する薄い実働経路を作る。Goal Resolverで許可済み範囲と依存関係を確定し、旧goal-fcc81c97e09153f7 / rotation-recovery-37はNOT_ACHIEVED/G1 HOLDのまま保全する。旧原本が必要な受入条件と、無関係で独立して検証できる業務を混同しない。旧Goalを新規Goalで代替したと報告しない。既存の必須順序・統制の変更はレビュー/必要承認後にのみ実施する。

最初の本体の実働確認候補:
1. 既存Goalの受付→Job分解→担当割り振り→実行→検証→成果物保存→次Jobの自動継続を、現行の許可済み入力・データで一巡する。特定の旧原本が不要な独立検証は別に記録。
2. 司令室から同じGoal/Job/成果物/判断待ちを読み取って表示する。仮進捗を禁止。既存35画面仕様と共通データを維持。
3. 遠隔操作を別の中核機能として実証。#1832の差分・既存Remote Gateway契約・実機許可を照合し、利用者による接続、AI操作、Human Takeover、再開の各証拠を取得。端末の秘密情報を保存しない。
4. 上記実行経路で市場調査・競合比較・商品企画・収益試算等の成果物を実際に作る。追加経営機能は正式仕様同期後に接続。
5. 残る既存要件を落とさず再利用/実装/検証し、複数業務と分散/停止復旧/学習を接続。新機能一件の成功で341件全体を完成としない。

個々の独立業務の進行を不必要に停止させず、本番の必須ゲート・認証・既存データを維持。正式なGoal変更・安全境界変更・本番・移行はこのDraftで許可しない。必要な技術や資産を再調査するときは期限/回数を bounded とし、新しい証拠のない同じ探索を繰り返さない。

## 6. 今回の実行結果・引継ぎ

- 作成Issue #1944、作業branch feature/1944-goriq-inheritance-guard。
- GitHubから読み戻した新guardの純粋関数をV8で実行し、実基準照合＋欠落・重複・縮小・PHYSICAL証拠削除・鏡不一致・認知/R/roadmap/割当/決定消失・基準切詰め・進捗更新/新行の16ケースすべて期待結果。script blob 3eb84890bb11a09c3ceb68296a9c1a3891c41f54。Nodeのファイル読取りCLI、node:test、lint、CI、実機は未実行/未確認。テストデータを本番証拠扱いしない。
- Compass MCPの利用可否・現在runtime Goalの読戻しは未確認。Issue/PR/本書に状態を残す。既存main、旧Issue、実機、認証、権限、履歴、依存関係は変更しない。Draftのみ。rollbackは候補branchの採用中止（既存mainに影響なし）、保全基準・履歴は残す。
- NEXT: exact PR HEADのNode/既存audit/CI検証、全資産の実物対応付け、既存Goal Resolver経由の本体実働経路。既存の個人情報・秘密・費用・Human Gateの境界を変更しない。
