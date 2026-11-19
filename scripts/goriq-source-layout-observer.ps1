function Get-GoriqSourceLayoutCategory {
  param([string]$Location,[string]$Name,[bool]$Directory)
  if($Location -ceq 'SOURCE' -and $Directory -and [string]::Equals($Name,'self-development',[StringComparison]::OrdinalIgnoreCase)){return 'SELF_DEVELOPMENT'}
  if($Directory){return 'OTHER'}
  $root=@{
    'compass.sqlite'='COMPASS_DB';'compass.sqlite-wal'='COMPASS_WAL';'compass.sqlite-shm'='COMPASS_SHM';'compass.sqlite-journal'='COMPASS_JOURNAL'
    'state.sqlite'='BROKER_DB';'state.sqlite-wal'='BROKER_WAL';'state.sqlite-shm'='BROKER_SHM';'state.sqlite-journal'='BROKER_JOURNAL'
    'state.sqlite.pc-tasks.json'='PC_TASKS';'state.sqlite.pc-observations.json'='PC_OBSERVATIONS';'state.sqlite.pc-enrollment-approval.json'='PC_APPROVAL'
    'state.sqlite.invitation.json'='INVITATIONS';'state.sqlite.trusted-devices.json'='TRUSTED_DEVICES';'state.sqlite.google-owner.json'='GOOGLE_OWNER'
  }
  $side=@{'jobs.json'='JOBS';'change-sets.json'='CHANGE_SETS';'device-intake.json'='DEVICE_INTAKE'}
  $table=$null;if($Location -ceq 'SOURCE'){$table=$root}elseif($Location -ceq 'SELF_DEVELOPMENT'){$table=$side}
  if($null -ne $table -and $null -ne $Name){foreach($entry in $table.GetEnumerator()){if([string]::Equals([string]$entry.Key,$Name,[StringComparison]::OrdinalIgnoreCase)){return $entry.Value}}}
  return 'OTHER'
}

function New-GoriqSourceLayoutFailure {
  param([string]$Reason)
  [pscustomobject][ordered]@{version=1;status='REFUSED';reason=$Reason;entries=@();sourceCount=0;selfDevelopmentCount=0;unknownCount=0;consistency='LIVE_SAMPLED';contentRead=$false;permissionChanged=$false}
}

