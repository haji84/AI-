param(
  [string]$RepoHint,
  [ValidateSet('Groq', 'Diagnose')]
  [string]$Task = 'Groq',
  [switch]$Force,
  [switch]$SkipOpen,
  [ValidateRange(1, 6)]
  [int]$SearchDepth = 4
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$localRoot = if ([string]::IsNullOrWhiteSpace($env:LOCALAPPDATA)) {
  Join-Path $HOME 'AppData\Local'
} else {
  $env:LOCALAPPDATA
}
$logRoot = Join-Path $localRoot 'GORIQ\logs'
New-Item -ItemType Directory -Force -Path $logRoot | Out-Null
$logPath = Join-Path $logRoot ("windows-bootstrap-{0:yyyyMMdd-HHmmss}-{1}.log" -f (Get-Date), $PID)
$originalLocation = (Get-Location).Path

function Write-BootstrapLog {
  param(
    [Parameter(Mandatory = $true)][string]$Message,
    [ValidateSet('INFO', 'WARN', 'ERROR', 'OK')][string]$Level = 'INFO'
  )

  $line = "{0:o} [{1}] {2}" -f (Get-Date), $Level, $Message
  Add-Content -LiteralPath $logPath -Value $line -Encoding UTF8

  switch ($Level) {
    'WARN' { Write-Host $Message -ForegroundColor Yellow }
    'ERROR' { Write-Host $Message -ForegroundColor Red }
    'OK' { Write-Host $Message -ForegroundColor Green }
    default { Write-Host $Message }
  }
}

function Test-GoriqRepoRoot {
  param([string]$Path)

  if ([string]::IsNullOrWhiteSpace($Path)) { return $false }

  try {
    $candidate = (Resolve-Path -LiteralPath $Path -ErrorAction Stop).Path
  } catch {
    return $false
  }

  $required = @(
    'AGENTS.md',
    'PROJECT_STATE.md',
    'scripts\configure-groq-free-secret-windows.ps1'
  )

  foreach ($item in $required) {
    if (-not (Test-Path -LiteralPath (Join-Path $candidate $item) -PathType Leaf)) {
      return $false
    }
  }

  return $true
}

function Get-AncestorPaths {
  param([string]$Path)

  if ([string]::IsNullOrWhiteSpace($Path)) { return @() }

  try {
    $current = Get-Item -LiteralPath (Resolve-Path -LiteralPath $Path -ErrorAction Stop).Path
  } catch {
    return @()
  }

  $results = New-Object System.Collections.Generic.List[string]
  if (-not $current.PSIsContainer) {
    $current = $current.Directory
  }

  while ($null -ne $current) {
    $results.Add($current.FullName)
    $current = $current.Parent
  }

  return $results.ToArray()
}

function Find-GoriqRepoRoot {
  param(
    [string]$Hint,
    [int]$MaxDepth
  )

  $startingPoints = New-Object System.Collections.Generic.List[string]
  $knownCandidates = New-Object System.Collections.Generic.List[string]

  foreach ($path in @(
    $Hint,
    $env:GORIQ_REPO_ROOT,
    $env:GITHUB_WORKSPACE,
    $PSScriptRoot,
    (Get-Location).Path,
    $HOME,
    'C:\actions-runner\_work\AI-\AI-',
    'C:\actions-runner\_work\AI-',
    'C:\actions-runner'
  )) {
    if (-not [string]::IsNullOrWhiteSpace($path) -and -not $knownCandidates.Contains($path)) {
      $knownCandidates.Add($path)
    }
  }

  $builderStatus = Join-Path $localRoot 'GAIWorker\code-builder\install-status.json'
  if (Test-Path -LiteralPath $builderStatus -PathType Leaf) {
    try {
      $builder = Get-Content -LiteralPath $builderStatus -Raw -Encoding UTF8 | ConvertFrom-Json
      if (-not [string]::IsNullOrWhiteSpace([string]$builder.workspace)) {
        $knownCandidates.Add([string]$builder.workspace)
      }
    } catch {
      Write-BootstrapLog -Level WARN -Message "Code-builder workspace status could not be read: $($_.Exception.Message)"
    }
  }

  foreach ($listener in @(Get-Process -Name 'Runner.Listener' -ErrorAction SilentlyContinue)) {
    try {
      if (-not [string]::IsNullOrWhiteSpace([string]$listener.Path)) {
        $runnerRoot = Split-Path -Parent $listener.Path
        foreach ($path in @($runnerRoot, (Join-Path $runnerRoot '_work'))) {
          if (-not $knownCandidates.Contains($path)) {
            $knownCandidates.Add($path)
          }
        }
      }
    } catch {}
  }

  foreach ($drive in @(Get-PSDrive -PSProvider FileSystem -ErrorAction SilentlyContinue)) {
    foreach ($relative in @('actions-runner', 'github-runner', 'AI-', 'GORIQ')) {
      try {
        $path = Join-Path $drive.Root $relative
        if ((Test-Path -LiteralPath $path -PathType Container) -and -not $knownCandidates.Contains($path)) {
          $knownCandidates.Add($path)
        }
      } catch {}
    }
  }

  foreach ($path in $knownCandidates) {
    if (-not [string]::IsNullOrWhiteSpace($path) -and -not $startingPoints.Contains($path)) {
      $startingPoints.Add($path)
    }
  }

  foreach ($start in $startingPoints) {
    foreach ($ancestor in (Get-AncestorPaths -Path $start)) {
      if (Test-GoriqRepoRoot -Path $ancestor) {
        return (Resolve-Path -LiteralPath $ancestor).Path
      }
    }
  }

  $searchRoots = New-Object System.Collections.Generic.List[string]
  $searchRootCandidates = @($knownCandidates.ToArray()) + @(
    $HOME,
    (Join-Path $HOME 'source'),
    (Join-Path $HOME 'repos'),
    (Join-Path $HOME 'dev'),
    (Join-Path $HOME 'projects'),
    (Join-Path $HOME 'Documents'),
    (Join-Path $HOME 'Desktop'),
    (Join-Path $HOME 'OneDrive')
  )
  foreach ($root in $searchRootCandidates) {
    if (-not [string]::IsNullOrWhiteSpace($root) -and
        (Test-Path -LiteralPath $root -PathType Container) -and
        -not $searchRoots.Contains($root)) {
      $searchRoots.Add($root)
    }
  }

  $excludedNames = @(
    '.git',
    '.pnpm-store',
    '.cache',
    'AppData',
    'node_modules'
  )

  foreach ($root in $searchRoots) {
    $queue = New-Object System.Collections.Queue
    $queue.Enqueue([pscustomobject]@{ Path = $root; Depth = 0 })

    while ($queue.Count -gt 0) {
      $item = $queue.Dequeue()

      if (Test-GoriqRepoRoot -Path $item.Path) {
        return (Resolve-Path -LiteralPath $item.Path).Path
      }

      if ($item.Depth -ge $MaxDepth) {
        continue
      }

      $children = Get-ChildItem -LiteralPath $item.Path -Directory -Force -ErrorAction SilentlyContinue
      foreach ($child in $children) {
        if ($child.Name -in $excludedNames) {
          continue
        }

        if ($child.Name -in @('AI-', 'GORIQ', 'goriq') -and (Test-GoriqRepoRoot -Path $child.FullName)) {
          return $child.FullName
        }

        $queue.Enqueue([pscustomobject]@{
          Path = $child.FullName
          Depth = $item.Depth + 1
        })
      }
    }
  }

  return $null
}

function Test-GroqConfigured {
  $secretRoot = Join-Path $localRoot 'GORIQ\secrets'
  $secretPath = Join-Path $secretRoot 'groq.dpapi'
  $statusPath = Join-Path $secretRoot 'groq-status.json'

  if (-not (Test-Path -LiteralPath $secretPath -PathType Leaf)) { return $false }
  if (-not (Test-Path -LiteralPath $statusPath -PathType Leaf)) { return $false }

  try {
    $status = Get-Content -LiteralPath $statusPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $secret = Get-Item -LiteralPath $secretPath

    return (
      $status.configured -eq $true -and
      [string]$status.provider -eq 'groq' -and
      $secret.Length -gt 0
    )
  } catch {
    Write-BootstrapLog -Level WARN -Message "Groq status could not be read: $($_.Exception.Message)"
    return $false
  }
}

try {
  Write-BootstrapLog -Message "GORIQ Windows bootstrap started. Task=$Task"

  $repoRoot = Find-GoriqRepoRoot -Hint $RepoHint -MaxDepth $SearchDepth
  if ([string]::IsNullOrWhiteSpace($repoRoot)) {
    throw "GORIQ repository was not found in the known Windows user, runner, or fixed-drive locations. Retry with -RepoHint only if this PC keeps the repository in a custom location."
  }

  Write-BootstrapLog -Level OK -Message "Repository: $repoRoot"
  Set-Location -LiteralPath $repoRoot

  $gh = Get-Command -Name 'gh' -ErrorAction SilentlyContinue
  if ($null -eq $gh) {
    Write-BootstrapLog -Level WARN -Message 'GitHub CLI (gh) is not installed. It is not required for this bootstrap, so execution will continue.'
  } else {
    Write-BootstrapLog -Message "Optional GitHub CLI detected: $($gh.Source)"
  }

  $target = Join-Path $repoRoot 'scripts\configure-groq-free-secret-windows.ps1'
  if (-not (Test-Path -LiteralPath $target -PathType Leaf)) {
    throw "Required script is missing: $target"
  }

  if ($Task -eq 'Diagnose') {
    Write-BootstrapLog -Level OK -Message 'Diagnosis completed. Repository and required Windows setup script are available.'
    Write-BootstrapLog -Message "Log: $logPath"
    return
  }

  if ((Test-GroqConfigured) -and -not $Force) {
    Write-BootstrapLog -Level OK -Message 'Groq is already configured locally. Secret re-entry was skipped.'
    Write-BootstrapLog -Message 'Use -Force only when you intentionally want to replace/revalidate the stored key.'
    Write-BootstrapLog -Message "Log: $logPath"
    return
  }

  Write-BootstrapLog -Message 'Groq is not configured locally, or -Force was requested. Starting the existing secure configurator.'
  if ($SkipOpen) {
    & $target -SkipOpen
  } else {
    & $target
  }

  if (-not (Test-GroqConfigured)) {
    throw 'Groq configurator returned without a valid local configuration marker.'
  }

  Write-BootstrapLog -Level OK -Message 'GORIQ Windows bootstrap completed successfully.'
  Write-BootstrapLog -Message "Log: $logPath"
} catch {
  Write-BootstrapLog -Level ERROR -Message "Bootstrap failed: $($_.Exception.Message)"
  Write-BootstrapLog -Message "Log: $logPath"
  throw
} finally {
  if (-not [string]::IsNullOrWhiteSpace($originalLocation) -and
      (Test-Path -LiteralPath $originalLocation -PathType Container)) {
    Set-Location -LiteralPath $originalLocation
  }
}
