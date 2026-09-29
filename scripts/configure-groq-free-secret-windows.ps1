param(
  [switch]$SkipOpen
)

$ErrorActionPreference = 'Stop'
$SecretRoot = Join-Path $env:LOCALAPPDATA 'GORIQ\secrets'
$SecretPath = Join-Path $SecretRoot 'groq.dpapi'
$StatusPath = Join-Path $SecretRoot 'groq-status.json'
$Model = 'qwen/qwen3.8-27b'

New-Item -ItemType Directory -Force -Path $SecretRoot | Out-Null

function Get-WindowsClipboardText {
  Add-Type -AssemblyName System.Windows.Forms -ErrorAction Stop

  for ($attempt = 1; $attempt -le 10; $attempt++) {
    try {
      if ([System.Windows.Forms.Clipboard]::ContainsText()) {
        $text = [System.Windows.Forms.Clipboard]::GetText([System.Windows.Forms.TextDataFormat]::UnicodeText)
        if (-not [string]::IsNullOrWhiteSpace($text)) {
          return [string]$text
        }
      }
    } catch {
      if ($attempt -eq 10) { throw }
    }

    Start-Sleep -Milliseconds 100
  }

  return ''
}

function Clear-WindowsClipboard {
  try {
    Add-Type -AssemblyName System.Windows.Forms -ErrorAction Stop
    [System.Windows.Forms.Clipboard]::Clear()
  } catch {
    $setClipboard = Get-Command -Name 'Set-Clipboard' -ErrorAction SilentlyContinue
    if ($null -ne $setClipboard) {
      Set-Clipboard -Value '' -ErrorAction SilentlyContinue
    }
  }
}

function Test-VSCodeTerminal {
  return (
    [string]$env:TERM_PROGRAM -eq 'vscode' -or
    -not [string]::IsNullOrWhiteSpace([string]$env:VSCODE_PID) -or
    -not [string]::IsNullOrWhiteSpace([string]$env:VSCODE_CWD)
  )
}

function Wait-ForGroqClipboardKey {
  param([int]$TimeoutSeconds = 120)

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  $warnedNonGroq = $false

  while ((Get-Date) -lt $deadline) {
    try {
      $candidate = Get-WindowsClipboardText
      if (-not [string]::IsNullOrWhiteSpace($candidate)) {
        $candidate = $candidate.Trim()
        $candidate = [Text.RegularExpressions.Regex]::Replace($candidate, '[\p{Cc}\p{Cf}\p{Z}\s]+', '')

        if ($candidate.StartsWith('gsk_', [StringComparison]::Ordinal)) {
          return $candidate
        }

        if (-not $warnedNonGroq) {
          Write-Host 'Clipboard does not contain a Groq API key yet. Copy the full key in the Groq Console.'
          $warnedNonGroq = $true
        }
      }
    } catch {}

    Start-Sleep -Milliseconds 250
  }

  return ''
}

if (-not $SkipOpen) {
  Write-Host 'Opening Groq API Keys page...'
  Start-Process 'https://console.groq.com/keys'
}

Write-Host ''
$isVSCodeTerminal = Test-VSCodeTerminal
if ($isVSCodeTerminal) {
  Write-Host 'VSCode terminal detected.'
  Write-Host 'Open the Groq API Keys page and copy the full key. This terminal will detect it automatically.'
  Write-Host 'Do not paste the key into the terminal.'
} else {
  Write-Host 'Copy only the Groq API key to the Windows clipboard, then press Enter here.'
}
Write-Host 'The key will not be printed or logged. The clipboard will be cleared after capture.'

$secure = $null
$bstr = [IntPtr]::Zero
$plain = ''
$normalizedSecure = $null
$clipboardCaptured = $false

try {
  if ($isVSCodeTerminal) {
    $plain = Wait-ForGroqClipboardKey -TimeoutSeconds 120
    if (-not [string]::IsNullOrWhiteSpace($plain)) {
      $clipboardCaptured = $true
      Clear-WindowsClipboard
      Write-Host 'Groq key detected from Windows clipboard.'
    }
  } else {
    [void](Read-Host 'Press Enter after copying the key')
    try {
      $plain = Get-WindowsClipboardText
      if (-not [string]::IsNullOrWhiteSpace($plain)) {
        $clipboardCaptured = $true
        Clear-WindowsClipboard
      }
    } catch {
      Write-Host 'Windows clipboard direct read failed; falling back to PowerShell clipboard access.'
      $getClipboard = Get-Command -Name 'Get-Clipboard' -ErrorAction SilentlyContinue
      if ($null -ne $getClipboard) {
        try {
          $plain = [string](Get-Clipboard -Raw -ErrorAction Stop)
          if (-not [string]::IsNullOrWhiteSpace($plain)) {
            $clipboardCaptured = $true
            Clear-WindowsClipboard
          }
        } catch {
          $plain = ''
        }
      }
    }
  }

  if (-not $clipboardCaptured) {
    if ($isVSCodeTerminal) {
      throw 'No Groq API key was detected within 120 seconds. Copy a full gsk_ key in the Groq Console and run the command again.'
    }

    Write-Host 'Clipboard capture was unavailable. Falling back to secure console input.'
    Write-Host 'For the fallback prompt, use right-click paste instead of Ctrl+V.'
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

  if (-not $plain.StartsWith('gsk_', [StringComparison]::Ordinal)) {
    throw 'Captured text is not a Groq secret key: expected a value beginning with gsk_. Create/copy a Groq API key and try again.'
  }

  $normalizedSecure = ConvertTo-SecureString -String $plain -AsPlainText -Force
  $headers = @{ Authorization = "Bearer $plain" }
  try {
    $modelsResponse = Invoke-RestMethod -Uri 'https://api.groq.com/openai/v1/models' -Headers $headers -Method Get -TimeoutSec 20
  } catch {
    $statusCode = $null
    try { $statusCode = [int]$_.Exception.Response.StatusCode } catch {}
    if ($statusCode -eq 401) {
      throw 'Groq rejected this API key with HTTP 401. Create a new Groq API key in the Groq Console, copy the full secret value, and try again.'
    }
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
  Write-Host '✓ Stored locally with Windows DPAPI encryption.'
  Write-Host '✓ GitHub CLI is not required.'
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
