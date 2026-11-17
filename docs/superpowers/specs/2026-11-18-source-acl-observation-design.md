# 元データ取得時のACL拒否対象を読取専用で特定する

Goal goal-fcc81c97e09153f7 / Job rotation-recovery-37 / Issue1219。
PR1929でPROFILE誤拒否を解消し、PR1930/main eb01e11はsource/main全4CI・署名6項目を通過した。
実機44178348410はSOURCE_PRIVATE_DACL_UNVERIFIED / preserved=falseを返した。
元データか専用コピー先か、どの対象とACEかは未証明である。

既存owner-only jobで従来のOWNER_PROBE_V1に続け、SOURCE_ACL_PROBE_V1を1行返す。
owner reader/validatorとCaptureの全policyを維持する。新しいworkflow入力、権限、取得、
作成、ACL/owner変更、runtime/credential操作、原本contents readは追加しない。

## Native契約

goriq-private-owner-probe.cs末尾にpublic static class GoriqSourceAclProbeを追加し、
ObserveJson()で固定metadataを観測する。legacy class/enum/reducerは変更しない。
READ_CONTROL|READ_ATTRIBUTESだけ、OPEN_EXISTING/OPEN_REPARSE/SHARE_ALLを使う。
非SYSTEM current-user identity、既知folder/env一致、workspace分離、canonical local NTFS、
全祖先のnonreparse/directory、実handle属性/finalpath、file単一linkを確認する。
安全な祖先を確認できない子はANCESTOR_UNVERIFIEDとして開かない。DACLは修復しない。
descriptor64KiB/targets48/aces16/20s/output131072bytesを上限にする。
生SID/個人名/パス/例外/原本内容を出さず、maskはuint32、flagsはbyte。

固定plan順: VOLUME_ROOT, PROFILE_ANCESTOR_01..07(任意連続), PROFILE,
SOURCE_ANCESTOR_01..07(任意連続), APPDATA(localの親), LOCAL, WORKER, SOURCE,
DB,WAL,SHM,JOURNAL,SIDECAR,JOBS,CHANGES,HANDOFF,CAPTURE,RAW,WORK,CONTEXT,
RAW_DB,RAW_WAL,RAW_SHM,RAW_JOBS,RAW_CHANGES,WORK_DB,WORK_WAL,WORK_SHM,WORK_JOBS,WORK_CHANGES。
source=KnownFolder.LocalApplicationData/GAIWorker/goal-1218-bridge-state。
CAPTURE=profile/.goriq-handoff/1219-original-inspection-44178348410-1。
APPDATA=PROFILEの場合も別targetとして記録する。localの親がprofile外なら拒否する。

JSON exact header keys: schema='SOURCE_ACL_PROBE_V1', authority='NOT_AUTHORITATIVE',
status='METADATA_ONLY_COMPLETE'|'INCOMPLETE', readOnly=true,metadataOnly=true,recovered=false,
g1='HOLD',historicalStateProven=false,maxTargets=48,maxAces=16,budgetSeconds=20,reason,observations(array)。
reasonはOBSERVEDまたは既存supervisor固定bootstrap理由・UNSUPPORTED_PLATFORM・IDENTITY_UNVERIFIED・
UNSAFE_PROFILE・TARGET_LIMIT・TIMEOUT・UNEXPECTED_FAILURE・OUTPUT_REJECTEDのみ。
各row exact keys: target,status,storageVerified,attributesVerified,finalPathVerified,owner,dacl,aces。
row status: ACL_OBSERVED,TARGET_MISSING,ACCESS_DENIED,ANCESTOR_UNVERIFIED,STORAGE_UNVERIFIED,
ATTRIBUTES_UNVERIFIED,FINAL_PATH_UNVERIFIED,SECURITY_DESCRIPTOR_UNVERIFIED,ACE_LIMIT,TIMEOUT,UNEXPECTED_FAILURE。
owner: UNOBSERVED,CURRENT_USER,SYSTEM,ADMINISTRATORS,TRUSTED_INSTALLER,OTHER。
dacl: UNOBSERVED,PRESENT,NULL,ABSENT。
null ownerはSECURITY_DESCRIPTOR_UNVERIFIED、owner/daclUNOBSERVED・aces[]とする。
NULL/ABSENT DACLはowner観測済みでACL_OBSERVED・aces[]として記録でき、policy適正の主張ではない。
ACE_LIMITはowner/PRESENTと最初16ACEを保持する明示的partial観測である。
各ACE exact keys: account,qualifier,mask,flags。
account: CURRENT_USER,SYSTEM,ADMINISTRATORS,TRUSTED_INSTALLER,APP_SILO,APP_CAPABILITY,APP_PACKAGE,
EVERYONE,AUTHENTICATED_USERS,USERS,OTHER。
qualifier: ALLOW,DENY,CALLBACK_ALLOW,CALLBACK_DENY,OTHER。
opaque/未知ACEのOTHER qualifierではmask0は不明値のplaceholderであり、権限なしという観測ではない。
metadata completeは観測計画終了であり、権限正常・Goal達成を意味しない。

