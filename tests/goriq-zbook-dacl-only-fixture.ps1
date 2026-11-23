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

    [DllImport("advapi32.dll", EntryPoint = "SetFileSecurityW", CharSet = CharSet.Unicode,
        ExactSpelling = true, SetLastError = true)]
    static extern bool SetFileSecurity(string path, uint information, IntPtr descriptor);

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

    public static void WriteDacl(SafeFileHandle handle, string path, string text, uint securityInformation, bool usePathApi) {
        IntPtr descriptor = IntPtr.Zero;
        uint length;
        try {
            if (!ParseDescriptor(text, 1, out descriptor, out length)) throw new InvalidOperationException("DESCRIPTOR_PARSE");
            IntPtr dacl;
            bool present, defaulted;
            if (!GetSecurityDescriptorDacl(descriptor, out present, out dacl, out defaulted)
                || !present || dacl == IntPtr.Zero || Marshal.ReadInt16(dacl, 4) <= 0)
                throw new InvalidOperationException("DACL_MISSING");
            if (usePathApi) {
                if (!SetFileSecurity(path, securityInformation, descriptor))
                    throw new InvalidOperationException("SET_PATH_" + Marshal.GetLastWin32Error());
            } else {
                int status = NtSetSecurityObject(handle, securityInformation, descriptor);
                if (status != 0) throw new InvalidOperationException("SET_" + unchecked((uint)status).ToString("X8"));
            }
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

function Get-DaclBytes($descriptor) {
  $acl = $descriptor.DiscretionaryAcl
  $bytes = New-Object byte[] $acl.BinaryLength
  $acl.GetBinaryForm($bytes, 0)
  [Convert]::ToBase64String($bytes)
}

function Compare-Descriptor([string]$expectedText, [string]$actualText) {
  $expected = New-Object Security.AccessControl.RawSecurityDescriptor($expectedText)
  $actual = New-Object Security.AccessControl.RawSecurityDescriptor($actualText)
  [ordered]@{
    ExpectedFlags = [int]$expected.ControlFlags
    ActualFlags = [int]$actual.ControlFlags
    DaclEqual = (Get-DaclBytes $expected) -ceq (Get-DaclBytes $actual)
    OwnerAndGroupEqual = $expected.Owner.Equals($actual.Owner) -and $expected.Group.Equals($actual.Group)
    AuditEqual = $expected.GetSddlForm('Audit') -ceq $actual.GetSddlForm('Audit')
  }
}

function Test-DaclOnly(
  [string]$mode,
  [uint32]$applyInformation,
  [uint32]$restoreInformation,
  [bool]$usePathApi = $false,
  [bool]$requestRollbackInheritance = $false,
  [bool]$useExistingControl = $false
) {
  $fixture = Join-Path ([IO.Path]::GetTempPath()) ('goriq-dacl-only-test-' + [guid]::NewGuid().ToString('N'))
  $null = New-Item -ItemType Directory -Path $fixture -ErrorAction Stop
  $nativeCwd = [Environment]::CurrentDirectory
  $writer = $null
  $pin = $null
  $stage = 'baseline'
  $details = $null
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
    $expected = $wanted
    if (-not $useExistingControl) {
      # The previous Windows run found precisely one change to descriptor metadata:
      # the kernel clears the auto-inherited flag when writing the protected DACL.
      $raw = New-Object Security.AccessControl.RawSecurityDescriptor($wanted)
      $raw.SetFlags([Security.AccessControl.ControlFlags]([int]$raw.ControlFlags -band (-bnot 0x0400)))
      $expected = $raw.GetSddlForm([Security.AccessControl.AccessControlSections]::All)
    }
    $restoreText = $original
    if ($requestRollbackInheritance) {
      $raw = New-Object Security.AccessControl.RawSecurityDescriptor($original)
      $raw.SetFlags([Security.AccessControl.ControlFlags]([int]$raw.ControlFlags -bor 0x0100))
      $restoreText = $raw.GetSddlForm([Security.AccessControl.AccessControlSections]::All)
    }

    $stage = 'native-cwd'
    if (-not $useExistingControl) {
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
    }

    $stage = 'dacl-only-open'
    $pin = [GoriqFixedAclNative]::Open($child, $false, $true)
    $writer = if ($useExistingControl) {
      [GoriqFixedAclNative]::Open($target, $true, $true)
    } else {
      [GoriqDaclOnlyFixture]::OpenDacl($target)
    }
    if ([GoriqFixedAclNative]::Identity($writer) -cne $fileId) { throw 'OBJECT_IDENTITY_CHANGED' }

    $stage = 'forward'
    if ($useExistingControl) { [GoriqFixedAclNative]::Apply($writer, $wanted) }
    else { [GoriqDaclOnlyFixture]::WriteDacl($writer, $target, $wanted, $applyInformation, $usePathApi) }
    $actual = Read-Sddl $target
    $details = Compare-Descriptor $expected $actual
    foreach ($path in $fixedObjects) { if ((Read-Sddl $path) -cne $before[$path]) { throw 'FORWARD_PROPAGATED' } }
    if ($actual -cne $expected) { throw 'FORWARD_DESCRIPTOR_MISMATCH' }

    $stage = 'rollback'
    if ($useExistingControl) { [GoriqFixedAclNative]::Apply($writer, $original) }
    else { [GoriqDaclOnlyFixture]::WriteDacl($writer, $target, $restoreText, $restoreInformation, $usePathApi) }
    $actual = Read-Sddl $target
    $details = Compare-Descriptor $original $actual
    foreach ($path in $fixedObjects) { if ((Read-Sddl $path) -cne $before[$path]) { throw 'ROLLBACK_PROPAGATED' } }
    if ($actual -cne $original) { throw 'ROLLBACK_DESCRIPTOR_MISMATCH' }
    if ([GoriqFixedAclNative]::PathIdentity($target) -cne $fileId -or (Get-FileHash -LiteralPath $file).Hash -cne $fileHash) {
      throw 'IDENTITY_OR_BYTES_CHANGED'
    }
    [pscustomobject]@{ Mode = $mode; Passed = $true; Stage = 'exact-rollback'; Reason = $null; Details = $details }
  } catch {
    $failure = $_.Exception
    while ($failure.InnerException) { $failure = $failure.InnerException }
    $reason = if ($failure.Message -cmatch '^[A-Z0-9_]{1,55}$') { $failure.Message } else { 'FIXTURE_ERROR' }
    [pscustomobject]@{ Mode = $mode; Passed = $false; Stage = $stage; Reason = $reason; Details = $details }
  } finally {
    if ($null -ne $writer) { $writer.Dispose() }
    if ($null -ne $pin) { $pin.Dispose() }
    [Environment]::CurrentDirectory = $nativeCwd
    Remove-Item -LiteralPath $fixture -Recurse -Force
  }
}

$results = @(
  Test-DaclOnly 'narrow-locked-restore' 2147483652 536870916
  Test-DaclOnly 'narrow-locked-restore-auto-inherit-request' 2147483652 536870916 $false $true
  Test-DaclOnly 'path-locked-restore-auto-inherit-request' 2147483652 536870916 $true $true
  Test-DaclOnly 'current-method-unlocked-control' 4 4 $false $false $true
)
$results | ForEach-Object { $_ | ConvertTo-Json -Depth 4 -Compress }
if (-not @($results | Where-Object { $_.Mode -cne 'current-method-unlocked-control' -and $_.Passed }).Count) {
  throw 'NO_NON_PROPAGATING_DACL_ONLY_PATH_PROVEN'
}
