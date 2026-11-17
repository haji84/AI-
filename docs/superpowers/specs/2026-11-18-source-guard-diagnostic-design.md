# 元データ取得の拒否理由を固定コードで確認する

Issue1219 / Goal goal-fcc81c97e09153f7 / Job rotation-recovery-37を継続する。
PR1929はmain c7e6e19へ統合済みで、source/main全4CIと署名6項目が成功した。
実機44165132090でPROFILE ownerSYSTEM・DACL PRIVATE_POLICY_MATCHを確認し、元の誤拒否は消えた。
44166870328ではprivate layout初期化を通過後、SOURCE_ACQUISITION_INCOMPLETEで停止した。
44167461686の読取専用metadataで固定元DBは520192bytesのFILEとして存在した。
preserved=falseなので保存・取得完了は未証明で、Goal/HOLDは変更しない。

既存C#のsealed GoriqBridgePrivateGuardException.Codeを、source取得段階だけで
8個の固定SOURCE_PRIVATE_* failureCodeへ射影する。CLR型は実Capture assemblyに固定し、
CodeとInnerExceptionはCLR getterで読む。内側8段を上限にし、ETS・同名別assembly・
messages/Data/HResultと未知enumは根拠にしない。未知は元のgeneric codeへ戻す。
Acquireは元データと専用コピー先の両方を検査するため、SOURCE_PRIVATE_*は段階とguardの識別であり、
問題のファイルそのものを特定した証拠ではない。個別対象の修正には別の実機証拠を必要とする。
既存25keys、拒否条件、全owner/DACL/metadata/source整合性検査、原本read-only、private新規保存、
runtime・credential・OS権限・CI期限/資源/署名/保護は変更しない。

pure policy試験は既存の同一source C#compileを再利用し、全8reasonとwrapper、未知enum、
ETS shadow、同名別型、深さ、adapterのdispose/no-runtime、実workflowのclosed sanitizerを実行する。
RED/GREEN、fresh review、exact-source/main全4CI・署名6項目後に、一度だけ新しい診断付き固定読取りを行う。
元データの権限や所有者は、原因不明のまま変更しない。

MEDIUMの診断修正。現在の完全解消指示の通常範囲で進め、期限切れの特権許可を再利用しない。
rollbackはPShelper・依存pin・closed whitelist・試験の保護付きrevertを一緒に行う。
Capture/observer本体の修正済みpolicyは基準版を維持し、Windows設定・原本を戻す操作は生じない。
