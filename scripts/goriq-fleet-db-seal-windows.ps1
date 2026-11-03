$ErrorActionPreference = 'Stop'
$env:PSModulePath = Join-Path $PSHOME 'Modules'
$configPath = Join-Path $env:USERPROFILE 'JARVIS/production/config.dpapi'
if (-not (Test-Path -LiteralPath $configPath)) { throw 'Protected Production configuration unavailable' }
try {
  $encrypted = Get-Content -LiteralPath $configPath -Raw
  $secure = ConvertTo-SecureString $encrypted.Trim()
  $credential = New-Object System.Management.Automation.PSCredential('config', $secure)
  $plaintext = $credential.GetNetworkCredential().Password
  $configuration = $plaintext | ConvertFrom-Json
  $candidate = [string]$configuration.environment.JARVIS_DB_PATH
  if ([string]::IsNullOrWhiteSpace($candidate) -or -not (Test-Path -LiteralPath $candidate)) {
    throw 'Protected Production Broker DB unavailable'
  }
  $env:GORIQ_SOURCE_DB_PATH = $candidate
  node scripts/goriq-fleet-db-migration.mjs seal
  if ($LASTEXITCODE -ne 0) { throw 'Fleet DB sealing failed' }
} finally {
  $env:GORIQ_SOURCE_DB_PATH = $null
  $candidate = $null
  $configuration = $null
  $plaintext = $null
  $credential = $null
  $secure = $null
  $encrypted = $null
}
