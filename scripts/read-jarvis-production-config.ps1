param(
  [Parameter(Mandatory=$true)][string]$Path,
  [switch]$OwnerLoginCode,
  [scriptblock]$OwnerLoginCodeConsumer,
  [scriptblock]$ConfigurationConsumer
)
$ErrorActionPreference = 'Stop'
$env:PSModulePath = Join-Path $PSHOME 'Modules'
try {
  $encrypted = Get-Content -LiteralPath $Path -Raw
  $secure = ConvertTo-SecureString $encrypted.Trim()
  $credential = New-Object System.Management.Automation.PSCredential('config', $secure)
  $plaintext = $credential.GetNetworkCredential().Password
  if ($OwnerLoginCode -and $null -ne $ConfigurationConsumer) { throw 'unavailable' }
  if ($OwnerLoginCode) {
    if ($null -eq $OwnerLoginCodeConsumer) { throw 'unavailable' }
    $configuration = $plaintext | ConvertFrom-Json
    if ($configuration -isnot [pscustomobject] -or
        $configuration.environment -isnot [pscustomobject] -or
        $configuration.environment.JARVIS_OWNER_SECRET -isnot [string]) {
      throw 'unavailable'
    }
    $ownerCode = $configuration.environment.JARVIS_OWNER_SECRET
    if ([string]::IsNullOrWhiteSpace($ownerCode) -or $ownerCode.Length -lt 24 -or $ownerCode -match "[\r\n\0]") {
      throw 'unavailable'
    }
    # Keep the selected secret inside this PowerShell process. The caller must
    # consume it locally; owner-code mode never writes it to stdout.
    & $OwnerLoginCodeConsumer $ownerCode | Out-Null
  } elseif ($null -ne $ConfigurationConsumer) {
    $configuration = $plaintext | ConvertFrom-Json
    if ($configuration -isnot [pscustomobject] -or $configuration.environment -isnot [pscustomobject]) { throw 'unavailable' }
    & $ConfigurationConsumer $configuration | Out-Null
  } else {
    [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
    [Console]::Write($plaintext)
  }
} catch {
  if ($OwnerLoginCode -or $null -ne $ConfigurationConsumer) { throw 'Protected configuration unavailable for this Windows identity.' }
  [Console]::Error.WriteLine('Protected configuration unavailable for this Windows identity.')
  exit 1
} finally {
  $plaintext = $null
  $ownerCode = $null
  $configuration = $null
  $credential = $null
  $secure = $null
  $encrypted = $null
}
