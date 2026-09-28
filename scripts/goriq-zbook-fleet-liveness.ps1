param(
  [string]$OutputPath = ".gai-results/zbook-fleet-liveness.json"
)
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

function Write-SafeResult([hashtable]$result) {
  $directory = Split-Path -Parent $OutputPath
  if ($directory) { New-Item -ItemType Directory -Force -Path $directory | Out-Null }
  $json = $result | ConvertTo-Json -Depth 5 -Compress
  [IO.File]::WriteAllText((Join-Path (Get-Location) $OutputPath), $json + [Environment]::NewLine, (New-Object Text.UTF8Encoding($false)))
  Write-Output $json
}

try {
  $configCandidates = @(
    (Join-Path $env:USERPROFILE "JARVIS\production\config.dpapi"),
    (Join-Path $env:LOCALAPPDATA "JARVIS\production\config.dpapi")
  ) | Where-Object { $_ -and (Test-Path -LiteralPath $_) }

  if (-not $configCandidates -or $configCandidates.Count -eq 0) {
    Write-SafeResult @{ ok=$false; reason="protected_config_unavailable" }
    exit 1
  }

  $encrypted = Get-Content -LiteralPath $configCandidates[0] -Raw
  $secure = ConvertTo-SecureString $encrypted.Trim()
  $credential = New-Object System.Management.Automation.PSCredential("config", $secure)
  $plaintext = $credential.GetNetworkCredential().Password
  $configuration = $plaintext | ConvertFrom-Json
  if (-not $configuration.environment -or [string]::IsNullOrWhiteSpace([string]$configuration.environment.JARVIS_OWNER_TOKEN)) {
    Write-SafeResult @{ ok=$false; reason="protected_config_invalid" }
    exit 1
  }

  $token = [string]$configuration.environment.JARVIS_OWNER_TOKEN
  $headers = @{ Authorization = "Bearer $token" }
  $brokerHealthy = $false
  $state = $null
  try {
    $health = Invoke-RestMethod -UseBasicParsing -TimeoutSec 5 -Uri "http://127.0.0.1:8787/health"
    $brokerHealthy = ($health.ok -eq $true -or $health.service -eq "jarvis-broker")
    $state = Invoke-RestMethod -UseBasicParsing -TimeoutSec 5 -Headers $headers -Uri "http://127.0.0.1:8787/api/jarvis/admin/state"
  } catch {
    Write-SafeResult @{
      ok=$false
      reason="local_broker_unavailable"
      brokerHealthy=$brokerHealthy
      workerIngressListening=(@(Get-NetTCPConnection -State Listen -LocalPort 8792 -ErrorAction SilentlyContinue).Count -gt 0)
      productionTaskState=[string](Get-ScheduledTask -TaskName "JARVIS Remote Host" -ErrorAction SilentlyContinue).State
      configuredCommit=if ($configuration.commit -match "^[a-f0-9]{40}$") { [string]$configuration.commit } else { "unknown" }
    }
    exit 1
  }

  $fleet = @($state.fleet)
  $android = @($fleet | Where-Object { $_.kind -eq "android" })
  $now = [DateTimeOffset]::UtcNow
  $freshnessMs = 60000
  $ages = @()
  $fresh = 0
  foreach ($device in $android) {
    if ($device.lastSeenAt) {
      try {
        $age = [Math]::Max(0, [int64]($now - [DateTimeOffset]::Parse([string]$device.lastSeenAt)).TotalMilliseconds)
        $ages += $age
        if ($age -le $freshnessMs) { $fresh++ }
      } catch {}
    }
  }
  $newestAge = if ($ages.Count -gt 0) { [int64](($ages | Measure-Object -Minimum).Minimum) } else { $null }

  $task = Get-ScheduledTask -TaskName "JARVIS Remote Host" -ErrorAction SilentlyContinue
  Write-SafeResult @{
    ok=$true
    brokerHealthy=$brokerHealthy
    registeredTotal=$fleet.Count
    androidRegistered=$android.Count
    androidFresh=$fresh
    newestAndroidHeartbeatAgeMs=$newestAge
    freshnessMs=$freshnessMs
    workerIngressListening=(@(Get-NetTCPConnection -State Listen -LocalPort 8792 -ErrorAction SilentlyContinue).Count -gt 0)
    productionTaskState=if ($task) { [string]$task.State } else { "Missing" }
    configuredCommit=if ($configuration.commit -match "^[a-f0-9]{40}$") { [string]$configuration.commit } else { "unknown" }
    checkedAt=$now.ToString("o")
  }
} catch {
  Write-SafeResult @{ ok=$false; reason="diagnostic_failed" }
  exit 1
} finally {
  $token=$null; $headers=$null; $plaintext=$null; $configuration=$null; $credential=$null; $secure=$null; $encrypted=$null
}
