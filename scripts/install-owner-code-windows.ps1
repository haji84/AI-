[CmdletBinding()]
param([switch]$Apply, [string]$Version, [switch]$StartMenu)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest

function Get-OwnerCodeInstallPath([string]$Path) {
 if ([string]::IsNullOrWhiteSpace($Path) -or $Path -match '[\r\n\0]' -or
     $Path -match '^[\\/]{2}' -or -not [IO.Path]::IsPathRooted($Path)) { throw 'LOCAL_PATH_REQUIRED' }
 $windows=[IO.Path]::DirectorySeparatorChar -eq [char]92
 if ($windows -and $Path -notmatch '^[A-Za-z]:[\\/][^:]*$') { throw 'LOCAL_DRIVE_REQUIRED' }
 $full=[IO.Path]::GetFullPath($Path)
 $root=[IO.Path]::GetPathRoot($full)
 if ($windows -and ([IO.DriveInfo]::new($root)).DriveType -ne [IO.DriveType]::Fixed) { throw 'FIXED_DRIVE_REQUIRED' }
 $item=Get-Item -LiteralPath $root -Force
 $current=$root
 foreach ($part in $full.Substring($root.Length).Split([IO.Path]::DirectorySeparatorChar)) {
  if (-not $part) { continue }
  if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'REPARSE_PATH' }
  $current=Join-Path $current $part
  try { $item=Get-Item -LiteralPath $current -Force } catch {
   if ($_.CategoryInfo.Category -eq [Management.Automation.ErrorCategory]::ObjectNotFound) { return $full }
   throw
  }
 }
 if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'REPARSE_PATH' }
 return $full
}

