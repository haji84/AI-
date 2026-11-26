# 取得元ACL修正のAPI検証

Issue #1219 / Goal `goal-fcc81c97e09153f7` / Job `rotation-recovery-37`。

ユーザー提供ACLではAppDataの追加Windowsアカウントまたはグループへの読み取り許可がDBまで継承され、WORKERはAdministrators所有だった。取得処理は親ディレクトリにも本人専用条件を適用するため拒否する。取得元・OS権限の変更は未承認で、元データ取得の成功も未確認である。

AppData全体の読み取り権限を外す案は、他アプリへの影響と復元範囲が広いため選ばない。代案の検討には、既存の子へ自動伝播させず、明示的に検証したハンドルだけのDACLを変更できることを先に確かめる必要がある。

[MicrosoftのSetSecurityInfo仕様](https://learn.microsoft.com/en-us/windows/win32/api/aclapi/nf-aclapi-setsecurityinfo)には「If the supplied handle was opened with an ACCESS_MASK value of MAXIMUM_ALLOWED, then the SetSecurityInfo function will not propagate ACEs to children.」とある。本差分はこのAPI特性を独立した一時ディレクトリで検証する。

Windows PowerShell 5.1/C#5で、新規の専用一時ツリーと実在しないfixture用SIDを使用する。ハンドルのMAXIMUM_ALLOWED、SHARE_ALL、OPEN_REPARSEを明示し、SetSecurityInfoはDACLと保護フラグだけを設定する。親変更時の既存子・外側の兄弟の記述子不変、将来子の新しい既定ACL、明示した子だけの変更、親から順の復元、変更前後の比較不一致時の拒否を検証する。Owner/Group/SACLは設定しない。新規子を含むツリー全体の完全復元を主張しない。終了時は隔離CIで作成した既知の一時パスを非再帰で削除する。同時に別プロセスがパスを置換する状況の完全な同一性保証は検証範囲に含めない。

LinuxのCompileOnlyはPS/C#構文検証専用で、Windows成功マーカーを出さない。実際のWindows検証は既存CIのwindows-runtime-byte-fixturesの独立stepとして行い、4job構成・既存回帰・時間/資源制限を維持する。製品Capture・ACL方針・実機の権限・所有者・サービス・原本データは変更しない。

この検証の成功はAPI特性の証拠に限る。取得元の本人専用境界と親の整合性検証の実装、独立レビュー、必要CI、明示的な権限変更承認、実機の退避・変更・復元検証、原本取得の成功は別途必要である。G1 HOLDを維持する。