## PS/Workflow契約

ConvertTo-SourceAclProbeClosedJson、New-SourceAclProbeFailure、Invoke-SourceAclProbeObservationを追加する。
既存Invoke-OwnerProbeObservationに任意switch SourceAclを追加し、指定時だけentryを
GoriqSourceAclProbe.ObserveJsonへ切替え、Source validatorで再構成する。legacy既定動作は不変。
bootstrapのlegacy failure envelopeは、観測0件の固定failureだけSource failureへ安全に変換する。
legacy factsをSource factsとして扱わない。child25s/stdio/cleanenv/signature/compilerworkspace/
module/sourceUTF8・BOM処理を維持し、Source出力上限のみ131072bytes、legacy16384bytesは維持する。
Source validatorはexact keys/types/enums/連続plan順/no duplicates/数値・件数・bytes境界を確認する。
Source wireはliteral ASCII文字列（escapeなし）・標準JSON空白とcontainer grammarに限定し、
top-level object、depth5/token16384/byte131072を検証してからJSON cmdletへ渡す。
comments/trailing commas/array root/Unicode ignorable文字・escapeは拒否し、reason生成はordinalで正規化する。
Source childのstdout境界とwrapperの両方で、同じ安全なSource/空legacy bootstrap resolverを使う。
legacy互換経路のraw property数も固定し、duplicate keyをSourceへ持ち込まない。
Workflowは両closed結果を検証後、GORIQ_ZBOOK_OWNER_OBSERVATIONと
GORIQ_ZBOOK_SOURCE_ACL_OBSERVATIONの2行だけ出し、生child streamは出さない。

## 検証・責任

Native plan/分類/uint/flags/serializerの実C#5試験、Windows synthetic descriptor/実PInvoke境界、
PS exactkeys/types/roles/数値/limits/偽schema拒否とlegacy回帰を実行する。
既存profile compileを再利用する。並列担当はNative readerとPS envelopeの別ファイルに限定し、
rootがworkflow/fixtures/pins/統合/reviewを担当する。重いfull実行を並列に重複させない。
owner workflow28caseは7件ずつ4owned process（各10s）へ分割し、合計batch予算は30→40sとする。
全case/assertionとCI全体の300s上限は維持する。profile case17s内ではNative pure試験を実行し、
PS envelope pure試験とSource supervisorの実Windows inert childは既存owner suite55s内で検証する。
全4source/mainCIと署名6項目後、新しいowner-only metadataを一度だけ実行する。
実対象・ACEの証拠で修正を選び、推測による権限変更・policy弱体化を行わない。
MEDIUMの読取専用diagnostic。Goal NOT_ACHIEVED / G1 HOLDを維持する。
rollbackはobserver/supervisor/依存pins/closed envelopeの保護付き同時revert。data/OS復元操作はない。
