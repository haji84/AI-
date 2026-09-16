param([Parameter(Mandatory=$true)][string]$Path)
$ErrorActionPreference = 'Stop'
$env:PSModulePath = Join-Path $PSHOME 'Modules'
try {
  $encrypted = Get-Content -LiteralPath $Path -Raw
  $secure = ConvertTo-SecureString $encrypted.Trim()
  $credential = New-Object System.Management.Automation.PSCredential('config', $secure)
  [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
  [Console]::Write($credential.GetNetworkCredential().Password)
} catch {
  [Console]::Error.WriteLine('Protected configuration unavailable for this Windows identity.')
  exit 1
}
