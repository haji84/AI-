# 取得元ACL API検証手順

1. 実機の追加read権限と所有者の不一致を保存し、広いAppData変更を除外。
2. Native担当が専用のWindows一時ACL fixtureを作成。RootはCI stepと証拠・計画を統合。
3. Linux CompileOnly/構文確認と独立レビュー。Windowsで実際の非伝播・将来子・限定更新・比較付き復元を確認。
4. 通常のPR/source CI証拠を保存。製品の安全条件や実機ACLを変更せず、具体的な限定修正案の承認へ進む。
5. 承認された場合も、製品コード・OS変更は別の実装検証・新しいCI/署名・実機preflightを通す。API検証だけでエラー解消を宣言しない。
