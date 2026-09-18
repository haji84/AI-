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

Export-ModuleMember -Function Get-CodexRecoveryDecision, Test-CodexDesktopProcess