function ConvertFrom-GoriqSourceLayoutClosedJson {
  param([string]$Raw)
  if([string]::IsNullOrEmpty($Raw) -or $Raw.Length -gt 16384 -or $Raw.Contains('\') -or $Raw -cmatch '[\x00-\x1f\x7f-\uffff]'){throw 'REPORT_UNVERIFIED'}
  $r=ConvertFrom-Json -InputObject $Raw -ErrorAction Stop
  $keys=@('version','status','reason','entries','sourceCount','selfDevelopmentCount','unknownCount','consistency','contentRead','permissionChanged')
  if($null -eq $r -or $r -isnot [pscustomobject] -or @($r.PSObject.Properties.Name).Count -ne $keys.Count -or
     @($r.PSObject.Properties.Name|Where-Object {$_ -cnotin $keys}).Count -ne 0){throw 'REPORT_UNVERIFIED'}
  if(($r.version -isnot [int] -and $r.version -isnot [long]) -or $r.version -ne 1 -or $r.status -isnot [string] -or $r.status -cnotin @('OBSERVED','REFUSED') -or
     $r.reason -isnot [string] -or $r.consistency -isnot [string] -or $r.consistency -cne 'LIVE_SAMPLED' -or $r.contentRead -isnot [bool] -or $r.contentRead -or
     $r.permissionChanged -isnot [bool] -or $r.permissionChanged -or $r.entries -isnot [array] -or $r.entries.Count -gt 64){throw 'REPORT_UNVERIFIED'}
  foreach($key in @('sourceCount','selfDevelopmentCount','unknownCount')){
    if(($r.$key -isnot [int] -and $r.$key -isnot [long]) -or $r.$key -lt 0 -or $r.$key -gt 64){throw 'REPORT_UNVERIFIED'}
  }
  $root=@('COMPASS_DB','COMPASS_WAL','COMPASS_SHM','COMPASS_JOURNAL','BROKER_DB','BROKER_WAL','BROKER_SHM','BROKER_JOURNAL','PC_TASKS','PC_OBSERVATIONS','PC_APPROVAL','INVITATIONS','TRUSTED_DEVICES','GOOGLE_OWNER','SELF_DEVELOPMENT','OTHER')
  $side=@('JOBS','CHANGE_SETS','DEVICE_INTAKE','OTHER');$sourceCount=0;$sideCount=0;$unknown=0
  foreach($entry in $r.entries){
    if($null -eq $entry -or $entry -isnot [pscustomobject] -or @($entry.PSObject.Properties.Name).Count -ne 3 -or
       @($entry.PSObject.Properties.Name|Where-Object {$_ -cnotin @('location','category','kind')}).Count -ne 0 -or
       $entry.location -isnot [string] -or $entry.category -isnot [string] -or $entry.kind -isnot [string] -or
       $entry.location -cnotin @('SOURCE','SELF_DEVELOPMENT') -or $entry.kind -cnotin @('FILE','DIRECTORY')){throw 'REPORT_UNVERIFIED'}
    if($entry.location -ceq 'SOURCE'){$sourceCount++;if($entry.category -cnotin $root){throw 'REPORT_UNVERIFIED'}}
    else{$sideCount++;if($entry.category -cnotin $side){throw 'REPORT_UNVERIFIED'}}
    if($entry.category -ceq 'OTHER'){$unknown++}
    elseif(($entry.category -ceq 'SELF_DEVELOPMENT') -ne ($entry.kind -ceq 'DIRECTORY')){throw 'REPORT_UNVERIFIED'}
  }
  if($sourceCount -gt 32 -or $sideCount -gt 32 -or $r.sourceCount -ne $sourceCount -or $r.selfDevelopmentCount -ne $sideCount -or $r.unknownCount -ne $unknown){throw 'REPORT_UNVERIFIED'}
  if($r.status -ceq 'OBSERVED'){if($r.reason -cne 'NONE'){throw 'REPORT_UNVERIFIED'}}
  elseif($r.entries.Count -ne 0 -or $r.reason -cnotin @('CONTEXT_UNVERIFIED','SCOPE_EXPIRED','OBSERVATION_UNAVAILABLE','REPARSE_ENTRY','LAYOUT_BOUND','OBSERVATION_TIMEOUT','REPORT_UNVERIFIED')){throw 'REPORT_UNVERIFIED'}
  $canonical=$r|ConvertTo-Json -Depth 5 -Compress
  if(-not [string]::Equals($canonical,$Raw,[StringComparison]::Ordinal)){throw 'REPORT_UNVERIFIED'}
  return $canonical
}

function ConvertTo-GoriqSourceLayoutReport {
  param([object[]]$Rows)
  $entries=New-Object 'Collections.Generic.List[object]';$source=0;$side=0;$unknown=0
  foreach($row in $Rows){
    if($null -eq $row -or $row -isnot [pscustomobject]){throw 'REPORT_UNVERIFIED'}
    $keys=@($row.PSObject.Properties.Name)
    if($keys.Count -ne 3 -or @($keys|Where-Object {$_ -cnotin @('location','name','attributes')}).Count -ne 0 -or
       $row.location -isnot [string] -or $row.location -cnotin @('SOURCE','SELF_DEVELOPMENT') -or $row.name -isnot [string] -or
       ($row.attributes -isnot [int] -and $row.attributes -isnot [long]) -or $row.attributes -lt 0 -or $row.attributes -gt [uint32]::MaxValue){throw 'REPORT_UNVERIFIED'}
    if(($row.attributes -band 1024) -ne 0){throw 'REPARSE_ENTRY'}
    if($row.location -ceq 'SOURCE'){$source++}else{$side++}
    if($source -gt 32 -or $side -gt 32){throw 'LAYOUT_BOUND'}
    $directory=($row.attributes -band 16) -ne 0
    $category=Get-GoriqSourceLayoutCategory $row.location $row.name $directory
    if($category -ceq 'OTHER'){$unknown++}
    $entries.Add([pscustomobject][ordered]@{location=$row.location;category=$category;kind=$(if($directory){'DIRECTORY'}else{'FILE'})})
  }
  [pscustomobject][ordered]@{version=1;status='OBSERVED';reason='NONE';entries=@($entries.ToArray());sourceCount=$source;selfDevelopmentCount=$side;unknownCount=$unknown;consistency='LIVE_SAMPLED';contentRead=$false;permissionChanged=$false}
}

function Read-GoriqSourceLayoutDirectory {
  param([string]$Path,[string]$Location,[Diagnostics.Stopwatch]$Clock)
  if($Location -cnotin @('SOURCE','SELF_DEVELOPMENT')){throw 'CONTEXT_UNVERIFIED'}
  if(([IO.File]::GetAttributes($Path) -band [IO.FileAttributes]::ReparsePoint) -ne 0){throw 'REPARSE_ENTRY'}
  $iterator=[IO.Directory]::EnumerateFileSystemEntries($Path).GetEnumerator();$count=0
  try{
    while($true){
      if($Clock.ElapsedMilliseconds -ge 10000){throw 'OBSERVATION_TIMEOUT'}
      $next=$iterator.MoveNext()
      if($Clock.ElapsedMilliseconds -ge 10000){throw 'OBSERVATION_TIMEOUT'}
      if(-not $next){break}
      $count++;if($count -gt 32){throw 'LAYOUT_BOUND'}
      $attributes=[int][IO.File]::GetAttributes($iterator.Current)
      if(($attributes -band 1024) -ne 0){throw 'REPARSE_ENTRY'}
      [pscustomobject]@{location=$Location;name=[IO.Path]::GetFileName($iterator.Current);attributes=$attributes}
    }
  }finally{if($iterator -is [IDisposable]){$iterator.Dispose()}}
}

function Read-GoriqSourceLayoutTree {
  param([string]$Source,[Diagnostics.Stopwatch]$Clock,[string[]]$Chain)
  $rows=@(Read-GoriqSourceLayoutDirectory $Source 'SOURCE' $Clock)
  $side=Join-Path $Source 'self-development'
  $children=@($rows|Where-Object {[string]::Equals($_.name,'self-development',[StringComparison]::OrdinalIgnoreCase) -and ($_.attributes -band 16) -ne 0})
  if($children.Count -gt 1){throw 'REPORT_UNVERIFIED'}
  if($children.Count -eq 1){$rows+=@(Read-GoriqSourceLayoutDirectory $side 'SELF_DEVELOPMENT' $Clock)}
  foreach($path in $Chain){if(([IO.File]::GetAttributes($path) -band [IO.FileAttributes]::ReparsePoint) -ne 0){throw 'REPARSE_ENTRY'}}
  $report=ConvertTo-GoriqSourceLayoutReport $rows
  if($Clock.ElapsedMilliseconds -ge 10000){throw 'OBSERVATION_TIMEOUT'}
  return $report
}

function Invoke-GoriqSourceLayoutObservation {
  $failure='CONTEXT_UNVERIFIED'
  try{
    if([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT -or $env:RUNNER_OS -cne 'Windows' -or $env:OS -cne 'Windows_NT' -or
       $env:RUNNER_NAME -cne 'ZBook' -or $env:GITHUB_REPOSITORY -cne 'haji84/AI-' -or $env:GITHUB_ACTOR -cne 'haji84' -or
       $env:GITHUB_REF -cne 'refs/heads/main' -or $env:GITHUB_EVENT_NAME -cne 'workflow_dispatch' -or $env:GITHUB_ACTIONS -cne 'true' -or
       $env:GITHUB_TRIGGERING_ACTOR -cne 'haji84' -or $env:GITHUB_RUN_ATTEMPT -cne '1' -or
       $env:GITHUB_SHA -cnotmatch '^[a-f0-9]{40}\z' -or $PSVersionTable.PSVersion.Major -ne 5 -or
       $ExecutionContext.SessionState.LanguageMode -ne 'FullLanguage'){throw 'REFUSED'}
    if([datetimeoffset]::UtcNow -ge [datetimeoffset]::Parse('2026-11-20T06:00:00Z')){$failure='SCOPE_EXPIRED';throw 'REFUSED'}
    $moduleRoot=Join-Path $PSHOME 'Modules'
    foreach($module in @('Microsoft.PowerShell.Management','Microsoft.PowerShell.Security','CimCmdlets')){
      Import-Module -Name (Join-Path (Join-Path $moduleRoot $module) ($module+'.psd1')) -ErrorAction Stop
    }
    $fixed=Join-Path ([Environment]::GetFolderPath('System')) 'WindowsPowerShell\v1.0\powershell.exe'
    $signature=Get-AuthenticodeSignature -LiteralPath $fixed -ErrorAction Stop
    if($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch '(?:^|, )O=Microsoft Corporation(?:,|$)'){throw 'REFUSED'}
    $identity=[Security.Principal.WindowsIdentity]::GetCurrent()
    try{
      if($identity.IsSystem -or $identity.IsAnonymous -or $null -eq $identity.User -or $identity.ImpersonationLevel -in @('Impersonation','Delegation')){throw 'REFUSED'}
      $processes=@(Get-CimInstance Win32_Process -Filter "Name='Runner.Listener.exe'" -ErrorAction Stop)
      if($processes.Count -ne 1){throw 'REFUSED'}
      $owner=Invoke-CimMethod -InputObject $processes[0] -MethodName GetOwnerSid -ErrorAction Stop
      if($owner.ReturnValue -ne 0 -or $owner.Sid -cne $identity.User.Value){throw 'REFUSED'}
    }finally{if($null -ne $identity){$identity.Dispose()}}
    $profile=[Environment]::GetFolderPath('UserProfile');$local=[Environment]::GetFolderPath('LocalApplicationData')
    if($profile -cne $env:USERPROFILE -or $local -cne $env:LOCALAPPDATA -or $profile -cnotmatch '^[A-Za-z]:\\[^/\x00-\x1f]+\z' -or
       -not [string]::Equals($local,(Join-Path $profile 'AppData\Local'),[StringComparison]::OrdinalIgnoreCase)){throw 'REFUSED'}
    $source=Join-Path $local 'GAIWorker\goal-1218-bridge-state'
    $drive=New-Object IO.DriveInfo ([IO.Path]::GetPathRoot($source))
    if(-not $drive.IsReady -or $drive.DriveType -ne [IO.DriveType]::Fixed -or $drive.DriveFormat -cne 'NTFS'){throw 'REFUSED'}
    $chain=New-Object 'Collections.Generic.List[string]';$path=$source
    while($path.Length -gt 3){$chain.Add($path);$path=[IO.Path]::GetDirectoryName($path)}
    foreach($path in $chain){$a=[IO.File]::GetAttributes($path);if(($a -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or ($a -band [IO.FileAttributes]::Directory) -eq 0){throw 'REPARSE_ENTRY'}}
    $failure='OBSERVATION_UNAVAILABLE';$clock=[Diagnostics.Stopwatch]::StartNew()
    $report=Read-GoriqSourceLayoutTree $source $clock @($chain.ToArray())
    return ($report|ConvertTo-Json -Depth 5 -Compress)
  }catch{
    if($_.Exception.Message -cin @('REPARSE_ENTRY','LAYOUT_BOUND','OBSERVATION_TIMEOUT','REPORT_UNVERIFIED')){$failure=$_.Exception.Message}
    return (New-GoriqSourceLayoutFailure $failure|ConvertTo-Json -Depth 5 -Compress)
  }
}
