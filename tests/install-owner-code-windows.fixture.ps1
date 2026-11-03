param([Parameter(Mandatory=$true)][string]$InstallerPath,
 [ValidateSet('install','existing-package','existing-launcher','missing-reader','invalid-version','unsafe-paths','reparse-source','reparse-desktop','overlap')][string]$Case)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
. $InstallerPath
$temporary=Join-Path ([IO.Path]::GetTempPath()) ('owner-install-'+[guid]::NewGuid().ToString('N'))
$source=Join-Path $temporary 'source'
$desktop=Join-Path $temporary 'Desktop'
$version='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
$target=Join-Path (Join-Path $temporary 'tools') $version
$marker=Join-Path $temporary 'utility-executed'
function Assert-Fixture([bool]$Condition,[string]$Message) { if (-not $Condition) { throw $Message } }
function Refused($Arguments) { try { Install-OwnerCodePackage @Arguments | Out-Null; return $false } catch { return $true } }
try {
 New-Item -ItemType Directory -Path $source -Force | Out-Null
 New-Item -ItemType Directory -Path $desktop -Force | Out-Null
 $utility="[IO.File]::WriteAllText('"+$marker.Replace("'","''")+"','unexpected execution')"
 [IO.File]::WriteAllText((Join-Path $source 'owner-code-windows.ps1'),$utility)
 [IO.File]::WriteAllText((Join-Path $source 'read-jarvis-production-config.ps1'),'throw "public fixture must never execute"')
 [IO.File]::WriteAllText((Join-Path $source 'unrelated-token-store.txt'),'public fixture: never package this file')
 $arguments=@{SourceDirectory=$source;DestinationDirectory=$target;DesktopDirectory=$desktop;Version=$version}
 $launcher=Join-Path $desktop 'GORIQ Owner Code.cmd'
 switch ($Case) {
  'install' {
   Install-OwnerCodePackage @arguments | Out-Null
   $names=@(Get-ChildItem -LiteralPath $target -File | Select-Object -ExpandProperty Name | Sort-Object)
   Assert-Fixture (($names -join '|') -ceq 'manifest.json|owner-code-windows.ps1|read-jarvis-production-config.ps1') 'Only two public files and manifest may be installed'
   foreach ($name in @('owner-code-windows.ps1','read-jarvis-production-config.ps1')) {
    Assert-Fixture ((Get-FileHash (Join-Path $source $name)).Hash -ceq (Get-FileHash (Join-Path $target $name)).Hash) 'Public bytes changed'
   }
   $manifest=Get-Content (Join-Path $target 'manifest.json') -Raw | ConvertFrom-Json
   Assert-Fixture ($manifest.version -ceq $version -and @($manifest.files).Count -eq 2) 'Manifest binding missing'
   foreach ($entry in $manifest.files) { Assert-Fixture ($entry.sha256 -ieq (Get-FileHash (Join-Path $target $entry.name)).Hash) 'Manifest digest mismatch' }
   $bytes=[IO.File]::ReadAllBytes($launcher)
   Assert-Fixture (@($bytes | Where-Object {$_ -gt 127}).Count -eq 0) 'Launcher must be ASCII'
   $command=[IO.File]::ReadAllText($launcher)
   Assert-Fixture ($command.Contains('-NoProfile -STA -File') -and $command.Contains('%USERPROFILE%\JARVIS\tools\owner-code\'+$version+'\owner-code-windows.ps1')) 'Static graphical entry missing'
   Assert-Fixture ($command -notmatch 'Bypass|ExecutionPolicy|Apply|Reveal|Copy|config.dpapi') 'Launcher must open only default utility without privileged options'
   Assert-Fixture (@(Get-ChildItem $desktop -File).Count -eq 1) 'Only one Desktop entry'
  }
  'existing-package' {
   New-Item -ItemType Directory -Path $target -Force | Out-Null
   [IO.File]::WriteAllText((Join-Path $target 'existing.txt'),'preserve')
   Assert-Fixture (Refused $arguments) 'Existing version must be refused'
   Assert-Fixture ([IO.File]::ReadAllText((Join-Path $target 'existing.txt')) -ceq 'preserve') 'Existing package changed'
   Assert-Fixture (-not (Test-Path $launcher)) 'No launcher on refusal'
  }
  'existing-launcher' {
   [IO.File]::WriteAllText($launcher,'preserve existing launcher')
   Assert-Fixture (Refused $arguments) 'Existing launcher must be refused'
   Assert-Fixture ([IO.File]::ReadAllText($launcher) -ceq 'preserve existing launcher') 'Launcher overwritten'
   Assert-Fixture (-not (Test-Path $target)) 'No package on pre-existing launcher refusal'
  }
  'missing-reader' {
   Remove-Item (Join-Path $source 'read-jarvis-production-config.ps1')
   Assert-Fixture (Refused $arguments) 'Missing reader must be refused'
   Assert-Fixture (-not (Test-Path $target) -and -not (Test-Path $launcher)) 'Incomplete source published'
  }
  'invalid-version' {
   foreach ($bad in @('main','../escape',('A'*40),('a'*39),(('a'*40)+'&calc'))) {
    $arguments.Version=$bad; Assert-Fixture (Refused $arguments) 'Invalid version accepted'
   }
   Assert-Fixture (-not (Test-Path $target) -and -not (Test-Path $launcher)) 'Invalid version wrote files'
  }
  'unsafe-paths' {
   foreach ($bad in @('relative\tools','\\untrusted.invalid\share\tools','/\untrusted.invalid\share','C:\safe:stream','Z:\unavailable\tools')) {
    $arguments.DestinationDirectory=$bad; Assert-Fixture (Refused $arguments) 'Unsafe path accepted'
   }
   Assert-Fixture (-not (Test-Path $launcher)) 'Unsafe path published launcher'
  }
  'reparse-source' {
   $link=Join-Path $temporary 'source-link'
   New-Item -ItemType $(if ($env:OS -eq 'Windows_NT') {'Junction'} else {'SymbolicLink'}) -Path $link -Target $source | Out-Null
   $arguments.SourceDirectory=$link
   Assert-Fixture (Refused $arguments) 'Reparse source must be refused'
   Assert-Fixture (-not (Test-Path $target) -and -not (Test-Path $launcher)) 'Reparse source published'
  }
  'reparse-desktop' {
   $link=Join-Path $temporary 'desktop-link'
   New-Item -ItemType $(if ($env:OS -eq 'Windows_NT') {'Junction'} else {'SymbolicLink'}) -Path $link -Target $desktop | Out-Null
   $arguments.DesktopDirectory=$link
   Assert-Fixture (Refused $arguments) 'Reparse Desktop must be refused'
   Assert-Fixture (-not (Test-Path $target) -and -not (Test-Path $launcher)) 'Reparse Desktop published'
  }
  'overlap' {
   $arguments.DestinationDirectory=Join-Path $source $version
   Assert-Fixture (Refused $arguments) 'Source/destination overlap must be refused'
   $arguments.DestinationDirectory=Join-Path $desktop $version
   Assert-Fixture (Refused $arguments) 'Desktop/destination overlap must be refused'
   Assert-Fixture (-not (Test-Path $launcher)) 'Overlap published launcher'
  }
 }
 Assert-Fixture (-not (Test-Path $marker)) 'Installer executed the utility'
 @{case=$Case;passed=$true;utilityExecuted=$false;actualProductionUsed=$false} | ConvertTo-Json -Compress
} finally { if (Test-Path $temporary) { Remove-Item -LiteralPath $temporary -Recurse -Force } }
