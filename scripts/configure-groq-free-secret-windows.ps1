param(
  [switch]$SkipOpen
)

$ErrorActionPreference = 'Stop'
$SecretRoot = Join-Path $env:LOCALAPPDATA 'GORIQ\secrets'
$SecretPath = Join-Path $SecretRoot 'groq.dpapi'
$StatusPath = Join-Path $SecretRoot 'groq-status.json'
$Model = 'qwen/qwen3.8-27b'

New-Item -ItemType Directory -Force -Path $SecretRoot | Out-Null

if (-not $SkipOpen) {
  Write-Host 'Groq API Keys pageを開きます...'
  Start-Process 'https://console.groq.com/keys'
}

Write-Host ''
Write-Host '作成済みのGroq APIキーを貼り付けて Enter を押してください。'
Write-Host '入力内容は画面・GitHub・ログには表示されません。'
$secure = Read-Host 'Groq API key' -AsSecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
$plain = ''

try {
  $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
  if ([string]::IsNullOrWhiteSpace($plain)) { throw 'Groq API key is empty.' }

  $headers = @{ Authorization = "Bearer $plain" }
  try {
    $modelsResponse = Invoke-RestMethod -Uri 'https://api.groq.com/openai/v1/models' -Headers $headers -Method Get -TimeoutSec 20
  } catch {
    throw "Groq API key validation failed: $($_.Exception.Message)"
  }

  $models = @($modelsResponse.data | ForEach-Object { [string]$_.id })
  if ($Model -notin $models) {
    throw "Groq key is valid, but required model '$Model' is not available."
  }

  $encrypted = $secure | ConvertFrom-SecureString
  $tempPath = "$SecretPath.tmp.$PID"
  Set-Content -LiteralPath $tempPath -Value $encrypted -Encoding UTF8 -NoNewline
  Move-Item -LiteralPath $tempPath -Destination $SecretPath -Force
  attrib +H $SecretPath 2>$null

  $status = [ordered]@{
    configured = $true
    provider = 'groq'
    plan = 'free'
    model = $Model
    validatedAt = (Get-Date).ToUniversalTime().ToString('o')
    secretPath = $SecretPath
  }
  $status | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $StatusPath -Encoding UTF8

  Write-Host ''
  Write-Host '✓ Groq Free Plan API key validated.'
  Write-Host '✓ Windows DPAPIで暗号化してZBook内へ保存しました。'
  Write-Host '✓ GitHub CLIは不要です。'
  Write-Host "✓ Stage 7 model: $Model"
} finally {
  if ($bstr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
  $plain = $null
  $secure = $null
  $headers = $null
  Remove-Variable encrypted -ErrorAction SilentlyContinue
}
