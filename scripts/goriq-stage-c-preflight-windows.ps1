param([string]$OutputPath = '.gai-results/stage-c/preflight.json')
$ErrorActionPreference = 'Stop'
$keys = @('JARVIS_REMOTE_ALLOWED_SERIALS','JARVIS_OWNER_TOKEN')
$previous = @{}
foreach ($key in $keys) { $previous[$key] = [Environment]::GetEnvironmentVariable($key,'Process') }
try {
  $configPaths = @(
    (Join-Path $env:USERPROFILE 'JARVIS\production\config.dpapi'),
    (Join-Path $env:LOCALAPPDATA 'JARVIS\production\config.dpapi')
  )
  $configPath = $configPaths | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
  if ($configPath) {
    $secure = ConvertTo-SecureString (Get-Content -LiteralPath $configPath -Raw).Trim()
    $credential = New-Object System.Management.Automation.PSCredential('config',$secure)
    $configuration = $credential.GetNetworkCredential().Password | ConvertFrom-Json
    foreach ($key in $keys) {
      $value = [string]$configuration.environment.$key
      if ($value) { [Environment]::SetEnvironmentVariable($key,$value,'Process') }
    }
  }
  & node scripts/goriq-stage-c-preflight.mjs $OutputPath
  $resultExit = $LASTEXITCODE
} catch {
  $directory = Split-Path -Parent $OutputPath
  if ($directory) { New-Item -ItemType Directory -Force -Path $directory | Out-Null }
  $result = @{schemaVersion=1;goalIssue=1650;readOnly=$true;preflightComplete=$false;physicalAcceptance='BLOCKED';reason='protected_config_unavailable';checkedAt=[DateTimeOffset]::UtcNow.ToString('o')}
  $result | ConvertTo-Json | Set-Content -Encoding UTF8 $OutputPath
  $resultExit = 1
} finally {
  foreach ($key in $keys) { [Environment]::SetEnvironmentVariable($key,$previous[$key],'Process') }
  $configuration=$null; $credential=$null; $secure=$null; $value=$null
}
exit $resultExit
