[CmdletBinding()]
param([switch]$Apply,[string]$AuthorizationPath)
$exerciseApply=$Apply;$exerciseReceipt=$AuthorizationPath
. (Join-Path $PSScriptRoot 'rotate-jarvis-owner-code-windows.ps1') -Apply:$false -AuthorizationPath ''
function Restore-OwnerRotationOriginal {
 param($Authorization,$Context,[string]$originalCode,[scriptblock]$Checkpoint,[string]$Event='after-rollback',[datetimeoffset]$Deadline,$Result,[switch]$Planned,[switch]$Recovery)
 if($Context.PSObject.Properties.Name -contains 'ExerciseBinding'){& $Context.ExerciseBinding}
 if($Planned -and -not $Recovery){Assert-OwnerRotationAuthority $Authorization $Context Forward}else{Assert-OwnerRotationAuthority $Authorization $Context Recovery}
 if((Get-OwnerRotationNow) -ge $Deadline){throw 'ROTATION_RECOVERY_FAILED'}
 $alreadyRestored=$Recovery -and (Get-OwnerRotationHash $Context.ConfigPath) -ceq $Context.OriginalHash -and (Test-Path -LiteralPath $Context.FailedPath) -and -not (Test-Path -LiteralPath $Context.BackupPath)
 Assert-OwnerRotationProtectedPath -Path $Context.ConfigPath -OwnerSid $Authorization.ownerSid -OwnerProfile $Context.OwnerProfile
 if(-not $alreadyRestored){
  if((Get-OwnerRotationHash $Context.ConfigPath) -cne $Context.CandidateHash -or (Get-OwnerRotationHash $Context.BackupPath) -cne $Context.OriginalHash -or (Test-Path -LiteralPath $Context.FailedPath)){throw 'ROTATION_RECOVERY_FAILED'}
  Assert-OwnerRotationProtectedPath -Path $Context.BackupPath -OwnerSid $Authorization.ownerSid -OwnerProfile $Context.OwnerProfile
  if((Get-OwnerRotationAclHash $Context.BackupPath) -cne $Context.ConfigAclHash){throw 'ROTATION_RECOVERY_FAILED'}
  if($Context.PSObject.Properties.Name -contains 'ExerciseBinding'){& $Context.ExerciseBinding}
  [IO.File]::Replace($Context.BackupPath,$Context.ConfigPath,$Context.FailedPath,$true)
 }
 if((Get-OwnerRotationHash $Context.ConfigPath) -cne $Context.OriginalHash -or (Get-OwnerRotationAclHash $Context.ConfigPath) -cne $Context.ConfigAclHash){throw 'ROTATION_RECOVERY_FAILED'}
 if($Planned){$Result.atomicRestorationVerified=$true}
 Assert-OwnerRotationProtectedPath -Path $Context.FailedPath -OwnerSid $Authorization.ownerSid -OwnerProfile $Context.OwnerProfile
 if((Get-OwnerRotationHash $Context.FailedPath) -cne $Context.CandidateHash -or (Get-OwnerRotationAclHash $Context.FailedPath) -cne $Context.ConfigAclHash){throw 'ROTATION_RECOVERY_FAILED'}
 Assert-OwnerRotationAuthority $Authorization $Context Recovery
 if((Get-OwnerRotationNow) -ge $Deadline){throw 'ROTATION_RECOVERY_FAILED'}
 if($Context.PSObject.Properties.Name -contains 'ExerciseBinding'){& $Context.ExerciseBinding}
 Restart-OwnerRotationTask $Context $Deadline
 if(-not(Test-LocalOwnerLogin $originalCode $Deadline 30)){throw 'ROTATION_RECOVERY_FAILED'};$Result.oldLoginVerified=$true
 if(-not(Test-OwnerRotationRuntime $Authorization $Deadline)){throw 'ROTATION_RECOVERY_FAILED'}
 if($Planned){$Result.runtimeVerified=$true;$Result.finalOriginalConfigurationVerified=$true;$Result.encryptedCandidateRetained=$true}
 Assert-OwnerRotationDatabase -Authorization $Authorization -Context $Context
 if((& $Checkpoint $Event) -ne $true){throw 'ROTATION_RECOVERY_FAILED'}
 Assert-OwnerRotationAuthority $Authorization $Context Recovery
 if((Get-OwnerRotationNow) -ge $Deadline -or (Get-OwnerRotationHash $Context.ConfigPath) -cne $Context.OriginalHash -or (Get-OwnerRotationAclHash $Context.ConfigPath) -cne $Context.ConfigAclHash){throw 'ROTATION_RECOVERY_FAILED'}
}
function Invoke-OwnerRotationExercise {
 param($Authorization,$Context,$Configuration,[scriptblock]$Checkpoint)
 $rotation=Invoke-OwnerRotationTransaction -Authorization $Authorization -Context $Context -Configuration $Configuration -Checkpoint $Checkpoint
 $restoration=[pscustomobject][ordered]@{attempted=$false;complete=$false;atomicRestorationVerified=$false;oldLoginVerified=$false;runtimeVerified=$false;preservationVerified=$false;finalOriginalConfigurationVerified=$false;encryptedCandidateRetained=$false;recoveryAttempted=$false;recoveryVerified=$false;failureCode=$null}
 $exercise=[pscustomobject][ordered]@{schemaVersion=2;issue=1218;operation='rotation-restoration-exercise';complete=$false;failureCode='ROTATION_EXERCISE_INCOMPLETE';failedStage='rotation';rotation=$rotation;restoration=$restoration}
 if(-not $rotation.complete){return $exercise}
 try {
  Assert-OwnerRotationAuthority $Authorization $Context Forward
  if((& $Checkpoint 'before-planned-restore') -ne $true){throw 'ROTATION_PLANNED_RESTORE_FAILED'}
  Assert-OwnerRotationAuthority $Authorization $Context Forward
  $restoration.attempted=$true
  Restore-OwnerRotationOriginal -Authorization $Authorization -Context $Context -OriginalCode ([string]$Configuration.environment.JARVIS_OWNER_SECRET) -Checkpoint $Checkpoint -Event 'after-planned-restore' -Deadline $Context.ForwardDeadline -Result $restoration -Planned
  $restoration.runtimeVerified=$true;$restoration.preservationVerified=$true;$restoration.finalOriginalConfigurationVerified=$true;$restoration.encryptedCandidateRetained=$true;$restoration.complete=$true;$exercise.complete=$true;$exercise.failureCode=$null;$exercise.failedStage=$null
 } catch {
  $restoration.failureCode='ROTATION_PLANNED_RESTORE_FAILED';$exercise.failureCode='ROTATION_EXERCISE_INCOMPLETE';$exercise.failedStage='planned-restoration'
  # A forward-window failure must not strand a safely recoverable configuration.
  # This uses only the original hard deadline/reserve; never mint another attempt.
  if(-not ($restoration.atomicRestorationVerified -and $restoration.oldLoginVerified -and $restoration.runtimeVerified)){
   $restoration.recoveryAttempted=$true
   try {
    Restore-OwnerRotationOriginal -Authorization $Authorization -Context $Context -OriginalCode ([string]$Configuration.environment.JARVIS_OWNER_SECRET) -Checkpoint $Checkpoint -Event 'after-planned-restore' -Deadline $Context.RecoveryDeadline -Result $restoration -Planned -Recovery
    $restoration.recoveryVerified=$true;$restoration.preservationVerified=$true
   } catch {}
  }
 }
 return $exercise
}
function New-OwnerExerciseRestoration {
 return [pscustomobject][ordered]@{attempted=$false;complete=$false;atomicRestorationVerified=$false;oldLoginVerified=$false;runtimeVerified=$false;preservationVerified=$false;finalOriginalConfigurationVerified=$false;encryptedCandidateRetained=$false;recoveryAttempted=$false;recoveryVerified=$false;failureCode=$null}
}
function Show-OwnerExerciseResult($Result,$Context) {
 Add-Type -AssemblyName System.Windows.Forms
 $form=New-Object Windows.Forms.Form;$form.Name='OwnerRotationExerciseResult';$form.Text='Owner rotation and planned restoration';$form.Width=480;$form.Height=170
 $status=New-Object Windows.Forms.Label;$status.Text=if($Result.complete){'Rotation and planned restoration verified. The original Owner code is active.'}elseif($Result.restoration.finalOriginalConfigurationVerified){'Acceptance did not complete. The original configuration and login were restored.'}else{'Acceptance did not complete. Preserve the encrypted recovery files locally.'};$status.SetBounds(15,15,430,65);$form.Controls.Add($status)
 $close=New-Object Windows.Forms.Button;$close.Text='Close';$close.SetBounds(340,85,90,30);$close.Add_Click({$form.Close()}.GetNewClosure());$form.Controls.Add($close);$form.AcceptButton=$close
 $timer=New-Object Windows.Forms.Timer;$timer.Interval=100;$timer.Add_Tick({$form.Close()}.GetNewClosure())
 try{$timer.Start();[void]$form.ShowDialog()}finally{$timer.Stop();$timer.Dispose();$form.Dispose()}
}
function Invoke-OwnerRotationExerciseMain([string]$Receipt,[scriptblock]$Checkpoint) {
 $rotation=New-OwnerRotationResult;$rotation.failureCode='ROTATION_SCOPE_REQUIRED';$rotation.failedStage='approval'
 $value=[pscustomobject][ordered]@{schemaVersion=2;issue=1218;operation='rotation-restoration-exercise';complete=$false;failureCode='ROTATION_EXERCISE_INCOMPLETE';failedStage='rotation';rotation=$rotation;restoration=(New-OwnerExerciseRestoration)}
 try {
  $path=Get-OwnerRotationSafePath $Receipt;$bytes=[IO.File]::ReadAllBytes($path);if($bytes.Length -gt 65536){throw 'ROTATION_SCOPE_REQUIRED'};$authorization=[Text.Encoding]::UTF8.GetString($bytes)|ConvertFrom-Json
  $context=Get-OwnerRotationContext -Authorization $authorization -SourceRoot ([IO.Path]::GetDirectoryName($PSScriptRoot)) -AuthorizationPath $path -ReceiptHash (Get-OwnerRotationHash $path)
  if($authorization.automationConfirmationApproval -ne $true){throw 'ROTATION_SCOPE_REQUIRED'}
  # Tighten the legacy context to the controller's earlier hard end; never extend
  # its original deadline or recreate the 900-second/120-second budget.
  $hard=[datetimeoffset]::Parse($env:GORIQ_OWNER_EXERCISE_HARD_END)
  if($hard -gt $context.RecoveryDeadline -or $hard -le (Get-OwnerRotationNow).AddSeconds(120)){throw 'ROTATION_SCOPE_REQUIRED'}
  $context.RecoveryDeadline=$hard;$context.ForwardDeadline=$hard.AddSeconds(-120)
  $grantPath=[IO.Path]::Combine([IO.Path]::GetDirectoryName($path),'original-grant.json');$claimPath=([IO.Path]::GetDirectoryName([IO.Path]::GetDirectoryName($path)))+'.claim'
  foreach($p in @($grantPath,$claimPath)){Assert-OwnerRotationProtectedPath -Path $p -OwnerSid $authorization.ownerSid -OwnerProfile $context.OwnerProfile}
  $grantHash=Get-OwnerRotationHash $grantPath;$claimHash=Get-OwnerRotationHash $claimPath
  $grant=[IO.File]::ReadAllText($grantPath)|ConvertFrom-Json;$claim=[IO.File]::ReadAllText($claimPath)|ConvertFrom-Json
  if($grant.kind -cne 'NONSECRET_ORIGINAL_ROTATION_GRANT' -or $grant.operation -cne 'rotate-verify-restore-verify-original' -or $grant.approvalId -cne $authorization.attemptId -or $claim.originalDescriptorSha256 -cne $grantHash -or $claim.runtimeScopeSha256 -cne $context.ReceiptHash -or $grant.sourceRevision -cne $authorization.sourceRevision -or $grant.expiresAt -cne $authorization.expiresAt){throw 'ROTATION_SCOPE_REQUIRED'}
  $binding={
   Assert-OwnerRotationAuthority $authorization $context Recovery
   if((Get-OwnerRotationHash $grantPath) -cne $grantHash -or (Get-OwnerRotationHash $claimPath) -cne $claimHash){throw 'ROTATION_SCOPE_REQUIRED'}
   foreach($extra in @('owner-code-rotation-exercise.mjs','owner-code-rotation-exercise.ps1','owner-code-rotation-native-1218.mjs','owner-code-rotation-native-1218.ps1','owner-code-launcher-binding-inspection-1218.ps1')){
    $file=[IO.Path]::Combine($PSScriptRoot,$extra);Assert-OwnerRotationProtectedPath -Path $file -OwnerSid $authorization.ownerSid
    if((Get-OwnerRotationHash $file) -cne $grant.sourceHashes.('scripts/'+$extra)){throw 'ROTATION_SCOPE_REQUIRED'}
   }
  }.GetNewClosure()
  & $binding
  $context|Add-Member NoteProperty ExerciseBinding $binding
  $confirmation=Show-OwnerRotationConfirmation -Authorization $authorization -Context $context -Controlled
  $context.Confirmed=$confirmation.confirmed;$context.WarningVerified=$confirmation.warning
  if(-not $context.Confirmed){$value.rotation.confirmationVerified=$false;$value.rotation.sessionInvalidationWarningVerified=$context.WarningVerified;$value.rotation.failureCode='ROTATION_CANCELLED';$value.rotation.failedStage='confirmation';return $value}
  $state=@{result=$null};$consumer={param($configuration)$state.result=Invoke-OwnerRotationExercise -Authorization $authorization -Context $context -Configuration $configuration -Checkpoint $Checkpoint}.GetNewClosure()
  & ([IO.Path]::Combine($PSScriptRoot,'read-jarvis-production-config.ps1')) -Path $context.ConfigPath -ConfigurationConsumer $consumer|Out-Null
  if(-not $state.result){throw 'ROTATION_REJECTED'};$value=$state.result
  try{Show-OwnerExerciseResult -Result $value -Context $context}catch{$value.complete=$false;$value.failureCode='ROTATION_REJECTED';$value.failedStage='result'}
 }catch{$value.complete=$false;$value.failureCode='ROTATION_CONTEXT_UNAVAILABLE';$value.failedStage='context'}
 return $value
}
if($MyInvocation.InvocationName -ne '.') {
 if(-not $exerciseApply){[Console]::Out.WriteLine('PLAN ONLY: public OriginalGrant and protected local receipt are required; no Owner state is accessed.');exit 0}
 $checkpoint={param($Event)
  if($Event -notin @('before-rotation','before-commit','after-rollback','before-planned-restore','after-planned-restore')){throw 'ROTATION_PROTOCOL_FAILED'}
  [Console]::Out.WriteLine((@{event=$Event}|ConvertTo-Json -Compress));[Console]::Out.Flush();$read=[Console]::In.ReadLineAsync()
  if(-not $read.Wait(15000)){throw 'ROTATION_PROTOCOL_FAILED'};$line=$read.Result;if(-not $line -or $line.Length -gt 1024){throw 'ROTATION_PROTOCOL_FAILED'};$ack=$line|ConvertFrom-Json
  if(@($ack.PSObject.Properties).Count -ne 2 -or $ack.event -cne $Event -or $ack.accepted -isnot [bool]){throw 'ROTATION_PROTOCOL_FAILED'};return $ack.accepted
 }
 $result=Invoke-OwnerRotationExerciseMain -Receipt $exerciseReceipt -Checkpoint $checkpoint
 [Console]::Out.WriteLine((@{event='result';result=$result}|ConvertTo-Json -Depth 6 -Compress));if(-not $result.complete){exit 1}
}
