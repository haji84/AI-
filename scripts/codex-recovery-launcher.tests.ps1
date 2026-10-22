$ErrorActionPreference = 'Stop'
if (-not (Test-Path "$PSScriptRoot/codex-recovery-launcher.cs")) { throw 'FAIL: console-free launcher source missing' }
$root = Join-Path $env:TEMP ('codex-launcher-tests-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $root | Out-Null
$exe = Join-Path $root 'CodexRecoveryLauncher.exe'
Add-Type -Path "$PSScriptRoot/codex-recovery-launcher.cs" -OutputAssembly $exe -OutputType WindowsApplication
$bytes = [IO.File]::ReadAllBytes($exe)
$pe = [BitConverter]::ToInt32($bytes, 0x3c)
if ([BitConverter]::ToUInt16($bytes, $pe + 24 + 68) -ne 2) { throw 'FAIL: launcher is not a Windows GUI binary' }
@'
param($Action, $StateRoot)
Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class ConsoleProbe { [DllImport("kernel32.dll")] public static extern IntPtr GetConsoleWindow(); }'
@{ console = [ConsoleProbe]::GetConsoleWindow().ToInt64(); action = $Action } | ConvertTo-Json | Set-Content (Join-Path $StateRoot 'console-probe.json')
Write-Output 'stdout-captured'
[Console]::Error.WriteLine('stderr-captured')
exit 7
'@ | Set-Content (Join-Path $root 'codex-recovery.ps1')
$process = Start-Process -FilePath $exe -ArgumentList Check -PassThru -Wait -WindowStyle Hidden
if ($process.ExitCode -ne 7) { throw 'FAIL: child exit code not propagated' }
$probe = Get-Content (Join-Path $root 'console-probe.json') -Raw | ConvertFrom-Json
if ($probe.console -ne 0 -or $probe.action -ne 'Check') { throw 'FAIL: child has a console or wrong action' }
$output = Get-Content (Join-Path $root 'launcher-Check.log') -Raw
if ($output -notmatch 'stdout-captured' -or $output -notmatch 'stderr-captured') { throw 'FAIL: output not captured' }
$process = Start-Process -FilePath $exe -ArgumentList Invalid -PassThru -Wait -WindowStyle Hidden
if ($process.ExitCode -ne 64) { throw 'FAIL: unsupported action not rejected' }
Write-Output 'PASS: GUI subsystem, no child console, action, output, exit propagation, invalid-action rejection'
