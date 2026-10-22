# 署名配布の準備

Issue1831 / PR1832。2026-10-23確認。**鍵発行・署名・アップロード・配布は未実施。**
現在の候補は`distributable:false`のままです。TLS証明書、端末認証鍵、コード署名鍵は
別の用途です。所有者ログイン鍵やGORIQの鍵を署名へ流用しません。

## Android：専用の継続使用する鍵でAPKを署名

APK署名には有料CAの証明書を購入する必要はありません。独立した本番用keystoreを
本人承認後に生成/保管し、同じ鍵で更新します。debug/physicaltest/externaltest用の鍵・
パッケージを正式版としません。鍵を失うと既存インストールの更新が困難になります。
[Android署名](https://developer.android.com/studio/publish/app-signing)、
[apksigner](https://developer.android.com/tools/apksigner)。

次の値を確定してから署名します。ここに秘密値を記入しません。

- 所有者/発行名、`app.goriq.remote.lite`の通常版、単調増加するversionCode。
- keystoreの私有パス、alias、証明書SHA256指紋、有効期間、管理者。
- 暗号化された別媒体バックアップと復元確認。passphraseはパスワード管理で保持。
- 署名前のソースSHA、CIの検査対象SHA、unsigned APK SHA256。
- 使用するJDK/Android Build Toolsの版と入手元。実際の署名済みAPKも受入対象にする。

例として、本人の非共有・非同期ディレクトリ内の
`%LOCALAPPDATA%/GORIQ Remote Lite Publisher/android/`を候補にします。
OneDrive、Git worktree、GitHub secrets/artifact、チャットにkeystoreを置きません。
これはまだ作成していない保管案です。承認時に暗号化バックアップ先も指定します。

### 承認後に使う手順（今回未実行）

1. source-cleanを確認し通常版`:app:assembleRelease`。aaptで通常package、非debug、
   HTTPSのみ、VM CA/診断componentなし、第三者notices、対応ABIを照合する。
2. 新しい鍵の作成が承認された場合だけ、keytoolで長期本番鍵を作成する。
   パスワードは対話入力し、引数/環境変数/Gitへ書かない。生成例は次の形。

```text
keytool -genkeypair -keystore <PRIVATE_KEYSTORE> -alias remote-lite-release -keyalg RSA -keysize 3072 -validity 10000
```

3. 入力APKを保持し、別ファイルへ署名する。zipalignが必要なら必ず署名前に実行。

```text
zipalign -c -P 16 4 <UNSIGNED_APK>
apksigner sign --ks <PRIVATE_KEYSTORE> --ks-key-alias remote-lite-release --out <NEW_SIGNED_APK> <UNSIGNED_APK>
apksigner verify --verbose --print-certs <NEW_SIGNED_APK>
zipalign -c -P 16 4 <NEW_SIGNED_APK>
```

4. 署名者指紋が本人が確認したものと一致し、署名が正常であることを確認。
   package/permissions/全ZIP payloadが承認したunsigned候補と対応するか照合する。
5. signed APKのSHA256、指紋、source、CI、版番号を私有release台帳へ記録。
   初回導入・同じ鍵での更新・登録ID維持・停止/削除を実機で確認する。
6. 公開先と配布対象の承認後に、私有鍵を含まない成果物だけを渡す。

### 40台への配布とAndroidの開発者確認

署名の費用と開発者登録制度は別です。現在の公式案内では無料のlimited distributionは
明示承認した最大20端末向けです。約40台の常用配布をこの枠で扱うとは約束できません。
full distributionの本人確認/地域/費用条件を申請時に照合します。複数アカウントや
ADB導入でこの条件を回避する計画にはしません。
[無料限定配布の条件](https://developer.android.com/developer-verification/guides/limited-distribution)、
[通常配布の本人確認](https://developer.android.com/developer-verification/guides/full-distribution)。

2026年9月の初期適用は指定4か国/参加ストアが対象で、直接APK配布への即時全面禁止では
ありません。2027年以降の世界展開が案内されています。日本の40端末が永続的に同じ導入手順で
使えるとの保証はしません。OSの保護を解除させる代替手順は製品導入案内に加えません。
[適用時期](https://developer.android.com/developer-verification)、
[直接配布に関するFAQ](https://developer.android.com/developer-verification/guides/faq)。

## Windows：無料署名は申請条件を先に確認

**所有者は2026-10-23に「現行のインストーラーを直接渡す（MSI形式）」を選択しました。**
今回の準備対象は現在のMSI/EXEです。Store/MSIX案は比較情報として残し、実装対象にしません。
方式の選択はOSSライセンス付与、申請/契約、署名権限、配布承認を兼ねません。
その後、所有者からRemote Lite自作部分のMIT化と著作権者表記`haji84`を個別に承認いただき、
[限定ライセンス](../../LICENSE-REMOTE-LITE.txt)と[適用範囲](LICENSE_SCOPE.md)を追加しました。
GORIQ本体と第三者の著作物はこの許諾の対象外です。署名者名義の決定とは別です。

|候補|無料部分|残る条件|
|---|---|---|
|Microsoft Store + MSIX|該当する開発者登録、Store配布のパッケージ署名/ホスティング|配布主体/アカウント種別確認、本人確認、契約、MSIX包装と互換性受入、Store審査、配布範囲承認|
|SignPath Foundation + 現在のMSI/EXE（選択した形式の無料候補）|条件を満たしたOSSへの署名支援|ライセンス/権利判断、資格審査、ビルド/署名権限、内部EXEとMSIのdeep signing受入|

StoreはMSIXパッケージを審査後に署名します。MSI/EXE提出やStore外のファイル配布まで
無償署名する仕組みではありません。既存ホストをMSIXへ包装する案なら新UIフレームワークは
前提としませんが、現在のMSI成功をMSIXの成功へ流用できません。
パッケージID、DPAPI/登録保存先、localhostブラウザ、画面/入力同意、更新/削除後のID保持、
既存MSIとの共存/移行を別に検証します。Storeでの受理や審査完了時刻は保証できません。

Individualは事業・職業と無関係な非商用個人の配布が対象です。事業・職業に関係する
個人や企業/団体はCompanyの要件を確認し、今回の配布主体をリポジトリ名から推測しません。
2026-05の公式告知ではCompany登録料も撤廃されていますが、実際の登録画面で無料対象と
本人/事業確認条件を照合し、費用が表示された場合は送信しません。

本人によるPartner Center登録/身元確認、表示する発行者名、契約と配布対象の承認後に
Store用package identityを確定します。本人確認書類をリポジトリやチャットで受け取りません。
Storeのアカウント登録、商品名予約、MSIX作成/送信は実行していません。
[個人登録とMSIX無料署名](https://blogs.windows.com/windowsdeveloper/2025/09/10/free-developer-registration-for-individual-developers-on-microsoft-store/)、
[Company無料登録の告知](https://blogs.windows.com/windowsdeveloper/2026/05/07/publish-to-microsoft-store-as-a-company-now-with-free-registration-and-faster-onboarding/)、
[MSIX署名の区別](https://learn.microsoft.com/en-us/windows/msix/package/signing-package-overview)、
[Store提出と審査](https://learn.microsoft.com/en-us/windows/apps/publish/get-started)。

既存MSI/EXEを維持する無料候補はSignPath FoundationのOSS支援です。OSI承認ライセンス、公開・保守される
プロジェクト、ソースからのビルド、レビュー/発行体の手続きなどが必要で、採用は保証されません。
Foundation名義の発行となる条件も確認します。現リポジトリ全体を許諾するLICENSEはなく、
Remote Lite限定のMIT許諾があっても混在リポジトリの申請資格が自動で確定するわけではありません。
[SignPathの条件](https://signpath.org/terms)。

次の**Remote Lite範囲だけ**の自作部分についてMITを承認済みです。
依存関係の個別条件と申請範囲は引き続き確認します。GORIQ本体のOSS化や別リポジトリ公開は行いません。

- `apps/remote-lite-windows/`、`android/remote-lite/`、`src/remote-lite/`
- 対応する`remote-lite-*` build/test scripts、tests、製品文書
- Go/WebRTC等の依存物の通知とライセンス。第三者の著作物へ別ライセンスを上書きしない

所有者指定の限定MIT通知をWindows/MSIとAndroid/APKへ同梱します。申請内容と必要な
GitHub App/署名権限は具体化してからHuman Gateを通します。申請送信、GitHub App導入は未実施です。
無料申請が不可なら、既存の信頼されたコード署名証明書の有無を確認し、費用のある取得は
別承認とします。自己署名をWindowsの信頼済み配布署名と表示せず、SmartScreenや
Application Controlを無効化する手順も追加しません。

### 既存MSIを使う署名工程の準備

SignPathのdeep signingは、MSI内のEXEを署名し、MSIを再梱包して外側にも署名します。
そのため現在のunsigned MSIを入力にできる候補があり、署名のためだけにビルダーを
EXE先行署名方式へ分割する必要はありません。サービスでの実行/採用は未検証です。
[公式MSI deep signing例](https://docs.signpath.io/artifact-configuration/examples)。

現ビルダーはソースの正確なコミットを新しい作業用ディレクトリへexportし、
`goversioninfo v1.5.0` / `rsrc v0.10.2`の固定版とgo.sumを使ってVERSIONINFOを生成します。
これは独立したbuild-only Go moduleで、Windowsホストの実行時依存は増やしません。
manifest、管理者権限、OS同意の設定は変えません。製品名は現在のMSIと同じ
`GORIQ Remote Lite Candidate`、文字列版番号はMSIと同じ`0.x.y`、数値は`0.x.y.0`。
CommentsにソースSHAを記録します。これは署名や真正性の証明ではありません。

ビルド後にWindowsのFileVersionInfo APIでEXEを読み、名前/文字列版/数値版/ソースSHAを
検査します。実MSIのProductVersionとHostExecutableのFile.Versionも検査します。
既存の全ICEと導入・修復・更新・削除のVM試験は引き続き必須です。
生成物はリポジトリへ書かず、以前のunsigned候補も書き換えません。

[署名設定案](../../deploy/remote-lite/signpath-msi.xml.example)はEXEとMSIを双方指定し、
名前/版番号を制約しています。内部パスはサービス側artifact表示で確認するまで
`__CONFIRM_EXACT_MSI_HOST_PATH__`のままです。WiX darkが展開するFile IDとサービス上の
パスが同じとは推測せず、確認後に完全一致のパスへ置換します。公式XSDに適合しても、
内部ファイル照合/署名成功や信頼された発行者を確認したことにはなりません。
MSIの版番号はこの設定のsubject/author制約だけでは検証できないため、CIの実MSI検査と
ビルド由来検証を署名承認の前提にします。

### 次のHuman Gateを分ける

1. **権利とライセンス（自作部分は承認済み）**：2026-10-23にMITと著作権者`haji84`を
   所有者が個別承認。第三者のGo、WebRTC、生成ツール等の元の条件は保持する。
   GORIQ本体や共通workflowを一括で再ライセンスしない。
   混在リポジトリでの申請範囲はSignPathの審査対象で、部分的なLICENSEだけで採用確定とはしない。
2. **申請/契約と公開範囲**：未リリースの候補であること、Remote Liteの手動画面/入力機能、
   対象ソース/バイナリ、必要な公開ページ、発行者名義を記載した申請内容を本人が確認する。
   既存リリースも資格条件のため、未承認の公開を先に行って資格を作らない。
3. **権限と署名承認者**：採用後、GitHub連携の具体的な権限、MFA、レビュー担当、署名を
   手動承認する本人を確定する。鍵/token/権限設定の承認は別途取得する。
4. **署名済み成果物の配布**：以下の受入と延期中の実機検証が完了してから判断する。

MIT化の承認を2〜4の承認へ流用しません。アカウント、署名鍵、GitHub権限の作成は未実施です。
build-onlyツールは[goversioninfoのMIT](https://github.com/josephspurrier/goversioninfo/blob/v1.5.0/LICENSE)と
[rsrcのMIT](https://github.com/akavel/rsrc/blob/v0.10.2/LICENSE.txt)。生成ツールの実行ファイルはMSIへ同梱しません。

### Windows署名後に必要な検証

1. 保護された正確なsource SHAをCIでビルドし、unsigned EXE/MSIとhash/検査記録を保持。
2. 承認済みのdeep signing設定で内部EXE→MSI再梱包→外側MSI署名/timestampを実行する。
   返されたMSIからEXEを読み取り専用で展開し、内部EXEも署名済みであることを検査する。
   MSI再梱包で変わった表/streamとEXEの署名差分を照合し、別payloadへの置換がないことを確認する。
3. SignToolの`verify /pa /all /v`等でEXE/MSIのchain・発行者・timestampを確認し、
   承認した証明書指紋、ソース、署名前/署名後hashを照合。
4. 署名済みMSIそのものに全ICE/metadata、導入・修復・更新・削除・登録ID保持の受入を実施。
   unsigned MSIの既存成功をsigned artifactの成功へ置き換えない。
5. 友達と同条件のWindowsでOS保護を有効なまま初回起動。警告がないことを保証するために
   署名やhashだけを根拠にしない。本人が後日に指定した実機試験へ引き継ぐ。

## 最後の配布判定

Windows/Androidとも、署名済み成果物、ソースSHA、hash、署名者指紋、依存物通知、
日本語の初期設定・更新・復旧手順、常用HTTPS接続先、実機受入証拠を一組にする。
所有者鍵/端末鍵/TURN秘密/keystore/PFXは同梱しない。公開リポジトリへのActions artifactや
Releaseアップロードは外部公開となるため、私有候補の保存から自動昇格しない。

未配布の候補は保持して新しい出力先で作り直す。配布後はAndroidの同じ署名鍵と
versionCode、WindowsのProductCode/版番号規則を守る。誤署名時に既存データ/鍵を
消して再導入させず、署名済みの上位版として承認した修復版を用意する。
