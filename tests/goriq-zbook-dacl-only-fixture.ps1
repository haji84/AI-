param([switch]$CompileOnly)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

# This experiment creates and modifies only a new temporary Windows directory.
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;

public static class GoriqDaclOnlyFixture {
    [DllImport("kernel32.dll", EntryPoint = "CreateFileW", CharSet = CharSet.Unicode,
        ExactSpelling = true, SetLastError = true)]
    static extern SafeFileHandle CreateFile(string path, uint access, uint share,
        IntPtr security, uint disposition, uint flags, IntPtr template);

    [DllImport("advapi32.dll", EntryPoint = "ConvertStringSecurityDescriptorToSecurityDescriptorW",
        CharSet = CharSet.Unicode, ExactSpelling = true, SetLastError = true)]
    static extern bool ParseDescriptor(string text, uint revision, out IntPtr descriptor, out uint length);

    [DllImport("advapi32.dll", ExactSpelling = true, SetLastError = true)]
    static extern bool GetSecurityDescriptorDacl(IntPtr descriptor, out bool present, out IntPtr dacl, out bool defaulted);

    [DllImport("ntdll.dll", ExactSpelling = true)]
    static extern int NtSetSecurityObject(SafeFileHandle file, uint information, IntPtr descriptor);

    [DllImport("kernel32.dll", ExactSpelling = true)]
    static extern IntPtr LocalFree(IntPtr pointer);

    public static SafeFileHandle OpenDacl(string path) {
        var handle = CreateFile(path, 0x00060080, 7, IntPtr.Zero, 3, 0x02200000, IntPtr.Zero);
        if (handle.IsInvalid) {
            int code = Marshal.GetLastWin32Error();
            handle.Dispose();
            throw new InvalidOperationException("DACL_ONLY_OPEN_" + code);
        }
        return handle;
    }

    public static void WriteDacl(SafeFileHandle handle, string text, uint securityInformation) {
        IntPtr descriptor = IntPtr.Zero;
        uint length;
        try {
            if (!ParseDescriptor(text, 1, out descriptor, out length)) throw new InvalidOperationException("DESCRIPTOR_PARSE");
            IntPtr dacl;
            bool present, defaulted;
            if (!GetSecurityDescriptorDacl(descriptor, out present, out dacl, out defaulted)
                || !present || dacl == IntPtr.Zero || Marshal.ReadInt16(dacl, 4) <= 0)
                throw new InvalidOperationException("DACL_MISSING");
            int status = NtSetSecurityObject(handle, securityInformation, descriptor);
            if (status != 0) throw new InvalidOperationException("SET_" + unchecked((uint)status).ToString("X8"));
        } finally {
            if (descriptor != IntPtr.Zero) LocalFree(descriptor);
        }
    }
}
'@
if ($CompileOnly) { Write-Output 'DACL_ONLY_FIXTURE_COMPILE_PASS'; return }
if ($env:OS -ne 'Windows_NT') { throw 'FIXTURE_REQUIRES_WINDOWS' }

