# PROFILEのACL拒否を読み取りだけで区別する

同じGoal `goal-fcc81c97e09153f7` / Job `rotation-recovery-37`。
実機run44129203049はSYSTEM所有のPROFILEを確認しowner判定を通過したが、
DACL=UNVERIFIEDで止まった。ユーザーはエラーの完全解消を指示した。
直前の手動helperは端末に保存されておらず、相対pathから実行できなかった。

## 方針

同じgeneric診断の反復では原因が増えない。既存の安全なobserverに、最初の
拒否ACEのclosed分類を追加する。既存7fact keysとreason、ターゲット、transport、
時限、native権限は維持し、失敗時のdacl enumだけを詳しくする。
旧UNVERIFIEDも維持する。個人名、SID、path、SDDL、raw ACLは出力しない。

分類はunsupported/callbackの形状、またはOTHERへのALLOWを、既知の公開principal
class（Everyone/AuthenticatedUsers/BuiltinUsers/ApplicationPackages/
RestrictedApplicationPackages/OtherAccount）と「read/execute許可のみ」または
「書込・権限制御・その他bitあり」に分ける。mask=0もnonwriting分類とする。
新しいprincipal分類は既存Accountとは分け、既存Reducerの拒否条件を変えない。
Capture本体の規則を変更せず、何を拒否したかの観測だけを追加する。

parent closed validatorは列挙値だけを許可し、成功やowner拒否との矛盾を拒否する。
ALLOW拒否をmetadata-only ancestorへ付ける偽reportも拒否する。
observer/parentの2pinsを同じ変更として更新する。

## 比較と判断

ローカルのinline読取りは最短のためuserへ別途提示した。reply待ちだけで停止せず、
既存の実機経路から自動で取れるclosed分類を用意する。
OS ACL修復やprofileのDACL例外化は、実際のACLが不明な現時点では選ばない。
追加緩和・OS権限変更・原本Acquireは本診断では承認しない。

## 検証・次の行動

純粋なclass/mask/順序/既存Reducer維持をC#5でRED→GREEN検証し、偽closed reportを拒否。
関連試験と固定source全体、fresh source review、全4source/main CI、署名付きartifactを
確認後、新しい分類を返すowner-only観測を1回だけ実行する。
実結果から原因と最小修正を決める。通常のcode修正は進め、別のsecurity緩和が必要なら
差分・リスク・rollbackを具体化して本当に必要なHuman Gateだけを求める。
元Goalは証拠が揃うまでNOT_ACHIEVED / G1 HOLDのまま。

rollbackはclassifier、closed validator、2pinsをまとめた保護付きrevert。
Windows側の設定・原本を変更しないため、その復元操作はない。
