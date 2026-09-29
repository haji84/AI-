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
Write-Host 'Groq APIキーだけをクリップボードへコピーしてから Enter を押してください。'
Write-Host 'キーは画面・GitHub・ログには表示しません。読み取り後はクリップボードを空にします。'

$secure = $null
$bstr = [IntPtr]::Zero
$plain = ''
$normalizedSecure = $null
$clipboardCaptured = $false

try {
  $getClipboard = Get-Command -Name 'Get-Clipboard' -ErrorAction SilentlyContinue
  if ($null -ne $getClipboard) {
    [void](Read-Host 'コピーできたら Enter')
    try {
      $plain = [string](Get-Clipboard -Raw -ErrorAction Stop)
      if (-not [string]::IsNullOrWhiteSpace($plain)) {
        $clipboardCaptured = $true
        $setClipboard = Get-Command -Name 'Set-Clipboard' -ErrorAction SilentlyContinue
        if ($null -ne $setClipboard) {
          Set-Clipboard -Value '' -ErrorAction SilentlyContinue
        }
      }
    } catch {
      $plain = ''
    }
  }

  if (-not $clipboardCaptured) {
    Write-Host 'クリップボードを読み取れなかったため、安全入力へ切り替えます。'
    Write-Host 'この入力欄では Ctrl+V ではなく、右クリック貼り付けを使用してください。'
    $secure = Read-Host 'Groq API key' -AsSecureString
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
  }

  if ([string]::IsNullOrWhiteSpace($plain)) { throw 'Groq API key input is empty.' }
  if ($plain.Length -gt 4096) { throw 'Clipboard content is too large to be a Groq API key. Copy only the raw key value and try again.' }

  $originalLength = $plain.Length
  $plain = $plain.Trim()
  if ([string]::IsNullOrWhiteSpace($plain)) { throw 'Groq API key is empty after trimming surrounding whitespace.' }

  $beforeInvisibleCleanupLength = $plain.Length
  $plain = [Text.RegularExpressions.Regex]::Replace($plain, '[\p{Cc}\p{Cf}\p{Z}\s]+', '')
  if ([string]::IsNullOrWhiteSpace($plain)) { throw 'Groq API key is empty after removing invisible characters.' }

  if ($plain -match '[^\x21-\x7E]') {
    throw 'Groq API key still contains unsupported visible non-ASCII characters. Copy only the raw key value and try again.'
  }

  if ($plain.Length -ne $originalLength -or $plain.Length -ne $beforeInvisibleCleanupLength) {
    Write-Host 'Invisible whitespace/control characters were removed from the pasted key.'
  }

  $normalizedSecure = ConvertTo-SecureString -String $plain -AsPlainText -Force
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

  $encrypted = $normalizedSecure | ConvertFrom-SecureString
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
  $normalizedSecure = $null
  $secure = $null
  $clipboardCaptured = $false
  $headers = $null
  Remove-Variable encrypted -ErrorAction SilentlyContinue
}