$helper = Join-Path $PSScriptRoot '..\scripts\goriq-zbook-fixed-acl-repair.ps1'
$tokens = $null
$parseErrors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($helper, [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count) { throw 'FIXTURE_SOURCE_PARSE' }
foreach ($name in @('Initialize-FixedNative', 'New-FixedDescriptor')) {
  $definition = $ast.Find({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq $name }, $true)
  if (-not $definition) { throw 'FIXTURE_SOURCE_MISSING' }
  Invoke-Expression $definition.Extent.Text
}
Initialize-FixedNative
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$reader = 'S-1-1-0'

function Read-Sddl([string]$path) {
  (Get-Acl -LiteralPath $path -Audit).GetSecurityDescriptorSddlForm([Security.AccessControl.AccessControlSections]::All)
}

function Test-DaclOnly([string]$mode, [uint32]$applyInformation, [uint32]$restoreInformation) {
  $fixture = Join-Path ([IO.Path]::GetTempPath()) ('goriq-dacl-only-test-' + [guid]::NewGuid().ToString('N'))
  $null = New-Item -ItemType Directory -Path $fixture -ErrorAction Stop
  $nativeCwd = [Environment]::CurrentDirectory
  $writer = $null
  $stage = 'baseline'
  try {
    $acl = New-Object Security.AccessControl.DirectorySecurity
    $acl.SetOwner($identity.User)
    $acl.SetAccessRuleProtection($true, $false)
    foreach ($sid in @($identity.User.Value, 'S-1-5-18')) {
      $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule(
        (New-Object Security.Principal.SecurityIdentifier($sid)), 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')))
    }
    $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule(
      (New-Object Security.Principal.SecurityIdentifier($reader)), 'ReadAndExecute,Synchronize', 'ContainerInherit,ObjectInherit', 'None', 'Allow')))
    $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule(
      (New-Object Security.Principal.SecurityIdentifier('S-1-5-21-1-2-3-1001')), 'WriteData', 'ContainerInherit,ObjectInherit', 'None', 'Deny')))
    $acl.AddAuditRule((New-Object Security.AccessControl.FileSystemAuditRule(
      $identity.User, 'ReadData', 'ContainerInherit,ObjectInherit', 'None', 'Success')))
    Set-Acl -LiteralPath $fixture -AclObject $acl
    $target = Join-Path $fixture 'release'
    $child = Join-Path $target 'dependencies'
    $sibling = Join-Path $fixture 'other-release'
    foreach ($directory in @($target, $child, $sibling)) { $null = New-Item -ItemType Directory -Path $directory }
    $owner = Get-Acl -LiteralPath $target -Audit
    $owner.SetOwner($identity.User)
    Set-Acl -LiteralPath $target -AclObject $owner
    $file = Join-Path $child 'fixture.txt'
    [IO.File]::WriteAllText($file, 'disposable fixture bytes')
    $fixedObjects = @($fixture, $child, $file, $sibling)
    $original = Read-Sddl $target
    $before = @{}
    foreach ($path in $fixedObjects) { $before[$path] = Read-Sddl $path }
    $fileHash = (Get-FileHash -LiteralPath $file).Hash
    $wanted = New-FixedDescriptor $original $identity.User.Value $reader $true
    $fileId = [GoriqFixedAclNative]::PathIdentity($target)

    $stage = 'native-cwd'
    [Environment]::CurrentDirectory = $target
    $blocked = $false
    try {
      $max = [GoriqFixedAclNative]::Open($target, $true, $true)
      $max.Dispose()
    } catch {
      $failure = $_.Exception
      while ($failure.InnerException) { $failure = $failure.InnerException }
      if ($failure.Message -cne 'HANDLE_REJECTED_32') { throw }
      $blocked = $true
    }
    if (-not $blocked) { throw 'EXPECTED_SHARING_32' }

    $stage = 'dacl-only-open'
    $writer = [GoriqDaclOnlyFixture]::OpenDacl($target)
    if ([GoriqFixedAclNative]::Identity($writer) -cne $fileId) { throw 'OBJECT_IDENTITY_CHANGED' }

    $stage = 'forward'
    [GoriqDaclOnlyFixture]::WriteDacl($writer, $wanted, $applyInformation)
    if ((Read-Sddl $target) -cne $wanted) { throw 'FORWARD_DESCRIPTOR_MISMATCH' }
    foreach ($path in $fixedObjects) { if ((Read-Sddl $path) -cne $before[$path]) { throw 'FORWARD_PROPAGATED' } }

    $stage = 'rollback'
    [GoriqDaclOnlyFixture]::WriteDacl($writer, $original, $restoreInformation)
    if ((Read-Sddl $target) -cne $original) { throw 'ROLLBACK_DESCRIPTOR_MISMATCH' }
    foreach ($path in $fixedObjects) { if ((Read-Sddl $path) -cne $before[$path]) { throw 'ROLLBACK_PROPAGATED' } }
    if ([GoriqFixedAclNative]::PathIdentity($target) -cne $fileId -or (Get-FileHash -LiteralPath $file).Hash -cne $fileHash) {
      throw 'IDENTITY_OR_BYTES_CHANGED'
    }
    [pscustomobject]@{ Mode = $mode; Passed = $true; Stage = 'exact-rollback'; Reason = $null }
  } catch {
    $failure = $_.Exception
    while ($failure.InnerException) { $failure = $failure.InnerException }
    $reason = if ($failure.Message -cmatch '^[A-Z0-9_]{1,55}$') { $failure.Message } else { 'FIXTURE_ERROR' }
    [pscustomobject]@{ Mode = $mode; Passed = $false; Stage = $stage; Reason = $reason }
  } finally {
    if ($null -ne $writer) { $writer.Dispose() }
    [Environment]::CurrentDirectory = $nativeCwd
    Remove-Item -LiteralPath $fixture -Recurse -Force
  }
}

$results = @(
  Test-DaclOnly 'descriptor-and-protection-bits' 2147483652 536870916
  Test-DaclOnly 'descriptor-control-bits' 4 4
)
$results | ForEach-Object { $_ | ConvertTo-Json -Compress }
if (-not ($results.Passed -contains $true)) { throw 'NO_NON_PROPAGATING_DACL_ONLY_PATH_PROVEN' }
