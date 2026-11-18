# 発行済み登録トークンの種類判定

Issue #1219 の必須main CIで、100台までの登録を確認する既存テストが403で失敗した。通常実行は成功し、正規の32文字base64urlトークンを `ji_` 始まりに固定した同じテストは403で失敗することを、実装担当と独立レビュー担当が再現した。

登録トークンは24 random bytesから32文字を生成する。招待secretは `ji_` +43文字だが、Brokerは先頭3文字だけで招待処理へ振り分けていた。既発行トークンがその先頭文字になった場合も、招待secretとして拒否される。

既存登録トークンMapへの読み取り専用の存在確認で、発行済みトークンを既存consume処理へ送る。consumeの存在・期限・mode・使用上限・replay検証は保持する。未知／不正な `ji_` と実際の46文字招待は、従来の403・rate limit・失効・登録上限検証を通す。新しいissuer、credential、権限、scope、TTL、登録枠を追加しない。

この変更は通常のコード修正としてMEDIUMで審査する。既存の認証済み完成指示と必須CI blockerの解消を根拠にし、期限切れのSource OS権限承認を根拠にしない。Source Native・wrapper・pin・実機権限は対象外。実機適用は0回で、期限延長案は未承認のままprivateに保持する。

正規prefixを固定した実Broker経路と既存の100台テスト、直接token／grant／legacy grant、replay・expired・unknown、実招待の失効・上限、quick/fullの境界を検証する。独立レビューとsource/mainの全4CI・署名6項目が必要。Goal NOT_ACHIEVED / G1 HOLDを維持する。
