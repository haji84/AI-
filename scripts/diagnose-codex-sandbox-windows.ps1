param(
  [string]$OutputPath = '.gai-results/codex-sandbox-diagnostic.json'
)

$ErrorActionPreference = 'Stop'
New-Item -ItemType Directory -Force -Path (Split-Path $OutputPath -Parent) | Out-Null

function Invoke-Capture {
  param(
    [string]$Label,
    [string]$FilePath,
    [string[]]$ArgumentList
  )
  try {
    $output = (& $FilePath @ArgumentList 2>&1 | Out-String).Trim()
    $code = $LASTEXITCODE
    return [ordered]@{ label=$Label; exitCode=$code; output=$output }
  } catch {
    return [ordered]@{ label=$Label; exitCode=-1; output=$_.Exception.Message }
  }
}

function Safe-ConfigMatches {
  param([string]$Path)
  if (-not (Test-Path $Path)) {
    return [ordered]@{ path=$Path; exists=$false; matches=@() }
  }
  $safePattern = 'sandbox_mode|approval_policy|trust_level|allowed_sandbox_modes|guardian|requirements|windows|workspace-write|read-only'
  $matches = Select-String -Path $Path -Pattern $safePattern -CaseSensitive:$false -ErrorAction SilentlyContinue |
    ForEach-Object {
      $line = $_.Line.Trim()
      # redact quoted/string values while preserving the key and structural signal
      $line = $line -replace '(?i)(token|secret|api[_-]?key|password)\s*=.*$', '$1 = <redacted>'
      if ($line.Length -gt 240) { $line = $line.Substring(0,240) }
      [ordered]@{ lineNumber=$_.LineNumber; line=$line }
    }
  return [ordered]@{ path=$Path; exists=$true; matches=@($matches) }
}

$homeDir = $env:USERPROFILE
$repo = $env:GITHUB_WORKSPACE

$configCandidates = @(
  (Join-Path $homeDir '.codex\config.toml'),
  (Join-Path $homeDir '.codex\requirements.toml'),
  (Join-Path $repo '.codex\config.toml'),
  (Join-Path $repo '.codex\requirements.toml'),
  'C:\ProgramData\OpenAI\Codex\config.toml',
  'C:\ProgramData\OpenAI\Codex\requirements.toml'
)

$results = [ordered]@{
  checkedAt = (Get-Date).ToUniversalTime().ToString('o')
  machine = $env:COMPUTERNAME
  user = $env:USERNAME
  workspace = $repo
  codexPath = (Get-Command codex -ErrorAction SilentlyContinue).Source
  version = Invoke-Capture -Label 'codex-version' -FilePath 'cmd.exe' -ArgumentList @('/d','/c','codex --version')
  loginStatus = Invoke-Capture -Label 'codex-login-status' -FilePath 'cmd.exe' -ArgumentList @('/d','/c','codex login status')
  help = Invoke-Capture -Label 'codex-help' -FilePath 'cmd.exe' -ArgumentList @('/d','/c','codex --help')
  execHelp = Invoke-Capture -Label 'codex-exec-help' -FilePath 'cmd.exe' -ArgumentList @('/d','/c','codex exec --help')
  configs = @($configCandidates | ForEach-Object { Safe-ConfigMatches -Path $_ })
}

# One no-op probe. It must not modify files. Capture the session header to prove effective sandbox.
$probePrompt = 'Do not modify files. Report the effective sandbox mode shown for this session and exit.'
$probe = Invoke-Capture -Label 'workspace-write-probe' -FilePath 'cmd.exe' -ArgumentList @(
  '/d','/c',
  ('codex exec --sandbox workspace-write --ephemeral --ignore-user-config --ignore-rules "' + $probePrompt + '"')
)
$results.probe = $probe

$results | ConvertTo-Json -Depth 8 | Set-Content -Encoding UTF8 $OutputPath
$results | ConvertTo-Json -Depth 8
