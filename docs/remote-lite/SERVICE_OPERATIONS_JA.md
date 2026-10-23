# 常用HTTPS/TURNの準備と運用案

Issue1831 / PR1832。2026-10-23確認。**準備資料であり、未構築・未公開です。**
この資料のLinux配置例は、既存Node所有者サーバーとcoturnを運用する準備案です。
専用の別PCは必須にしません。本人が稼働するGORIQの友達向け機能として提供します。
実機・別回線受入は本人指示で後日。既存試験URLの公開承認は期限切れです。

## 最新の本人指定と確認結果

2026-10-23、本人から「独立させずにGORIQの1部機能を友達が使えるようにするだけ」
との修正を受領しました。独立PCの調達・構築を必須の次工程とする前提を取り下げます。
続く本人回答「あなたのGORIQを友達専用アカウントで使う」で提供形態が確定しました。
友達へ渡すものは、友達用URL・本人だけのログイン情報・操作対象に入れるAPK/Windowsホストです。
下記の独立ホスティング案は比較・準備履歴であり、採用済みではありません。

調査した既存実装では、`src/app/api/jarvis/remote/route.ts`は`requireJarvisOwner`を
要求し、管理用Broker/Remote Gateway、teaching操作にもつながっています。
友達にこのオーナー認証を渡したり、画面のメニューを隠すだけで共有する構成にはしません。
一方、`src/remote-lite/owner-portal.mjs`は利用者別の端末・接続・失効を扱い、
実HTTPSの別利用者拒否テストがあります。この手動操作部分と既存APK/Windowsホストを
再利用します。GORIQ起動処理への任意組込みを今回実装します。常用接続先の公開は未実施です。

同じPCで稼働することと、管理権限・秘密情報を共有することは別です。
友達は自分の端末の手動操作だけを使います。現行GORIQの認証/Broker権限を変更せず、
稼働サービスの再起動や本番設定、実アカウント発行、OS権限変更は行っていません。

## GORIQで友達用機能を起動する準備

`scripts/jarvis-remote-host.mjs`は`GORIQ_FRIEND_REMOTE_CONFIG`がある場合だけ、
既存HTTPSサーバーを監督対象の子プロセスとして起動します。未設定なら従来の起動です。
値は私有wrapper JSONの絶対パスです。例は`deploy/remote-lite/goriq-friend.json.example`。
これは運用者の設定であり、友達にNodeやJSONの操作を依頼するものではありません。

- wrapperは`version:1`、`ownerOrigins`、`portalConfig`だけです。`ownerOrigins`には
  実際に管理画面で使うHTTPS originを別名も含めてすべて列挙します。
- `portalConfig`は既存portal設定の絶対パス。証明書・登録台帳・友達ごとのownerId/keyHash・
  承認済みTURN設定を再利用します。管理者のログイン鍵をコピーしません。
- **友達用のホスト名は、管理画面のどのホスト名とも別にします。** 同じPCで運用できますが、
  同じホスト名の別ポートではブラウザの認証Cookieを分離できません。実ホスト名一覧の確認は
  公開前に必要です。友達入口から管理画面/Brokerへ転送する経路は追加しません。
- 子プロセスはOS動作用の環境変数だけを受け取り、GORIQ管理用/AI用の秘密情報や
  `NODE_OPTIONS`、TLS検証無効設定を継承しません。同じOSユーザーによる実行なので、
  ファイルシステムの権限分離が完成したという意味ではありません。
- 友達機能は短時間の連続失敗3回で停止し、GORIQ本体を終了させません。安定稼働後は
  既存managerの失敗数リセットに従います。設定/台帳の異常は
  その機能の起動失敗として残します。起動時に台帳を初期化したりlockを消したりしません。
- 終了は親子間IPCでHTTPS・接続・台帳を閉じます。親が消えた場合も停止します。
  1.25秒で終了しない場合はその子だけに強制停止を要求します。強制終了でlockが残った場合は
  生存プロセスとデータを確認して復旧します。停止要求を停止成功とは扱いません。

