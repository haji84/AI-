param([string]$TaskName = 'JARVIS Remote Host')

# Read-only collection. Never print raw task actions to a log: they may contain secrets.
$ErrorActionPreference = 'Stop'
try {
  $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction Stop
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principalId = [string]$task.Principal.UserId
  $matches = $principalId -ieq $identity.Name -or $principalId -ieq $identity.User.Value
  [pscustomobject]@{
    State = [string]$task.State
    Settings = [pscustomobject]@{
      Enabled = $task.Settings.Enabled
      DisallowStartIfOnBatteries = $task.Settings.DisallowStartIfOnBatteries
      StopIfGoingOnBatteries = $task.Settings.StopIfGoingOnBatteries
      RunOnlyIfNetworkAvailable = $task.Settings.RunOnlyIfNetworkAvailable
      StartWhenAvailable = $task.Settings.StartWhenAvailable
      RestartCount = $task.Settings.RestartCount
      RestartInterval = [string]$task.Settings.RestartInterval
      ExecutionTimeLimit = [string]$task.Settings.ExecutionTimeLimit
      MultipleInstances = [string]$task.Settings.MultipleInstances
    }
    Principal = [pscustomobject]@{
      IdentityPresent = -not [string]::IsNullOrWhiteSpace($principalId)
      MatchesCurrentIdentity = $matches
      LogonType = [string]$task.Principal.LogonType
      RunLevel = [string]$task.Principal.RunLevel
    }
    Triggers = @($task.Triggers | ForEach-Object {
      [pscustomobject]@{ Type = $_.CimClass.CimClassName; Enabled = $_.Enabled }
    })
    Actions = @($task.Actions | ForEach-Object {
      [pscustomobject]@{ Execute = $_.Execute; Arguments = $_.Arguments; WorkingDirectory = $_.WorkingDirectory }
    })
  } | ConvertTo-Json -Depth 6 -Compress
} catch {
  # Do not emit exception text or task definitions, only an unavailable marker.
  [pscustomobject]@{ unavailable = $true } | ConvertTo-Json -Compress
  exit 2
}
