param(
  [Parameter(Mandatory = $true)][string]$NodeScript,
  [string[]]$NodeArguments = @(),
  [switch]$RequireSecret
)

$ErrorActionPreference = 'Stop'
$SecretPath = Join-Path $env:LOCALAPPDATA 'GORIQ\secrets\groq.dpapi'
$plain = ''
$secure = $null
$credential = $null

try {
  if (Test-Path -LiteralPath $SecretPath) {
    $encrypted = (Get-Content -LiteralPath $SecretPath -Raw).Trim()
    if (-not [string]::IsNullOrWhiteSpace($encrypted)) {
      $secure = ConvertTo-SecureString $encrypted
      $credential = New-Object System.Management.Automation.PSCredential('groq', $secure)
      $plain = $credential.GetNetworkCredential().Password
    }
  }

  if ([string]::IsNullOrWhiteSpace($plain)) {
    if ($RequireSecret) { throw 'GORIQ_GROQ_LOCAL_SECRET_NOT_CONFIGURED' }
    Write-Host 'Groq local secret is not configured; Stage 7 will be skipped.'
    & node $NodeScript @NodeArguments
    exit $LASTEXITCODE
  }

  if ($env:GITHUB_ACTIONS -eq 'true') {
    Write-Output "::add-mask::$plain"
  }
  $env:GROQ_API_KEY = $plain
  & node $NodeScript @NodeArguments
  $code = $LASTEXITCODE
  exit $code
} finally {
  Remove-Item Env:GROQ_API_KEY -ErrorAction SilentlyContinue
  $plain = $null
  $credential = $null
  $secure = $null
  $encrypted = $null
}