実設定の作成・環境変数の設定・サービス再起動は未実施です。実際の管理用ホスト名、
友達用ホスト名とHTTPS経路、承認済み鍵/台帳の保存先、TURNの到達性・帯域制限が揃ってから
個別承認の範囲内で有効にします。Linux向け転送量ガードはこのWindows監督処理に未接続であり、
同一PCへの組込みだけでTURNの費用/帯域保護まで済んだとは判定しません。

## 費用と選択

**Oracle以外の構成を希望する指定も保持します。** Oracleのログイン依頼は終了しています。
以下は直前まで検討した既存機器案で、最新指定を受けて採用判断を保留しています。
本人から「独立したPC・小型PCを使える」と回答済みです。OS・容量・設置先回線・
設定可能な時期は未確認であり、機器利用の回答だけでOS変更・公開・ポート転送を実行しません。

|構成|今回の判断|条件|
|---|---|---|
|既存の独立Linuxサーバー/専用VM + DuckDNS + Let's Encrypt + coturn|以前の候補・現在は保留|利用可能な独立PCの回答はあるが必須としない。電気・回線・グローバルIP・運用費は無料とは限らない|
|Tailscale Personal + 独立した常時稼働サーバー|非商用の場合の代替候補・未採用|本人が以前認めたTailscale導入を使える場合。私設ネットワークでもサーバーは別途必要。公開HTTPS/TURNを同条件で置換できたとは扱わない|
|Cloudflare Realtime TURN|自動採用しない|1,000GBを超えると従量課金。無料上限で必ず止まる契約を確認できていない|
|Oracle Always Free|現在は選択しない|本人がOracle以外を希望。下記の以前の調査は履歴として保持|

### 下記のLinux配置案を選ぶ場合に確定すること

- 利用可能と回答された独立PC/小型PCのOS・容量・常時起動条件・設定可能な時期。
  GORIQ本体にサービス/鍵/権限を追加せず、既存の試験サーバーをそのまま公開しません。
- 回線のグローバルIPv4とルーターのポート転送可否。CGNAT/二重NAT/管理権限なしを
  「DuckDNSを使えば解消する」と判断しません。公開先不明のままポートを開けません。
- coturnの外部IPv4とNAT対応、実際に使うUDP/TLSポートを別回線で検証。
  動的IPが変わった場合はDuckDNS更新に加えてcoturn設定と到達性の再検査が必要です。
- 既存機器で追加のサーバー契約を避けられても、電気/回線費や帯域上限は別です。
  8TBの例を自宅回線の許可された上限と見なさず、実契約の条件に合わせます。

Androidの画面取得/入力は専用APKが行います。このサーバー案ではAndroidをWindows/ADBで
操作する方式へ戻しません。所有者認証・登録・接続調整と必要時のTURNの常時稼働先を置きます。
専用機がない場合は機器購入/有料VPSを勝手に選ばず、費用条件と方式の選択を本人へ戻します。

