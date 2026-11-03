# Disposable-fixture probe only, never a production repair entry point.
# https://learn.microsoft.com/en-us/windows/win32/api/aclapi/nf-aclapi-setsecurityinfo
function Get-ProbeNarrowDescriptor([string]$descriptor,[string]$reader) {
  $raw=New-Object Security.AccessControl.RawSecurityDescriptor($descriptor)
  if($null -eq $raw.DiscretionaryAcl){throw 'PROBE_DACL_REJECTED'}
  $removed=0
  for($i=$raw.DiscretionaryAcl.Count-1;$i -ge 0;$i--){
    $ace=$raw.DiscretionaryAcl[$i]
    if($ace -is [Security.AccessControl.CommonAce] -and
      $ace.AceQualifier -eq [Security.AccessControl.AceQualifier]::AccessAllowed -and
      $ace.SecurityIdentifier.Value -ceq $reader){
      if($ace.AccessMask -ne 0x1200A9 -or ([int]$ace.AceFlags -band 0x10) -eq 0){throw 'PROBE_DACL_REJECTED'}
      $raw.DiscretionaryAcl.RemoveAce($i);$removed++;continue
    }
    $ace.AceFlags=[Security.AccessControl.AceFlags]([int]$ace.AceFlags -band (-bnot 0x10))
  }
  if($removed -ne 1 -or $raw.DiscretionaryAcl.Count -eq 0){throw 'PROBE_DACL_REJECTED'}
  $raw.SetFlags([Security.AccessControl.ControlFlags]([int]$raw.ControlFlags -bor 0x1000))
  return $raw.GetSddlForm([Security.AccessControl.AccessControlSections]::All)
}
if(-not ('GoriqNonPropagatingAclProbe' -as [type])){
  Add-Type -TypeDefinition @'
using System;
using System.IO;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;
public static class GoriqNonPropagatingAclProbe {
  public static string Root;
  [StructLayout(LayoutKind.Sequential)] struct Info {
    public uint Attributes; public System.Runtime.InteropServices.ComTypes.FILETIME Creation;
    public System.Runtime.InteropServices.ComTypes.FILETIME Access;
    public System.Runtime.InteropServices.ComTypes.FILETIME Write;
    public uint Volume, SizeHigh, SizeLow, Links, IndexHigh, IndexLow;
  }
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  static extern SafeFileHandle CreateFileW(string name, uint access, uint share, IntPtr security,
    uint disposition, uint flags, IntPtr template);
  [DllImport("kernel32.dll", SetLastError=true)]
  static extern bool GetFileInformationByHandle(SafeFileHandle handle, out Info info);
  [DllImport("advapi32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  static extern bool ConvertStringSecurityDescriptorToSecurityDescriptorW(string text, uint revision,
    out IntPtr descriptor, out uint length);
  [DllImport("advapi32.dll", SetLastError=true)]
  static extern bool GetSecurityDescriptorDacl(IntPtr descriptor, out bool present, out IntPtr dacl, out bool defaulted);
  [DllImport("advapi32.dll", SetLastError=true)]
  static extern bool GetSecurityDescriptorControl(IntPtr descriptor, out ushort control, out uint revision);
  [DllImport("advapi32.dll")]
  static extern uint SetSecurityInfo(SafeFileHandle handle, uint type, uint information,
    IntPtr owner, IntPtr group, IntPtr dacl, IntPtr sacl);
  [DllImport("kernel32.dll")] static extern IntPtr LocalFree(IntPtr memory);
  public static SafeFileHandle Open(string path) {
    string root=Path.GetFullPath(Root ?? "").TrimEnd('\\');
    if(!root.StartsWith(Path.GetFullPath(Path.GetTempPath()),StringComparison.OrdinalIgnoreCase) ||
      !System.Text.RegularExpressions.Regex.IsMatch(Path.GetFileName(root),@"^goriq-nonprop-probe-[a-f0-9]{32}$") ||
      !Path.GetFullPath(path).StartsWith(root+"\\",StringComparison.OrdinalIgnoreCase)) throw new Exception("PROBE_SCOPE_REJECTED");
    var handle=CreateFileW(path,0x02000000,7,IntPtr.Zero,3,0x02200000,IntPtr.Zero);
    Info info;
    if(handle.IsInvalid || !GetFileInformationByHandle(handle,out info)) {
      handle.Dispose(); throw new Exception("PROBE_HANDLE_REJECTED");
    }
    if((info.Attributes & 0x400)!=0 || ((info.Attributes & 0x10)==0 && info.Links!=1)) {
      handle.Dispose(); throw new Exception("PROBE_LINK_REJECTED");
    }
    return handle;
  }
  public static void Apply(SafeFileHandle handle, string text) {
    IntPtr descriptor=IntPtr.Zero, dacl; uint length, revision; bool present, defaulted; ushort control;
    try {
      if(!ConvertStringSecurityDescriptorToSecurityDescriptorW(text,1,out descriptor,out length) ||
        !GetSecurityDescriptorDacl(descriptor,out present,out dacl,out defaulted) || !present ||
        dacl==IntPtr.Zero || Marshal.ReadInt16(dacl,4)<=0 ||
        !GetSecurityDescriptorControl(descriptor,out control,out revision)) throw new Exception("PROBE_DACL_REJECTED");
      uint flags=4u | ((control & 0x1000)!=0 ? 0x80000000u : 0x20000000u);
      if(SetSecurityInfo(handle,1,flags,IntPtr.Zero,IntPtr.Zero,dacl,IntPtr.Zero)!=0) throw new Exception("PROBE_WRITE_REJECTED");
    } finally {if(descriptor!=IntPtr.Zero) LocalFree(descriptor);}
  }
}
'@
}
