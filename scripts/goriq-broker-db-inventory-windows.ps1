$ErrorActionPreference = 'Stop'
$configPath = Join-Path $env:USERPROFILE 'JARVIS/production/config.dpapi'
if (Test-Path -LiteralPath $configPath) {
  try {
    $encrypted = Get-Content -LiteralPath $configPath -Raw
    $secure = ConvertTo-SecureString $encrypted.Trim()
    $credential = New-Object System.Management.Automation.PSCredential('config', $secure)
    $plaintext = $credential.GetNetworkCredential().Password
    $configuration = $plaintext | ConvertFrom-Json
    $candidate = [string]$configuration.environment.JARVIS_DB_PATH
    if (-not [string]::IsNullOrWhiteSpace($candidate)) {
      $env:GORIQ_DB_CONFIGURED_PATH = $candidate
    }
  } catch {
    Write-Output '{"windowsProtectedConfig":"unavailable"}'
  } finally {
    $candidate = $null
    $configuration = $null
    $plaintext = $null
    $credential = $null
    $secure = $null
    $encrypted = $null
  }
}
node scripts/goriq-broker-db-inventory.mjs