Tailscale Personalの現行表示は非商用の個人利用向け、6ユーザー、ユーザー端末数無制限、
tagged resourceは50台を含む構成です。業務利用や追加resourceの課金条件を混同しません。
導入する場合でも、全操作元/対象端末のVPN設定、所有者隔離、SafariのHTTPSとWebRTC、
relay時の性能、40台同時動作を検証するまでは完成とはしません。正式な公開構成を削除する
承認としては扱いません。[Tailscale料金と適用条件](https://tailscale.com/pricing)。

### 以前のOracle候補の確認記録（現在は未採用）

Oracleの30日間の試用とAlways Freeは別です。公式には無料専用アカウントを
有料へ変更しない限りカード請求はなく、Always Freeは期限なしとされています。
ホームリージョン、実際のAlways Free表示、ボリューム/転送量の使用状況を確認します。
容量不足を理由に有料へ変更しません。アイドルVM回収に備え登録情報を退避します。
現在のA1無料枠表記は2OCPU/12GB相当です。古い4OCPU/24GBの例を転用しません。
[Oracle Free Tier](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier.htm)、
[Always Free資源](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm)。

### 無料DNSとTLSの役割

DuckDNSは無料の名前解決、Let's Encryptは無料のTLS証明書です。サーバーや
TURN中継を提供するものではありません。永続性/SLAを保証する契約とは扱いません。
Let's Encrypt証明書はアプリのコード署名には使えません。
[DuckDNS](https://www.duckdns.org/)、[Let's Encrypt](https://letsencrypt.org/docs/faq/)、
[CloudflareのTURN料金](https://developers.cloudflare.com/realtime/turn/faq/)。

## 承認前に揃える具体情報

- GORIQ稼働機のOS・回線・常時稼働条件、管理画面の全ホスト名と友達用ホスト名。
  別機器は必須にしません。VMを使う場合のみその識別子と設置先を確定します。
- HTTPS/TURNを置く対象環境、Node24/coturn 4.18.0の実バージョンと入手元、公開IPv4と内部IPv4。
- 所有する無料DNS名。例: app用とrelay用の2つ。実名を確認するまで設定しない。
- OSユーザー/証明書読み取り権限、80/443/TCP、3478/UDP、5349/TCP、
  49160–49359/UDPの公開範囲。SSHは管理者の指定経路に限定する。
- 所有者ごとに異なるログイン鍵、TURN共通秘密、ACME/DNS資格情報の保管先とバックアップ。
- 追加契約費の条件と電気/回線費の扱い、通信量の監視と遮断方法、公開開始/停止・証明書更新・障害復旧の担当。

これらはAGENTS.md/正式引継ぎのHuman Gate対象です。既存のGORIQ、USB試験、
鍵、ポート、OS設定を流用しません。APIキー/秘密鍵をチャットやIssueに貼りません。

## 配置用の具体例

`deploy/remote-lite/`に`portal.json.example`、portal/TURN/転送量ガードのsystemd unit、
`traffic-budget.json.example`、coturn設定例があります。
**例のまま起動できる完成設定ではなく、秘密情報も含みません。**
アプリ名、IP、証明書SAN、ユーザー、実パスと権限を確定してから私有設定へ展開します。
設定の検査だけでは、OS unit/coturnの実起動や公開通信を検証したことにはなりません。
coturn例の対象は上流4.18.0です。4.18で削除された`no-cli`/`no-dtls`を含めず、
古いOS同梱版へそのまま転用しません。対象バイナリのhash/版、設定ロード、認証、
内部IPv4・IPv6・IPv4 mapped IPv6宛先拒否を実検査するまで公開しません。
4.16未満のIPv6 ACL修正欠落を採用せず、配布元のバックポートを推測で同等扱いしません。
[4.18.0更新点](https://github.com/coturn/coturn/releases/tag/4.18.0)、
[IPv6 ACLの修正](https://github.com/coturn/coturn/security/advisories/GHSA-4v97-rxjj-4f99)。

|私有パス|内容/権限|
|---|---|
|`/opt/goriq-remote-lite/<source-sha>`|レビュー済みソース。アプリから書込不可|
|`/etc/goriq-remote-lite/portal.json`|所有者ID・鍵のhash・接続先。アプリの専用ユーザーだけが読む|
|`/etc/goriq-remote-lite/private/turn-shared-secret`|独立したTURN秘密。Node/coturnに必要な読取だけ付与|
|`/etc/goriq-remote-lite/tls/<certificate-version>/`|fullchain/privkey。rootが管理し必要ユーザーだけ読取|
|`/var/lib/goriq-remote-lite`|登録台帳とlock。専用ユーザーのみ書込、他アプリと共用しない|
|`/etc/goriq-remote-lite/traffic-budget.json`|期間・上限・既使用量。独立した監視ユーザーの所有、0600|
|`/var/lib/goriq-remote-lite-traffic/<period-id>`|送信量台帳とlock。監視専用ユーザーだけが書込、0700|

Nodeは直接HTTPS443を扱う例です。HTTPや検証無効のバックエンドへ変更しません。
systemd unitの低位port capability付与も実行時の個別承認に含めます。
最初だけ専用ユーザーで`--initialize`を実行し、その後の起動では付けません。
異常終了後にlockが残る設計のため、unitの再試行は上限付きです。確認せずlockを
消すスクリプトはありません。自動的な障害復旧が完成したとは扱いません。

## 証明書更新

公開CAの発行、DuckDNS登録/更新、certbot導入/実行は未実施です。HTTP-01を使う
場合は承認済みVMの80/TCPで行い、443のNodeとは分けます。CAへのドメイン公開と
証明書透明性ログへの掲載も承認対象です。発行後は両ホスト名のSANを照合します。

1. 更新した証明書/鍵を新しい私有versionディレクトリへ配置し、権限を確認。
2. cert/keyの対応・SAN・有効期間・chainを確認して`tls/current`を切り替える。
3. Linuxではportalの**所有プロセスだけ**へSIGHUP、または確定したunitへreload。
4. `TLS_RELOAD_OK`と、新規の通常TLS接続が期待する証明書を返すことを確認する。
   `systemctl reload`の終了コードだけでは更新成功にしない。
5. `TLS_RELOAD_FAILED`では旧contextを保持する。旧証明書の期限までに修復する。
   key/PEM/パス/詳細例外はログへ出さない。設定したTLS名の変更は計画停止・再起動が必要。

実装は証明書の対、公開originのhostnameとSAN、有効期間、サイズを確認してTLS contextだけを入れ替えます。
SANの順序変更は許容し、設定したTLS名がない証明書は拒否します。loopback上の
承認済みHTTPS proxyだけは、既存経路のため明示`tlsServerName`を使えます。
常用例の公開listenerでは別名を指定できず、ブラウザ/接続元の通常TLS検証も必要です。
登録台帳、所有者ログイン、既存TLS接続を再作成しません。リモート管理APIは追加していません。
実TLS試験で新規接続の証明書切替と既存socket/login維持を検査します。
[Node setSecureContext](https://nodejs.org/docs/latest-v24.x/api/tls.html#serversetsecurecontextoptions)。

coturnのTLS更新は別工程です。この変更でcoturnの無停止更新を保証しません。
確定した版の手順に従い、必要なら利用者へ案内した保守時間にportal/coturnを正常停止し、
更新・再開します。進行中セッションが終了するためAndroidではOS再同意が必要です。

## TURNの制限と通信量

テンプレートは短命HMAC認証、TLS、allocation/帯域制限、CLI/TCP relay無効、
内部/loopback/metadata/IPv6 peer拒否を含むIPv4の初期検証案です。TCP/TLSの
クライアント接続とTCP relayは別です。TLS5349を塞ぐ網のTURN443は未受入です。
同じVMのrelay同士が接続することがあるため、公開relay IPの全拒否を追加すると
正常なrelay/relayも壊れます。稼働VMは他用途と共用せず、不要なUDPサービスを置きません。
[coturn設定の正本](https://github.com/coturn/coturn/blob/master/examples/etc/turnserver.conf)。

`bps-capacity=2000000`は片方向の合計bytes/秒、`max-bps=250000`はallocationごとの
制限です。31日間で中継方向あたり約5.36TBという目安であり、課金メーターの上限では
ありません。プロトコル/他通信の余裕を残し、実際の無料転送枠と両方向の計測を確認します。
coturn quotaのuserは一時usernameで、製品の所有者別40台制限とは同じではありません。
40台がそれぞれ1Mbpsを連続送信するだけで約13.4TB/月の目安になり、無料で40台を
常に滑らかに操作できる証拠はありません。Direct優先・relay時の容量実測が必要です。

### 永続送信量ガード

`scripts/remote-lite-traffic-guard.mjs`はLinuxの非loopback全インターフェースの
`tx_bytes`を5秒ごとに読み、64bit整数を丸めず専用台帳へ同期保存します。初期値は
**確認済み既使用量 + 現在の起動からの全カウンター**です。重複計上は許容し、
仮想NICも省略しません。NIC重複で実際より早く停止する場合があります。
8TBは設定例の停止目安で、課金メーターやプロバイダー側の上限ではありません。

- 上限以上、期間終了、再起動、NIC増減、カウンター巻き戻り、15秒超の計測空白、
  時計逆行、台帳欠損/破損、書込失敗で起動を拒否または異常停止します。
- 保存後だけsystemdへREADY/WATCHDOGを通知します。監視が固まっても15秒のwatchdogで終了。
  portalとTURNは`BindsTo`と`After`で連動停止し、停止猶予は5秒です。
  非同期の検出・停止までに送信される分は残るため、無料枠から十分な余裕を取ります。
- ガードは独立したOSユーザーで動かします。portal/TURNが監視台帳を書き換えたり、
  監視への通知を代行できる同一ユーザー構成にはしません。unitの権限追加は未実行です。
- 異常時のlock、使用量、旧期間を自動削除しません。設定上限変更で残量を復活させません。
  正常停止でも15秒を超えて停止した場合は欠測として再起動を拒否します。

実配置時は、対象機器/VMと回線の契約（クラウドなら無料専用アカウント）、期間と既使用量の根拠、
停止余裕を確認してから私有JSONを作成します。`openingBytes:null`の例は起動できません。
過去の使用量が不明なときに0を入れません。空の専用期間ディレクトリに一度だけ
`node scripts/remote-lite-traffic-guard.mjs <private-config> --initialize`を実行し、
直ちに（15秒以内）確定したguard unitを起動し、その後にportal/TURNを起動します。
OSの配布元coturn unitを並行して有効にすると連動停止の対象外になるため使用しません。

期間更新・VM再起動・欠測復旧では、まずportal/TURNを停止し、前の使用量と
プロバイダー側の使用量を照合します。前台帳を保持し、今回の期間について保守的な既使用量を
引き継いだ**新しい専用ディレクトリ**を手動で初期化します。同じ期間の復旧では前のlimitと
期間を保持し、上限到達した期間を再開しません。異常lockを自動で消す手順はありません。

ローカルの境界・永続化・通知順序検査に加え、CIの隔離Linux VMで実カウンター、
systemd READY、期間終了、監視プロセス停止時のwatchdog、依存unit停止、再起動拒否を
検査します。依存unitは無通信の代役です。実際の公開portal/coturnと課金計測の受入は別に必要です。
全VMの他サービスやクラウドアカウント内の別資源は、このサービス停止だけでは止まりません。
クラウドを使う場合の0円条件は、無料専用アカウントで有料利用ができないことを確認して担保します。
[systemdの依存関係](https://www.freedesktop.org/software/systemd/man/latest/systemd.unit.html)、
[systemdのwatchdog](https://www.freedesktop.org/software/systemd/man/latest/systemd.service.html)。

TURN資格情報は最長10分。現実装は更新せず期限で停止し、新セッションが必要です。
logout/revoke後も既発行TURN資格情報の即時失効は保証しません。製品側映像/入力は停止します。
長時間連続操作、期間更新、公開relay受入は残工程です。

## 開始前・停止・復旧

公開開始前に、期限なしの公開範囲を具体承認、提供方式の費用条件の実証、TLS trust、未認証拒否、
所有者隔離、TURN不正資格情報と内部peer拒否、direct/relay映像・入力・停止、証明書更新、
通信量遮断、登録台帳backup/restoreを検査します。後日の実機結果を推測で補いません。

停止はこの環境の専用portal/coturnだけ。NodeをSIGTERMで正常終了してlockが解放されたか
確認します。異常終了時はPID/start time/実行パスを確認し、台帳/lockを保全して復旧します。
失敗した起動のために空台帳を再初期化しません。ソース/設定/証明書の直前版を保持し、
restore後に所有者隔離・既存ID・停止を再検査します。現ターンに外部状態の変更はありません。
