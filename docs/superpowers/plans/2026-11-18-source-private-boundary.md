# 承認済みSource境界の実装手順

1. 凍結修正案と現在の明示承認・期限を照合、既知のSource拒否条件を保存。
2. Captureの祖先roleと固定Source DACL transactionを独立にTDD実装。既存条件を保持。
3. Rootが専用手動workflow・strict wrapper・既存原本readを統合、独立レビュー指摘を解消。
4. source全4CI/署名6項目、通常保護付きmerge、exactmain全4CI/署名6項目。
5. 実機planの全対象・識別子・権限を確認後、未消費scopeでapplyを一度だけ起動。退避・claim・journalの読み戻し検証と個別DACL書込み・必要な復元を行う。
6. 同じ承認範囲内で実際の原本コピー・readOnly問い合わせを確認。失敗は段階に応じて診断し、適用済みDACLを再適用して許可を消費し直さない。証拠と未完条件を書き戻す。