function Install-OwnerCodePackage {
 param([string]$SourceDirectory,[string]$DestinationDirectory,[string]$DesktopDirectory,[string]$Version,[ValidateSet('Desktop','StartMenu')][string]$LauncherKind='Desktop')
 if ($Version -cnotmatch '^[a-f0-9]{40}$') { throw 'EXACT_VERSION_REQUIRED' }
 $source=Get-OwnerCodeInstallPath $SourceDirectory
 $destination=Get-OwnerCodeInstallPath $DestinationDirectory
 $desktop=Get-OwnerCodeInstallPath $DesktopDirectory
 if ((Split-Path -Leaf $destination) -cne $Version) { throw 'VERSION_DIRECTORY_REQUIRED' }
 if (-not (Get-Item -LiteralPath $source).PSIsContainer -or -not (Get-Item -LiteralPath $desktop).PSIsContainer) { throw 'DIRECTORIES_REQUIRED' }
 $separator=[IO.Path]::DirectorySeparatorChar
 foreach ($other in @($source,$desktop)) {
  if ($destination.Equals($other,[StringComparison]::OrdinalIgnoreCase) -or
      $destination.StartsWith($other.TrimEnd($separator)+$separator,[StringComparison]::OrdinalIgnoreCase) -or
      $other.StartsWith($destination.TrimEnd($separator)+$separator,[StringComparison]::OrdinalIgnoreCase)) { throw 'OVERLAPPING_PATHS' }
 }
 $launcher=Get-OwnerCodeInstallPath (Join-Path $desktop 'GORIQ Owner Code.cmd')
 if ((Test-Path -LiteralPath $destination) -or (Test-Path -LiteralPath $launcher)) { throw 'REFUSE_OVERWRITE' }
 $pins=@{
  'owner-code-windows.ps1'='e8f0fe68f5ca8c6d8f5056299c1e805e05663d6782e744a69692ee5512262f43'
  'read-jarvis-production-config.ps1'='252f057b933ddd16c8eec85507fd43b084cf9f0cdba1ded93746ad5e199cccb5'
 }
 $files=@()
 foreach ($name in @('owner-code-windows.ps1','read-jarvis-production-config.ps1')) {
  $path=Get-OwnerCodeInstallPath (Join-Path $source $name)
  $item=Get-Item -LiteralPath $path -Force
  if ($item -isnot [IO.FileInfo] -or $item.Length -gt 262144) { throw 'PUBLIC_SOURCE_REQUIRED' }
  $bytes=[IO.File]::ReadAllBytes($path)
  $sha=[Security.Cryptography.SHA256]::Create()
  try { $digest=([BitConverter]::ToString($sha.ComputeHash($bytes))).Replace('-','').ToLowerInvariant() } finally { $sha.Dispose() }
  if ($digest -cne $pins[$name]) { throw 'UNREVIEWED_PUBLIC_SOURCE' }
  $files+=@{name=$name;bytes=$bytes}
 }
 $parent=Split-Path -Parent $destination
 [IO.Directory]::CreateDirectory($parent) | Out-Null
 Get-OwnerCodeInstallPath $parent | Out-Null
 $staging=Join-Path $parent ('.owner-code-'+[guid]::NewGuid().ToString('N')+'.tmp')
 New-Item -ItemType Directory -Path $staging | Out-Null
 $manifestFiles=@()
 foreach ($file in $files) {
  $path=Join-Path $staging $file.name
  $stream=[IO.File]::Open($path,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
  try { $stream.Write($file.bytes,0,$file.bytes.Length) } finally { $stream.Dispose() }
  $manifestFiles+=@{name=$file.name;sha256=(Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()}
 }
 $manifest=@{version=$Version;files=$manifestFiles} | ConvertTo-Json -Depth 4 -Compress
 [IO.File]::WriteAllText((Join-Path $staging 'manifest.json'),$manifest,(New-Object Text.UTF8Encoding($false)))
 # Local moves refuse existing targets and publish complete public artifacts.
 Get-OwnerCodeInstallPath $parent | Out-Null
 Get-OwnerCodeInstallPath $staging | Out-Null
 [IO.Directory]::Move($staging,$destination)
 $command='@echo off'+"`r`n"+'"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -STA -File "%USERPROFILE%\JARVIS\tools\owner-code\'+$Version+'\owner-code-windows.ps1"'+"`r`n"
 Get-OwnerCodeInstallPath $desktop | Out-Null
 $temporaryLauncher=Join-Path $desktop ('.owner-code-'+[guid]::NewGuid().ToString('N')+'.tmp')
 $stream=[IO.File]::Open($temporaryLauncher,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
 try { $bytes=[Text.Encoding]::ASCII.GetBytes($command); $stream.Write($bytes,0,$bytes.Length) } finally { $stream.Dispose() }
 [IO.File]::Move($temporaryLauncher,$launcher)
 return [pscustomobject]@{version=$Version;publicFilesInstalled=2;desktopLauncherInstalled=($LauncherKind -ceq 'Desktop');startMenuLauncherInstalled=($LauncherKind -ceq 'StartMenu');utilityExecuted=$false}
}

if ($MyInvocation.InvocationName -ne '.') {
 if (-not $Apply) {
  if ($StartMenu) { Write-Output 'PLAN ONLY: install two public Owner utility files and one same-Owner Start Menu launcher. No credential or Production state is accessed.' }
  else { Write-Output 'PLAN ONLY: install two public Owner utility files and one same-Owner Desktop launcher. No credential or Production state is accessed.' }
  exit 0
 }
 try {
  if ($env:OS -ne 'Windows_NT' -or [Security.Principal.WindowsIdentity]::GetCurrent().IsSystem) { throw 'WINDOWS_OWNER_REQUIRED' }
  $profile=Get-OwnerCodeInstallPath ([Environment]::GetFolderPath('UserProfile'))
  $launcherKind=if ($StartMenu) {'StartMenu'} else {'Desktop'}
  $folder=if ($StartMenu) {'Programs'} else {'DesktopDirectory'}
  $desktop=Get-OwnerCodeInstallPath ([Environment]::GetFolderPath($folder))
  if ($StartMenu -and $desktop -ine $profile -and -not $desktop.StartsWith($profile+'\',[StringComparison]::OrdinalIgnoreCase)) { throw 'OWNER_PROFILE_PATH_REQUIRED' }
  $windows=Get-OwnerCodeInstallPath ([Environment]::GetFolderPath('Windows'))
  if ($profile -ine [IO.Path]::GetFullPath($env:USERPROFILE) -or $windows -ine [IO.Path]::GetFullPath($env:SystemRoot)) { throw 'OWNER_ENVIRONMENT_MISMATCH' }
  $destination=Join-Path (Join-Path $profile 'JARVIS\tools\owner-code') $Version
  Install-OwnerCodePackage -SourceDirectory $PSScriptRoot -DestinationDirectory $destination -DesktopDirectory $desktop -Version $Version -LauncherKind $launcherKind | Out-Null
  Write-Output ('Owner utility public files and '+$launcherKind+' launcher installed. No credential was accessed or changed.')
 } catch {
  [Console]::Error.WriteLine('Owner utility installation unavailable. Existing files were not overwritten; retain any incomplete public staging files for review.')
  exit 1
 }
}
