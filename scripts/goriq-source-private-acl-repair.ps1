# Definition-only import. Activation is the explicit, approved fixed workflow.
function Get-GoriqSourceRepairNativeContext {
 if([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT -or $PSVersionTable.PSVersion.Major -ne 5 -or $ExecutionContext.SessionState.LanguageMode -cne 'FullLanguage'){return $false}
 $fixed=[IO.Path]::Combine([Environment]::GetFolderPath('System'),'WindowsPowerShell','v1.0','powershell.exe')
 if([Diagnostics.Process]::GetCurrentProcess().MainModule.FileName -ine $fixed){return $false}
 $signature=Microsoft.PowerShell.Security\Get-AuthenticodeSignature -LiteralPath $fixed -ErrorAction Stop
 if($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch '(?:^|, )O=Microsoft Corporation(?:,|$)'){return $false}
 $processes=@(Get-CimInstance Win32_Process -Filter "Name='Runner.Listener.exe'" -OperationTimeoutSec 5)
 if($processes.Count -ne 1){return $false}
 $owner=Invoke-CimMethod -InputObject $processes[0] -MethodName GetOwnerSid -OperationTimeoutSec 5
 return ($owner.ReturnValue -eq 0 -and $owner.Sid -ceq [Security.Principal.WindowsIdentity]::GetCurrent().User.Value)
}
function New-GoriqSourceRepairRefusal([string]$Reason) {
 [ordered]@{status='REFUSED';reason=$Reason;plannedObjects=0;changedObjects=0;restoredObjects=0;scopeSha256='830e91deef9611ecd0804dfeacd189bb300120ab8fa2effd0bb72bb9b3766c2f';planSha256='';implementationSha256='';backupId='';consistency='LIVE_SAMPLED';manualRecovery=$false;globalRestoreComplete=$false;originalDataPreservationVerified=$false}|ConvertTo-Json -Compress
}
function ConvertTo-GoriqSourceRepairClosedJson([string]$Text,[bool]$Apply,[string]$ExpectedImplementationSha256) {
 if($Text.Length -gt 4096){throw 'RESULT_UNVERIFIED'}
 # The source-owned serializer has one canonical ASCII shape. Validate grammar,
 # duplicate-free exact keys, integer ranges and enum spelling before decoding.
 $number='(?:[0-9]|1[0-6])';$hash='[a-f0-9]{64}';$optionalHash='(?:'+$hash+')?'
 $pattern='\A\{"status":"(?:PLANNED|APPLIED|ROLLED_BACK|INCOMPLETE|REFUSED)","reason":"[A-Z_]{1,64}","plannedObjects":'+$number+',"changedObjects":'+$number+',"restoredObjects":'+$number+',"scopeSha256":"'+$hash+'","planSha256":"'+$optionalHash+'","implementationSha256":"'+$optionalHash+'","backupId":"(?:1219-source-acl-[1-9][0-9]{0,19}-[1-9][0-9]{0,19})?","consistency":"LIVE_SAMPLED","manualRecovery":(?:true|false),"globalRestoreComplete":(?:true|false),"originalDataPreservationVerified":false\}\z'
 if(-not [regex]::IsMatch($Text,$pattern,[Text.RegularExpressions.RegexOptions]::CultureInvariant)){throw 'RESULT_UNVERIFIED'}
 $r=Microsoft.PowerShell.Utility\ConvertFrom-Json -InputObject $Text -ErrorAction Stop
 $allowed=@('METADATA_ONLY','VERIFIED_SAMPLE','UNEXPECTED','SCOPE_EXPIRED','APPROVAL_EXPIRED','APPROVAL_NOT_YET_VALID','ACE_SHAPE','ACL_BOUND','ANCESTOR_DRIFT','ANCESTOR_GRANT','ANCESTOR_OWNER','ANCESTOR_READER','BACKUP_BOUND','BACKUP_READBACK','BASELINE_BOUND','CANONICAL_PATH','CURRENT_IDENTITY','DATABASE_REQUIRED','DESCRIPTOR_BOUND','DESCRIPTOR_DRIFT','DESCRIPTOR_FLAGS','DESCRIPTOR_SHAPE','DPAPI_BACKUP','DPAPI_READBACK','ENVIRONMENT_CONTEXT','FINAL_PATH','IDENTITY_DRIFT','IMPLEMENTATION_BINDING','INVENTORY_DRIFT','JOURNAL_BOUND','JOURNAL_UNAVAILABLE','JOURNAL_READBACK','JOURNAL_STATE','FINALIZATION_FAILED','KNOWN_FOLDER_CHAIN','LOCAL_NTFS','OBJECT_BOUND','OBJECT_METADATA','OTHER_GRANT','POSTVERIFY_DRIFT','PREFLIGHT_REQUIRED','PREFLIGHT_TIMEOUT','PRIVATE_ACL','PRIVATE_CREATE','PRIVATE_FILE_CREATE','PRIVATE_FULL_CONTROL','PRIVATE_LAYOUT','PRIVATE_LAYOUT_DRIFT','PRIVATE_OWNER','READER_AMBIGUOUS','READER_GRANT','READ_SECURITY','ROLLBACK_DRIFT','ROLLBACK_POSTVERIFY','RUNNER_CONTEXT','RUN_CONTEXT','SCOPE_CONSUMED','SCOPE_MISMATCH','SET_FAILED','SOURCE_OWNER','SOURCE_PRIVATE_ACL_REFUSED','TRUSTED_GRANTS','UNATTRIBUTED_STATE','UNKNOWN_SOURCE_OBJECT','WINDOWS_REQUIRED','WRITE_SCOPE','NATIVE_CONTEXT_UNVERIFIED','SOURCE_BYTES_UNVERIFIED','NATIVE_BUILD_UNAVAILABLE')
 if($r.reason -cnotin $allowed -or $r.scopeSha256 -cne '830e91deef9611ecd0804dfeacd189bb300120ab8fa2effd0bb72bb9b3766c2f' -or $r.changedObjects -gt $r.plannedObjects -or $r.restoredObjects -gt $r.changedObjects){throw 'RESULT_UNVERIFIED'}
 if($r.status -ceq 'REFUSED'){
  if($r.reason -cin @('METADATA_ONLY','VERIFIED_SAMPLE')){throw 'RESULT_UNVERIFIED'}
  if($r.changedObjects -ne 0 -or $r.restoredObjects -ne 0 -or $r.manualRecovery -or $r.globalRestoreComplete){throw 'RESULT_UNVERIFIED'}
 }else{
  if($r.plannedObjects -lt 1 -or $r.planSha256.Length -ne 64 -or $ExpectedImplementationSha256 -cnotmatch '\A[a-f0-9]{64}\z' -or $r.implementationSha256 -cne $ExpectedImplementationSha256){throw 'RESULT_UNVERIFIED'}
 }
 if($r.status -ceq 'PLANNED' -and ($Apply -or $r.reason -cne 'METADATA_ONLY' -or $r.changedObjects -ne 0 -or $r.restoredObjects -ne 0 -or $r.backupId.Length -ne 0 -or $r.manualRecovery -or $r.globalRestoreComplete)){throw 'RESULT_UNVERIFIED'}
 if($r.status -ceq 'APPLIED' -and (-not $Apply -or $r.reason -cne 'VERIFIED_SAMPLE' -or $r.changedObjects -lt 1 -or $r.restoredObjects -ne 0 -or $r.backupId.Length -eq 0 -or $r.manualRecovery -or $r.globalRestoreComplete)){throw 'RESULT_UNVERIFIED'}
 if($r.status -ceq 'ROLLED_BACK' -and (-not $Apply -or $r.changedObjects -lt 1 -or $r.restoredObjects -ne $r.changedObjects -or $r.manualRecovery -or -not $r.globalRestoreComplete -or $r.backupId.Length -eq 0)){throw 'RESULT_UNVERIFIED'}
 if($r.status -ceq 'INCOMPLETE' -and (-not $r.manualRecovery -or $r.globalRestoreComplete)){throw 'RESULT_UNVERIFIED'}
 if(-not $Apply -and $r.status -cin @('APPLIED','ROLLED_BACK','INCOMPLETE')){throw 'RESULT_UNVERIFIED'}
 # Return the validated canonical source-owned representation, not a raw child stream.
 return $Text
}
function Initialize-GoriqSourceRepairNative([string]$Source) {
 $null=Microsoft.PowerShell.Utility\Add-Type -TypeDefinition $Source -Language CSharp -ErrorAction Stop -WarningAction Stop
}
function Invoke-GoriqSourceRepairNative([bool]$Apply) {
 [GoriqSourcePrivateAclRepair]::Execute($Apply,$env:GITHUB_RUN_ID,$env:GITHUB_RUN_ATTEMPT,'830e91deef9611ecd0804dfeacd189bb300120ab8fa2effd0bb72bb9b3766c2f')
}
function Invoke-GoriqSourcePrivateAclRepair([string]$CaptureSource,[string]$RepairSource,[bool]$Apply=$false) {
 $failure='NATIVE_CONTEXT_UNVERIFIED';$started=$false
 try {
  if(-not (Get-GoriqSourceRepairNativeContext) -or $env:GITHUB_REPOSITORY -cne 'haji84/AI-' -or $env:GITHUB_ACTOR -cne 'haji84' -or $env:GITHUB_TRIGGERING_ACTOR -cne 'haji84' -or $env:GITHUB_REF -cne 'refs/heads/main' -or $env:GITHUB_EVENT_NAME -cne 'workflow_dispatch' -or $env:RUNNER_NAME -cne 'ZBook' -or $env:RUNNER_OS -cne 'Windows' -or $env:GITHUB_SHA -cnotmatch '\A[a-f0-9]{40}\z' -or $env:GITHUB_RUN_ID -cnotmatch '\A[1-9][0-9]{0,19}\z' -or $env:GITHUB_RUN_ATTEMPT -cne '1' -or $env:GORIQ_SOURCE_REPAIR_PHASE -cnotin @('plan','apply') -or $Apply -ne ($env:GORIQ_SOURCE_REPAIR_PHASE -ceq 'apply')){throw 'REFUSED'}
  $failure='SOURCE_BYTES_UNVERIFIED'
  $utf8=[Text.UTF8Encoding]::new($false,$true);$bytes=$utf8.GetBytes($CaptureSource+"`n"+$RepairSource)
  if($CaptureSource.Length -lt 100 -or $RepairSource.Length -lt 100 -or $bytes.Length -gt 131072 -or $CaptureSource.StartsWith([string][char]0xfeff,[StringComparison]::Ordinal) -or $RepairSource.StartsWith([string][char]0xfeff,[StringComparison]::Ordinal)){throw 'REFUSED'}
  $hash=[Security.Cryptography.SHA256]::Create();try{$implementation=[BitConverter]::ToString($hash.ComputeHash($bytes)).Replace('-','').ToLowerInvariant()}finally{$hash.Dispose()}
  if($env:GORIQ_SOURCE_ACL_IMPLEMENTATION_SHA256 -cne $implementation){throw 'REFUSED'}
  $failure='NATIVE_BUILD_UNAVAILABLE';Initialize-GoriqSourceRepairNative ($CaptureSource+"`n"+$RepairSource)
  $started=$true;$output=@(Invoke-GoriqSourceRepairNative $Apply)
  if($output.Count -ne 1 -or $output[0] -isnot [string]){throw 'RESULT_UNVERIFIED'}
  return ConvertTo-GoriqSourceRepairClosedJson $output[0] $Apply $implementation
 }catch{
  if($started){throw 'SOURCE_ACL_EXECUTION_UNVERIFIED'}
  return New-GoriqSourceRepairRefusal $failure
 }
}
