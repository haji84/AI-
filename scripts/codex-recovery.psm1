Set-StrictMode -Version Latest

function Test-CodexDesktopProcess {
  param($Process, [int]$SessionId)
  return ($Process.SessionId -eq $SessionId -and
    $Process.ExecutablePath -match '^C:\\Program Files\\WindowsApps\\OpenAI\.Codex_[^\\]+__2p2nqsd0c76g0\\app\\(?:ChatGPT|Codex)\.exe$' -and
    -not [string]::IsNullOrWhiteSpace($Process.CommandLine) -and
    $Process.CommandLine -notmatch '(?:^|\s)--type(?:=|\s)')
}

function Get-CodexRecoveryDecision {
  param([hashtable]$State, [bool]$Running, [string]$ProcessKey, [datetime]$Now)
  foreach ($key in @('attempts', 'paused', 'runningSince', 'processKey')) {
    if (-not $State.ContainsKey($key)) { throw 'Invalid recovery state: missing field' }
  }
  if ($State.attempts -isnot [int] -or $State.attempts -lt 0 -or $State.attempts -gt 3 -or $State.paused -isnot [bool]) {
    throw 'Invalid recovery state: invalid retry budget or pause flag'
  }
  $next = $State.Clone()
  $action = 'healthy'
  if ($next.paused) { $action = 'paused' }
  elseif ($Running) {
    if ([string]::IsNullOrEmpty($ProcessKey)) { throw 'Invalid recovery state: missing process identity' }
    if ($next.processKey -ne $ProcessKey -or -not $next.runningSince) {
      $next.runningSince = $Now.ToUniversalTime().ToString('o')
      $next.processKey = $ProcessKey
    }
    if (($Now.ToUniversalTime() - [datetime]::Parse($next.runningSince).ToUniversalTime()).TotalSeconds -ge 300) {
      $next.attempts = 0
    }
  } else {
    $next.runningSince = $null
    $next.processKey = $null
    if ($next.attempts -ge 3) { $action = 'blocked' }
    else { $next.attempts++; $action = 'launch' }
  }
  return @{ action = $action; state = $next }
}

function Invoke-CodexDesktopRestart {
  param(
    [Parameter(Mandatory)][scriptblock]$Probe,
    [Parameter(Mandatory)][scriptblock]$Close,
    [Parameter(Mandatory)][scriptblock]$ForceStop,
    [Parameter(Mandatory)][scriptblock]$Activate,
    [Parameter(Mandatory)][scriptblock]$Wait
  )
  $parents = @(& $Probe)
  if ($parents.Count -gt 1) { throw 'Multiple desktop parents; refusing ambiguous restart.' }
  $oldKey = $null
  if ($parents.Count -eq 1) {
    $original = $parents[0]
    $oldKey = $original.Key
    & $Close $original
    for ($i = 0; $i -lt 10; $i++) {
      $parents = @(& $Probe)
      if (@($parents | Where-Object { $_.Key -eq $oldKey }).Count -eq 0) { break }
      & $Wait 1
    }
    $parents = @(& $Probe)
    if (@($parents | Where-Object { $_.Key -eq $oldKey }).Count -gt 0) {
      # The OS adapter revalidates PID, creation time, path and session before stopping.
      & $ForceStop $original
      for ($i = 0; $i -lt 5; $i++) {
        $parents = @(& $Probe)
        if (@($parents | Where-Object { $_.Key -eq $oldKey }).Count -eq 0) { break }
        & $Wait 1
      }
    }
    $parents = @(& $Probe)
    if (@($parents | Where-Object { $_.Key -eq $oldKey }).Count -gt 0) { throw 'Original desktop still running; restart aborted.' }
  }
  $parents = @(& $Probe)
  if ($parents.Count -gt 1) { throw 'Multiple desktop parents after close; refusing activation.' }
  # A manual/new app instance that appeared during shutdown already satisfies restart.
  if ($parents.Count -eq 0) {
    & $Activate
    for ($i = 0; $i -lt 20; $i++) {
      $parents = @(& $Probe)
      if ($parents.Count -gt 0) { break }
      & $Wait 1
    }
  }
  if ($parents.Count -ne 1 -or $parents[0].Key -eq $oldKey) { throw 'Replacement desktop not observed; restart not verified.' }
  return @{ oldKey = $oldKey; newKey = $parents[0].Key }
}

Export-ModuleMember -Function Get-CodexRecoveryDecision, Test-CodexDesktopProcess, Invoke-CodexDesktopRestart
