[CmdletBinding()]
param([switch]$Apply,[string]$AuthorizationPath)

# Dot-sourcing defines capabilities only. No identity/configuration/UI is touched.
function Get-OwnerRotationNow { [datetimeoffset]::UtcNow }
function Get-OwnerRotationHash([string]$Path) { (Get-FileHash -LiteralPath $Path -Algorithm SHA256 -ErrorAction Stop).Hash.ToLowerInvariant() }
function Get-OwnerRotationIdentity { [Security.Principal.WindowsIdentity]::GetCurrent() }
function Get-OwnerRotationSafePath([string]$Path) {
 if ([string]::IsNullOrWhiteSpace($Path) -or $Path -match '[\r\n\0]' -or $Path -match '^[\\/]{2}' -or -not [IO.Path]::IsPathRooted($Path)) { throw 'ROTATION_CONTEXT_UNAVAILABLE' }
 $full=[IO.Path]::GetFullPath($Path);$root=[IO.Path]::GetPathRoot($full)
 if ([IO.Path]::DirectorySeparatorChar -eq [char]92 -and ($full -notmatch '^[A-Za-z]:\\[^:]*$' -or ([IO.DriveInfo]::new($root)).DriveType -ne [IO.DriveType]::Fixed)) { throw 'ROTATION_CONTEXT_UNAVAILABLE' }
 $item=Get-Item -LiteralPath $root -Force -ErrorAction Stop;$current=$root
 foreach ($part in $full.Substring($root.Length).Split([IO.Path]::DirectorySeparatorChar)) {
  if (-not $part) { continue }
  if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'ROTATION_CONTEXT_UNAVAILABLE' }
  $current=Join-Path $current $part
  try { $item=Get-Item -LiteralPath $current -Force -ErrorAction Stop } catch { if ($_.CategoryInfo.Category -eq [Management.Automation.ErrorCategory]::ObjectNotFound) { return $full };throw }
 }
 if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'ROTATION_CONTEXT_UNAVAILABLE' }
 return $full
}
function Get-OwnerRotationAclHash([string]$Path) {
 $acl=Get-Acl -LiteralPath $Path -ErrorAction Stop
 $bytes=[Text.Encoding]::UTF8.GetBytes($acl.GetSecurityDescriptorSddlForm([Security.AccessControl.AccessControlSections]'Owner,Group,Access'))
 $hash=[Security.Cryptography.SHA256]::Create();try { ([BitConverter]::ToString($hash.ComputeHash($bytes))).Replace('-','').ToLowerInvariant() } finally { $hash.Dispose() }
}
function Assert-OwnerRotationProtectedPath {
 param([string]$Path,[string]$OwnerSid,[string]$OwnerProfile)
 $current=Get-OwnerRotationSafePath $Path
 while (-not (Test-Path -LiteralPath $current)) { $current=Split-Path -Parent $current }
 if ($OwnerProfile -and $current -ine $OwnerProfile -and -not $current.StartsWith($OwnerProfile+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)) { throw 'ROTATION_CONTEXT_UNAVAILABLE' }
 $trusted=@($OwnerSid,'S-1-5-18','S-1-5-32-544','S-1-3-0');$depth=0;$pathRoot=[IO.Path]::GetPathRoot($current);$fullWrite=[Security.AccessControl.FileSystemRights]'Write,Delete,DeleteSubdirectoriesAndFiles,ChangePermissions,TakeOwnership'
 while ($true) {
  $write=if($depth -le 1 -or ($OwnerProfile -and $current -ieq $OwnerProfile)){$fullWrite}else{[Security.AccessControl.FileSystemRights]'Delete,DeleteSubdirectoriesAndFiles,ChangePermissions,TakeOwnership'}
  $acl=Get-Acl -LiteralPath $current -ErrorAction Stop
  if ($acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -notin @($OwnerSid,'S-1-5-18','S-1-5-32-544')) { throw 'ROTATION_CONTEXT_UNAVAILABLE' }
  foreach ($rule in $acl.Access) {
   if ($rule.AccessControlType -eq [Security.AccessControl.AccessControlType]::Allow -and ($rule.FileSystemRights -band $write) -ne 0 -and $rule.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value -notin $trusted) { throw 'ROTATION_CONTEXT_UNAVAILABLE' }
  }
  if (($OwnerProfile -and $current -ieq $OwnerProfile) -or $current -ieq $pathRoot) { break };$current=[IO.Path]::GetDirectoryName($current);$depth++
 }
}
function Get-OwnerRotationTaskHash($Task) {
 $actions=@($Task.Actions);if ($actions.Count -ne 1) { throw 'ROTATION_CONTEXT_UNAVAILABLE' }
 $canonical=[ordered]@{taskName=[string]$Task.TaskName;taskPath=[string]$Task.TaskPath;execute=[string]$actions[0].Execute;arguments=[string]$actions[0].Arguments;workingDirectory=[string]$actions[0].WorkingDirectory;userId=[string]$Task.Principal.UserId;logonType=[string]$Task.Principal.LogonType;runLevel=[string]$Task.Principal.RunLevel}
 $hash=[Security.Cryptography.SHA256]::Create();try { ([BitConverter]::ToString($hash.ComputeHash([Text.Encoding]::UTF8.GetBytes(($canonical|ConvertTo-Json -Compress))))).Replace('-','').ToLowerInvariant() } finally { $hash.Dispose() }
}
function Assert-OwnerRotationSource {
 param($Authorization,$Context)
 $names=@('scripts/owner-code-rotation-acceptance.mjs','scripts/owner-code-fleet-preservation.mjs','scripts/owner-code-pc-preservation.mjs','scripts/owner-code-rotation-worker.ps1','scripts/rotate-jarvis-owner-code-windows.ps1','scripts/read-jarvis-production-config.ps1','scripts/validate-jarvis-production-config.mjs','scripts/jarvis-production-config.mjs','scripts/jarvis-windows-install-paths.mjs')
 if (@($Authorization.sourceHashes.PSObject.Properties).Count -ne $names.Count -or $Authorization.sourceRevision -cne $Context.SourceRevision) { throw 'ROTATION_SCOPE_REQUIRED' }
 foreach ($name in $names) {
  $expected=$Authorization.sourceHashes.$name
  if ($expected -cnotmatch '^[a-f0-9]{64}$') { throw 'ROTATION_SCOPE_REQUIRED' }
  $path=Get-OwnerRotationSafePath (Join-Path $Context.SourceRoot $name)
  Assert-OwnerRotationProtectedPath -Path $path -OwnerSid $Authorization.ownerSid
  if ((Get-OwnerRotationHash $path) -cne $expected) { throw 'ROTATION_SCOPE_REQUIRED' }
 }
}
function Assert-OwnerRotationAuthority {
 param($Authorization,$Context,[ValidateSet('Initial','Forward','Recovery')][string]$Phase='Forward')
 $now=Get-OwnerRotationNow;$issued=[datetimeoffset]::Parse($Authorization.issuedAt);$expires=[datetimeoffset]::Parse($Authorization.expiresAt)
 if ($Authorization.scopeId -cne 'issue:1218:owner-code-rotation' -or $Authorization.ownerSid -cne $Context.Identity.User.Value -or
     $Authorization.credentialRotationApproval -ne $true -or $Authorization.existingTaskRestartApproval -ne $true -or $Authorization.configPersistenceApproval -ne $true -or
     $Authorization.normalLoopbackCookieApproval -ne $true -or $Authorization.confirmationApproval -ne $true -or $Authorization.fleetReadOnlyApproval -ne $true -or $Authorization.pcSidecarReadOnlyApproval -ne $true -or
     $issued -gt $now -or $expires -le $now -or $expires -gt $issued.AddHours(2) -or $Authorization.maxAttempts -ne 1 -or
     $Authorization.maxDurationSeconds -ne 900 -or $Authorization.recoveryReserveSeconds -ne 120 -or $Authorization.configSha256 -cnotmatch '^[a-f0-9]{64}$' -or $Authorization.taskSha256 -cnotmatch '^[a-f0-9]{64}$' -or $Authorization.nodeSha256 -cnotmatch '^[a-f0-9]{64}$' -or
     $Authorization.sourceRevision -cnotmatch '^[a-f0-9]{40}$' -or $Authorization.runtimeRevision -cnotmatch '^[a-f0-9]{40}$' -or $Authorization.attemptId -cnotmatch '^[A-Za-z0-9_-]{8,96}$') { throw 'ROTATION_SCOPE_REQUIRED' }
 if ($env:GITHUB_RUN_ID -and ([string]$Authorization.workflowRunId -cne $env:GITHUB_RUN_ID -or [string]$Authorization.workflowRunAttempt -cne $env:GITHUB_RUN_ATTEMPT)) { throw 'ROTATION_SCOPE_REQUIRED' }
 Assert-OwnerRotationProtectedPath -Path $Context.AuthorizationPath -OwnerSid $Authorization.ownerSid -OwnerProfile $Context.OwnerProfile
 if($Context.ReceiptHash -cnotmatch '^[a-f0-9]{64}$' -or (Get-OwnerRotationHash $Context.AuthorizationPath) -cne $Context.ReceiptHash){throw 'ROTATION_SCOPE_REQUIRED'}
 if (@($Authorization.pcSidecars.PSObject.Properties).Count -ne 3 -or $Authorization.pcSidecars.profile -cne 'jarvis-pc-sidecars-v1' -or $Authorization.pcSidecars.expectedTaskFile -cnotin @('present','absent') -or $Authorization.pcSidecars.expectedObservationFile -cnotin @('present','absent')) { throw 'ROTATION_SCOPE_REQUIRED' }
 Assert-OwnerRotationSource $Authorization $Context
 Assert-OwnerRotationProtectedPath -Path $Context.ConfigPath -OwnerSid $Authorization.ownerSid -OwnerProfile $Context.OwnerProfile
 Assert-OwnerRotationProtectedPath -Path $Context.NodePath -OwnerSid $Authorization.ownerSid
 if ((Get-OwnerRotationAclHash $Context.ConfigPath) -cne $Context.ConfigAclHash -or (Get-OwnerRotationHash $Context.NodePath) -cne $Authorization.nodeSha256) { throw 'ROTATION_SCOPE_REQUIRED' }
 if ((Get-OwnerRotationTaskHash (Get-ScheduledTask -TaskName $Context.TaskName -ErrorAction Stop)) -cne $Authorization.taskSha256) { throw 'ROTATION_SCOPE_REQUIRED' }
 if ($Phase -ne 'Recovery') {
  if ($now -ge $Context.ForwardDeadline) { throw 'ROTATION_SCOPE_REQUIRED' }
  $expected=if ($Context.Replaced) {$Context.CandidateHash}else{$Authorization.configSha256}
  if ((Get-OwnerRotationHash $Context.ConfigPath) -cne $expected) { throw 'ROTATION_SCOPE_REQUIRED' }
 } elseif ($now -ge $Context.RecoveryDeadline) { throw 'ROTATION_SCOPE_REQUIRED' }
}
function Get-OwnerRotationContext {
 param($Authorization,[string]$SourceRoot,[string]$AuthorizationPath,[string]$ReceiptHash)
 if ($env:OS -ne 'Windows_NT' -or $env:JARVIS_PRODUCTION_CONFIG) { throw 'ROTATION_CONTEXT_UNAVAILABLE' }
 $identity=Get-OwnerRotationIdentity
 if ($identity.IsSystem -or $identity.User.Value -cne $Authorization.ownerSid -or (Get-Process -Id $PID).SessionId -eq 0 -or -not [Environment]::UserInteractive) { throw 'ROTATION_CONTEXT_UNAVAILABLE' }
 $profile=Get-OwnerRotationSafePath ([Environment]::GetFolderPath('UserProfile'))
 if ($profile -ine [IO.Path]::GetFullPath($env:USERPROFILE)) { throw 'ROTATION_CONTEXT_UNAVAILABLE' }
 $config=Get-OwnerRotationSafePath (Join-Path $profile 'JARVIS\production\config.dpapi');$state=Split-Path -Parent $config
 foreach ($path in @($profile,$state,$config,$AuthorizationPath)) { Assert-OwnerRotationProtectedPath -Path $path -OwnerSid $identity.User.Value -OwnerProfile $profile }
 if ((Get-Acl -LiteralPath $config).GetOwner([Security.Principal.SecurityIdentifier]).Value -cne $identity.User.Value) { throw 'ROTATION_CONTEXT_UNAVAILABLE' }
 $task=Get-ScheduledTask -TaskName 'JARVIS Remote Host' -ErrorAction Stop
 if ($task.State -ne 'Running') { throw 'ROTATION_CONTEXT_UNAVAILABLE' }
 $node=Get-OwnerRotationSafePath (Get-Command node.exe -ErrorAction Stop).Source
 Assert-OwnerRotationProtectedPath -Path $node -OwnerSid $identity.User.Value
 if ((Get-OwnerRotationHash $node) -cne $Authorization.nodeSha256) { throw 'ROTATION_CONTEXT_UNAVAILABLE' }
 $revision=if($env:GITHUB_SHA){$env:GITHUB_SHA}else{(& git -C $SourceRoot rev-parse HEAD 2>$null).Trim()}
 $now=Get-OwnerRotationNow;$hard=[datetimeoffset]::Parse($Authorization.expiresAt);$budget=$now.AddSeconds(900);if($budget -lt $hard){$hard=$budget};$forward=$hard.AddSeconds(-120)
 $attemptRoot=Join-Path $state 'owner-rotation-attempts';Assert-OwnerRotationProtectedPath -Path $attemptRoot -OwnerSid $identity.User.Value -OwnerProfile $profile
 $nonce=[guid]::NewGuid().ToString('N')
 $context=[pscustomobject]@{AuthorizationPath=$AuthorizationPath;ReceiptHash=$ReceiptHash;Identity=$identity;OwnerProfile=$profile;ConfigPath=$config;OriginalHash=Get-OwnerRotationHash $config;ConfigAclHash=Get-OwnerRotationAclHash $config;SourceRoot=$SourceRoot;SourceRevision=$revision;TaskHash=Get-OwnerRotationTaskHash $task;TaskName='JARVIS Remote Host';Task=$task;ForwardDeadline=$forward;RecoveryDeadline=$hard;AttemptPath=(Join-Path $attemptRoot ($Authorization.attemptId+'.json'));CandidatePath=(Join-Path $state ('config.dpapi.'+$nonce+'.candidate'));BackupPath=(Join-Path $state ('config.dpapi.'+$nonce+'.backup'));FailedPath=(Join-Path $state ('config.dpapi.'+$nonce+'.failed'));NodePath=$node;ValidatorPath=(Join-Path $SourceRoot 'scripts/validate-jarvis-production-config.mjs');StateRoot=$state;Confirmed=$false;WarningVerified=$false;Replaced=$false;CandidateHash=$null}
 Assert-OwnerRotationAuthority $Authorization $context Initial
 return $context
}
function New-OwnerRotationResult {
 [pscustomobject][ordered]@{schemaVersion=1;issue=1218;complete=$false;confirmationVerified=$false;sessionInvalidationWarningVerified=$false;configurationValidated=$false;credentialGenerated=$false;atomicReplacementVerified=$false;protectedBackupVerified=$false;newLoginVerified=$false;rollbackAttempted=$false;rollbackVerified=$false;oldLoginVerified=$false;cleanupFailed=$false;failureCode=$null;failedStage=$null}
}
function Show-OwnerRotationConfirmation {
 param($Authorization,$Context,[switch]$Controlled)
 Add-Type -AssemblyName System.Windows.Forms
 $form=New-Object Windows.Forms.Form;$form.Name='OwnerRotationConfirmation';$form.Text='Confirm Owner credential rotation';$form.Width=540;$form.Height=210;$form.StartPosition='CenterScreen'
 $warning=New-Object Windows.Forms.Label;$warning.Name='OwnerRotationWarning';$warning.Text='Change the Production Owner login code? Existing Owner sessions will end. Worker identities and Broker data must remain unchanged.';$warning.SetBounds(15,15,490,70);$form.Controls.Add($warning)
 $yes=New-Object Windows.Forms.Button;$yes.Name='OwnerRotationConfirm';$yes.Text='Change code';$yes.SetBounds(250,105,110,30);$form.Controls.Add($yes)
 $no=New-Object Windows.Forms.Button;$no.Name='OwnerRotationCancel';$no.Text='Cancel';$no.SetBounds(380,105,110,30);$no.DialogResult=[Windows.Forms.DialogResult]::Cancel;$form.Controls.Add($no);$form.AcceptButton=$no;$form.CancelButton=$no
 $state=@{confirmed=$false;warning=$false};$timer=New-Object Windows.Forms.Timer;$timer.Interval=100
 $yes.Add_Click({try{Assert-OwnerRotationAuthority $Authorization $Context Forward;if($state.warning){$state.confirmed=$true;$form.Close()}}catch{$form.Close()}}.GetNewClosure())
 $form.Add_Shown({$state.warning=$warning.Visible -and $warning.Text.Contains('Existing Owner sessions will end.');$no.Focus()|Out-Null}.GetNewClosure())
 $timer.Add_Tick({if((Get-OwnerRotationNow) -ge $Context.ForwardDeadline){$form.Close();return};if($Controlled -and $state.warning){if($Authorization.automationConfirmationApproval -ne $true){$form.Close();return};$yes.PerformClick()}}.GetNewClosure())
 try{$timer.Start();[void]$form.ShowDialog();return [pscustomobject]@{confirmed=$state.confirmed;warning=$state.warning}}finally{$timer.Stop();$timer.Dispose();$form.Dispose()}
}
function Show-OwnerRotationResult {
 param($Result,$Context,[switch]$Controlled)
 Add-Type -AssemblyName System.Windows.Forms
 $form=New-Object Windows.Forms.Form;$form.Name='OwnerRotationResult';$form.Text='Owner credential rotation';$form.Width=440;$form.Height=170
 $status=New-Object Windows.Forms.Label;$status.Name='OwnerRotationStatus';$status.Text=if($Result.complete){'Rotation verified. Use GORIQ Owner Code to view the new code locally.'}elseif($Result.rollbackVerified){'Rotation failed. The original configuration and login were restored.'}else{'Rotation did not complete. Preserve the encrypted backup for local recovery.'};$status.SetBounds(15,15,390,65);$form.Controls.Add($status)
 $close=New-Object Windows.Forms.Button;$close.Name='OwnerRotationClose';$close.Text='Close';$close.SetBounds(300,85,90,30);$close.Add_Click({$form.Close()}.GetNewClosure());$form.Controls.Add($close);$form.AcceptButton=$close
 $timer=New-Object Windows.Forms.Timer;$timer.Interval=100;$until=(Get-OwnerRotationNow).AddSeconds(10)
 $timer.Add_Tick({if($Controlled -or (Get-OwnerRotationNow) -ge $until -or (Get-OwnerRotationNow) -ge $Context.RecoveryDeadline){$form.Close()}}.GetNewClosure())
 try{$timer.Start();[void]$form.ShowDialog()}finally{$timer.Stop();$timer.Dispose();$form.Dispose()}
}
function New-OwnerRotationCode {
 $bytes=New-Object byte[] 32;$rng=[Security.Cryptography.RandomNumberGenerator]::Create();try{$rng.GetBytes($bytes);[Convert]::ToBase64String($bytes)}finally{$rng.Dispose()}
}
function Test-OwnerRotationCandidate {
 param([string]$ConfigurationJson,$Context)
 $info=New-Object Diagnostics.ProcessStartInfo;$info.FileName=$Context.NodePath;$info.Arguments='"'+$Context.ValidatorPath+'" "'+$Context.Task.Actions[0].WorkingDirectory+'" "'+$Context.StateRoot+'"';$info.UseShellExecute=$false;$info.CreateNoWindow=$true;$info.RedirectStandardInput=$true;$info.RedirectStandardOutput=$true;$info.RedirectStandardError=$true
 $process=New-Object Diagnostics.Process;$process.StartInfo=$info
 try{if(-not $process.Start()){return $false};$out=$process.StandardOutput.ReadToEndAsync();$err=$process.StandardError.ReadToEndAsync();$process.StandardInput.Write($ConfigurationJson);$process.StandardInput.Close();if(-not $process.WaitForExit(10000)){$process.Kill();[void]$process.WaitForExit(2000);return $false};return $process.ExitCode -eq 0 -and $out.Result.Trim() -ceq 'Production configuration structure: PASS' -and $err.Result.Length -eq 0}finally{if(-not $process.HasExited){$process.Kill();[void]$process.WaitForExit(2000)};$process.Dispose()}
}
function Restart-OwnerRotationTask {
 param($Context,[datetimeoffset]$Deadline)
 if((Get-OwnerRotationNow) -ge $Deadline){throw 'ROTATION_REJECTED'}
 $previous=(Get-ScheduledTaskInfo -TaskName $Context.TaskName -ErrorAction Stop).LastRunTime
 Stop-ScheduledTask -TaskName $Context.TaskName -ErrorAction Stop|Out-Null
 while((Get-ScheduledTask -TaskName $Context.TaskName -ErrorAction Stop).State -eq 'Running'){if((Get-OwnerRotationNow) -ge $Deadline){throw 'ROTATION_REJECTED'};Start-Sleep -Milliseconds 100}
 if((Get-OwnerRotationNow) -ge $Deadline){throw 'ROTATION_REJECTED'}
 Start-ScheduledTask -TaskName $Context.TaskName -ErrorAction Stop|Out-Null
 while($true){if((Get-OwnerRotationNow) -ge $Deadline){throw 'ROTATION_REJECTED'};$task=Get-ScheduledTask -TaskName $Context.TaskName -ErrorAction Stop;$info=Get-ScheduledTaskInfo -TaskName $Context.TaskName -ErrorAction Stop;if($task.State -eq 'Running' -and $info.LastRunTime -gt $previous){return};Start-Sleep -Milliseconds 100}
}
function Test-LocalOwnerLogin {
 param([string]$code,[datetimeoffset]$Deadline=[datetimeoffset]::UtcNow.AddSeconds(120),[int]$MaxAttempts=30)
 for($attempt=0;$attempt -lt [Math]::Min(30,$MaxAttempts);$attempt++) {
  if(($Deadline-[datetimeoffset]::UtcNow).TotalSeconds -lt 4){return $false};Start-Sleep -Seconds 1
  if(($Deadline-[datetimeoffset]::UtcNow).TotalSeconds -lt 3){return $false}
  if((Get-ScheduledTask -TaskName 'JARVIS Remote Host').State -ne 'Running'){continue}
  $response=$null
  try{$response=Invoke-WebRequest -UseBasicParsing -MaximumRedirection 0 -Method POST -Uri 'http://127.0.0.1:3000/api/owner-login' -Headers @{Accept='application/json'} -Body @{passcode=$code} -TimeoutSec 3;if([datetimeoffset]::UtcNow -lt $Deadline -and $response.StatusCode -eq 200 -and ($response.Content|ConvertFrom-Json).ok -eq $true){return $true}}catch{}finally{$response=$null}
 }
 return $false
}
function Get-OwnerRotationPrincipalSid($Principal) {
 if([string]$Principal.UserId -match '^S-1-') { return ([Security.Principal.SecurityIdentifier]::new([string]$Principal.UserId)).Value }
 return ([Security.Principal.NTAccount]::new([string]$Principal.UserId)).Translate([Security.Principal.SecurityIdentifier]).Value
}
function Assert-OwnerRotationRuntimeConfiguration {
 param($Authorization,$Context,$Configuration)
 $release=Get-OwnerRotationSafePath ([string]$Configuration.releaseRoot);$manifest=Get-OwnerRotationSafePath (Join-Path $release 'jarvis-release.json')
 $item=Get-Item -LiteralPath $manifest -Force -ErrorAction Stop
 if($item -isnot [IO.FileInfo] -or $item.Length -gt 65536){throw 'ROTATION_CONTEXT_UNAVAILABLE'}
 Assert-OwnerRotationProtectedPath -Path $manifest -OwnerSid $Authorization.ownerSid
 $metadata=[IO.File]::ReadAllText($manifest)|ConvertFrom-Json
 $task=$Context.Task;$actions=@($task.Actions)
 if($metadata.commit -cne $Authorization.runtimeRevision -or $actions.Count -ne 1 -or
    (Get-OwnerRotationSafePath ([string]$actions[0].Execute)) -ine $Context.NodePath -or
    [string]$actions[0].Arguments -cne ('"'+(Join-Path $release 'scripts/jarvis-remote-host.mjs')+'"') -or
    (Get-OwnerRotationSafePath ([string]$actions[0].WorkingDirectory)) -ine $release -or
    (Get-OwnerRotationPrincipalSid $task.Principal) -cne $Authorization.ownerSid){throw 'ROTATION_CONTEXT_UNAVAILABLE'}
}
function Assert-OwnerRotationDatabase {
 param($Authorization,$Context)
 $path=Get-OwnerRotationSafePath $Authorization.dbPath
 if(-not(Test-Path -LiteralPath $path -PathType Leaf)){throw 'ROTATION_CONTEXT_UNAVAILABLE'}
 Assert-OwnerRotationProtectedPath -Path $path -OwnerSid $Authorization.ownerSid
 Assert-OwnerRotationProtectedPath -Path (Split-Path -Parent $path) -OwnerSid $Authorization.ownerSid
 foreach ($suffix in @('.pc-tasks.json','.pc-observations.json')) {
  $sidecar=Get-OwnerRotationSafePath ($path+$suffix)
  if(Test-Path -LiteralPath $sidecar){
   $item=Get-Item -LiteralPath $sidecar -Force -ErrorAction Stop
   if($item -isnot [IO.FileInfo] -or $item.Length -gt 8388608){throw 'ROTATION_CONTEXT_UNAVAILABLE'}
   Assert-OwnerRotationProtectedPath -Path $sidecar -OwnerSid $Authorization.ownerSid
  }
 }
}
function Test-OwnerRotationRuntime {
 param($Authorization,[datetimeoffset]$Deadline)
 if(($Deadline-[datetimeoffset]::UtcNow).TotalSeconds -lt 4){return $false}
 $response=$null
 try{$response=Invoke-WebRequest -UseBasicParsing -MaximumRedirection 0 -Method GET -Uri 'http://127.0.0.1:8787/health' -TimeoutSec 3;$body=$response.Content|ConvertFrom-Json;return [datetimeoffset]::UtcNow -lt $Deadline -and $response.StatusCode -eq 200 -and $body.ok -eq $true -and $body.service -ceq 'jarvis-broker' -and $body.runtimeRevision -ceq $Authorization.runtimeRevision}catch{return $false}finally{$response=$null;$body=$null}
}
function Invoke-OwnerRotationTransaction {
 param($Authorization,$Context,$Configuration,[scriptblock]$Checkpoint)
 $ErrorActionPreference='Stop';Set-StrictMode -Version Latest
 $result=New-OwnerRotationResult;$stage='approval';$newCode=$null;$originalCode=$null;$candidateJson=$null;$candidateCreated=$false
 try {
  Assert-OwnerRotationAuthority $Authorization $Context Initial
  $stage='confirmation';$result.confirmationVerified=$Context.Confirmed;$result.sessionInvalidationWarningVerified=$Context.WarningVerified
  if(-not $Context.Confirmed -or -not $Context.WarningVerified){$result.failureCode='ROTATION_CANCELLED';throw 'ROTATION_CANCELLED'}
  $stage='configuration'
  $originalCode=[string]$Configuration.environment.JARVIS_OWNER_SECRET
  if($originalCode.Length -lt 24 -or $originalCode -match '[\r\n\0]' -or $Configuration.commit -cne $Authorization.runtimeRevision -or (Get-OwnerRotationSafePath ([string]$Configuration.environment.JARVIS_DB_PATH)) -ine (Get-OwnerRotationSafePath $Authorization.dbPath)){throw 'ROTATION_REJECTED'}
  if($Context.PSObject.Properties.Name -contains 'Task' -and [IO.Path]::GetFullPath([string]$Configuration.releaseRoot) -ine [IO.Path]::GetFullPath([string]$Context.Task.Actions[0].WorkingDirectory)){throw 'ROTATION_REJECTED'}
  $stage='before-rotation'
  Assert-OwnerRotationRuntimeConfiguration -Authorization $Authorization -Context $Context -Configuration $Configuration
  Assert-OwnerRotationDatabase -Authorization $Authorization -Context $Context
  if(-not(Test-OwnerRotationRuntime $Authorization $Context.ForwardDeadline)){throw 'ROTATION_REJECTED'}
  if(-not $Checkpoint -or (& $Checkpoint 'before-rotation') -ne $true){throw 'ROTATION_REJECTED'}
  Assert-OwnerRotationAuthority $Authorization $Context Forward
  $parent=Split-Path -Parent $Context.AttemptPath;[IO.Directory]::CreateDirectory($parent)|Out-Null;Assert-OwnerRotationProtectedPath -Path $parent -OwnerSid $Authorization.ownerSid -OwnerProfile $Context.OwnerProfile
  $attempt=[IO.File]::Open($Context.AttemptPath,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
  try{$bytes=[Text.Encoding]::UTF8.GetBytes('{"attemptConsumed":true}');$attempt.Write($bytes,0,$bytes.Length)}finally{$attempt.Dispose()}
  $stage='candidate';$newCode=New-OwnerRotationCode;$result.credentialGenerated=$true
  $candidate=($Configuration|ConvertTo-Json -Depth 20 -Compress)|ConvertFrom-Json;$candidate.environment.JARVIS_OWNER_SECRET=$newCode;$candidateJson=$candidate|ConvertTo-Json -Depth 20 -Compress
  if(-not(Test-OwnerRotationCandidate -ConfigurationJson $candidateJson -Context $Context)){throw 'ROTATION_REJECTED'};$result.configurationValidated=$true
  Assert-OwnerRotationAuthority $Authorization $Context Forward
  $encrypted=$candidateJson|ConvertTo-SecureString -AsPlainText -Force|ConvertFrom-SecureString
  foreach($path in @($Context.CandidatePath,$Context.BackupPath,$Context.FailedPath)){Get-OwnerRotationSafePath $path|Out-Null;if(Test-Path -LiteralPath $path){throw 'ROTATION_REJECTED'}}
  $stream=[IO.File]::Open($Context.CandidatePath,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None);$candidateCreated=$true
  try{$bytes=[Text.Encoding]::ASCII.GetBytes($encrypted);$stream.Write($bytes,0,$bytes.Length)}finally{$stream.Dispose()}
  $Context.CandidateHash=Get-OwnerRotationHash $Context.CandidatePath
  Set-Acl -LiteralPath $Context.CandidatePath -AclObject (Get-Acl -LiteralPath $Context.ConfigPath) -ErrorAction Stop
  Assert-OwnerRotationProtectedPath -Path $Context.CandidatePath -OwnerSid $Authorization.ownerSid -OwnerProfile $Context.OwnerProfile
  if((Get-OwnerRotationAclHash $Context.CandidatePath) -cne $Context.ConfigAclHash){throw 'ROTATION_REJECTED'}
  if((Get-OwnerRotationHash $Context.CandidatePath) -cne $Context.CandidateHash){throw 'ROTATION_REJECTED'}
  $stage='replace';Assert-OwnerRotationAuthority $Authorization $Context Forward
  [IO.File]::Replace($Context.CandidatePath,$Context.ConfigPath,$Context.BackupPath,$true);$Context.Replaced=$true
  if((Get-OwnerRotationHash $Context.ConfigPath) -cne $Context.CandidateHash -or (Get-OwnerRotationHash $Context.BackupPath) -cne $Context.OriginalHash){throw 'ROTATION_REJECTED'};$result.atomicReplacementVerified=$true
  Assert-OwnerRotationProtectedPath -Path $Context.BackupPath -OwnerSid $Authorization.ownerSid -OwnerProfile $Context.OwnerProfile
  if((Get-OwnerRotationAclHash $Context.BackupPath) -cne $Context.ConfigAclHash){throw 'ROTATION_REJECTED'};$result.protectedBackupVerified=$true
  $stage='restart';Assert-OwnerRotationAuthority $Authorization $Context Forward;Restart-OwnerRotationTask $Context $Context.ForwardDeadline
  $stage='new-login';Assert-OwnerRotationAuthority $Authorization $Context Forward
  if(-not(Test-LocalOwnerLogin $newCode $Context.ForwardDeadline 30)){throw 'ROTATION_REJECTED'};$result.newLoginVerified=$true
  if(-not(Test-OwnerRotationRuntime $Authorization $Context.ForwardDeadline)){throw 'ROTATION_REJECTED'}
  $stage='before-commit';Assert-OwnerRotationAuthority $Authorization $Context Forward
  Assert-OwnerRotationDatabase -Authorization $Authorization -Context $Context
  if((& $Checkpoint 'before-commit') -ne $true){throw 'ROTATION_REJECTED'}
  Assert-OwnerRotationAuthority $Authorization $Context Forward
  $result.complete=$true
 } catch {
  if(-not $result.failureCode){$result.failureCode=if($stage -eq 'approval'){'ROTATION_SCOPE_REQUIRED'}else{'ROTATION_REJECTED'}};$result.failedStage=$stage
  if($Context.Replaced){
   $result.rollbackAttempted=$true;$result.failureCode='ROTATION_RECOVERY_FAILED';$result.failedStage='rollback'
   try{
    Assert-OwnerRotationAuthority $Authorization $Context Recovery
    if((Get-OwnerRotationHash $Context.ConfigPath) -cne $Context.CandidateHash -or (Get-OwnerRotationHash $Context.BackupPath) -cne $Context.OriginalHash -or (Test-Path -LiteralPath $Context.FailedPath)){throw 'ROTATION_RECOVERY_FAILED'}
    Assert-OwnerRotationProtectedPath -Path $Context.ConfigPath -OwnerSid $Authorization.ownerSid -OwnerProfile $Context.OwnerProfile;Assert-OwnerRotationProtectedPath -Path $Context.BackupPath -OwnerSid $Authorization.ownerSid -OwnerProfile $Context.OwnerProfile
    [IO.File]::Replace($Context.BackupPath,$Context.ConfigPath,$Context.FailedPath,$true)
    if((Get-OwnerRotationHash $Context.ConfigPath) -cne $Context.OriginalHash -or (Get-OwnerRotationAclHash $Context.ConfigPath) -cne $Context.ConfigAclHash){throw 'ROTATION_RECOVERY_FAILED'}
    Restart-OwnerRotationTask $Context $Context.RecoveryDeadline
    if(-not(Test-LocalOwnerLogin $originalCode $Context.RecoveryDeadline 30)){throw 'ROTATION_RECOVERY_FAILED'};$result.oldLoginVerified=$true
    if(-not(Test-OwnerRotationRuntime $Authorization $Context.RecoveryDeadline)){throw 'ROTATION_RECOVERY_FAILED'}
    Assert-OwnerRotationDatabase -Authorization $Authorization -Context $Context
    if((& $Checkpoint 'after-rollback') -ne $true){throw 'ROTATION_RECOVERY_FAILED'}
    Assert-OwnerRotationAuthority $Authorization $Context Recovery
    $result.rollbackVerified=$true;$result.failureCode='ROTATION_FAILED_RECOVERED'
   }catch{}
  }
 } finally {
  if($candidateCreated -and (Test-Path -LiteralPath $Context.CandidatePath)){
   try{Assert-OwnerRotationProtectedPath -Path $Context.CandidatePath -OwnerSid $Authorization.ownerSid -OwnerProfile $Context.OwnerProfile;if(-not $Context.CandidateHash){throw 'ROTATION_CLEANUP_FAILED'};if((Get-OwnerRotationHash $Context.CandidatePath) -cne $Context.CandidateHash){throw 'ROTATION_CLEANUP_FAILED'};Remove-Item -LiteralPath $Context.CandidatePath -Force -ErrorAction Stop}catch{$result.cleanupFailed=$true;$result.complete=$false;$result.failureCode='ROTATION_CLEANUP_FAILED';$result.failedStage='cleanup'}
  }
  $newCode=$null;$originalCode=$null;$candidateJson=$null;$candidate=$null;$encrypted=$null
 }
 return $result
}
function Invoke-OwnerRotationMain {
 param([switch]$Apply,[string]$AuthorizationPath,[scriptblock]$Checkpoint,[switch]$Controlled)
 if(-not $Apply){return 'PLAN ONLY: Owner-local credential rotation requires a separate, unexpired issue:1218 approval receipt. No credential or task was changed.'}
 $ErrorActionPreference='Stop';Set-StrictMode -Version Latest;$env:PSModulePath=Join-Path $PSHOME 'Modules';$result=New-OwnerRotationResult;$stage='approval'
 try{
  $receipt=Get-OwnerRotationSafePath $AuthorizationPath;$receiptItem=Get-Item -LiteralPath $receipt -Force -ErrorAction Stop;if($receiptItem -isnot [IO.FileInfo] -or $receiptItem.Length -gt 65536){throw 'ROTATION_SCOPE_REQUIRED'};$receiptBytes=[IO.File]::ReadAllBytes($receipt);$authorization=[Text.Encoding]::UTF8.GetString($receiptBytes).TrimStart([char]0xfeff)|ConvertFrom-Json;$receiptSha=[Security.Cryptography.SHA256]::Create();try{$receiptHash=([BitConverter]::ToString($receiptSha.ComputeHash($receiptBytes))).Replace('-','').ToLowerInvariant()}finally{$receiptSha.Dispose()}
  $stage='context';$context=Get-OwnerRotationContext -Authorization $authorization -SourceRoot (Split-Path -Parent $PSScriptRoot) -AuthorizationPath $receipt -ReceiptHash $receiptHash
  if($Controlled -and $authorization.automationConfirmationApproval -ne $true){throw 'ROTATION_SCOPE_REQUIRED'}
  $stage='confirmation';$confirmation=Show-OwnerRotationConfirmation -Authorization $authorization -Context $context -Controlled:$Controlled;$context.Confirmed=$confirmation.confirmed;$context.WarningVerified=$confirmation.warning
  if(-not $context.Confirmed){$result.confirmationVerified=$false;$result.sessionInvalidationWarningVerified=$context.WarningVerified;$result.failureCode='ROTATION_CANCELLED';$result.failedStage='confirmation';return $result}
  $stage='configuration';Assert-OwnerRotationAuthority $authorization $context Forward
  $state=@{result=$null};$consumer={param($configuration) $state.result=Invoke-OwnerRotationTransaction -Authorization $authorization -Context $context -Configuration $configuration -Checkpoint $Checkpoint}.GetNewClosure()
  & (Join-Path $PSScriptRoot 'read-jarvis-production-config.ps1') -Path $context.ConfigPath -ConfigurationConsumer $consumer|Out-Null
  if(-not $state.result){throw 'ROTATION_REJECTED'};$result=$state.result
  try{Show-OwnerRotationResult -Result $result -Context $context -Controlled:$Controlled}catch{$result.complete=$false;$result.failureCode='ROTATION_REJECTED';$result.failedStage='result'}
 }catch{$result.complete=$false;$result.failureCode=if($stage -eq 'approval'){'ROTATION_SCOPE_REQUIRED'}else{'ROTATION_CONTEXT_UNAVAILABLE'};$result.failedStage=$stage}
 return $result
}
if($MyInvocation.InvocationName -ne '.') {
 if(-not $Apply){Invoke-OwnerRotationMain;exit 0}
 $result=Invoke-OwnerRotationMain -Apply -AuthorizationPath $AuthorizationPath
 if($result.complete){Write-Output 'Owner credential rotation verified locally. Preserve the encrypted backup until separately reviewed.';exit 0}
 if($result.failureCode -eq 'ROTATION_CANCELLED'){Write-Output 'Rotation cancelled; no credential changed.';exit 0}
 [Console]::Error.WriteLine('Owner credential rotation unavailable or failed. Check the local encrypted config and task before retrying.');exit 1
}
