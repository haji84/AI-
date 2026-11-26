Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'observe-private-owner.ps1')
$definition=(Get-Command Invoke-OwnerProbeObservation).Definition
$matches=[regex]::Matches($definition,"(?ms)^\s*\`$code=@'\r?\n(.*?)^'@")
if($matches.Count -ne 1){throw 'BOOTSTRAP_FIXTURE_EXTRACTION_FAILED'}
$code=$matches[0].Groups[1].Value
$code=$code.Replace('__FAILURE__',(New-OwnerProbeFailure 'NATIVE_BUILD_UNAVAILABLE')).Replace('__CONTEXT_FAILURE__',(New-OwnerProbeFailure 'NATIVE_CONTEXT_UNVERIFIED')).Replace('__UNSAFE_FAILURE__',(New-OwnerProbeFailure 'UNSAFE_PROFILE'))
$phases=@('NATIVE_MODULE_MANAGEMENT_UNAVAILABLE','NATIVE_MODULE_SECURITY_UNAVAILABLE','NATIVE_MODULE_UTILITY_UNAVAILABLE','NATIVE_SIGNATURE_UNAVAILABLE','NATIVE_SOURCE_UNAVAILABLE','NATIVE_ENTRY_UNAVAILABLE','NATIVE_BUILD_ACCESS_DENIED','NATIVE_BUILD_COMPILER_MISSING','NATIVE_BUILD_REFERENCE_UNAVAILABLE','NATIVE_BUILD_SOURCE_REJECTED')
foreach($phase in $phases){$code=$code.Replace(('__'+$phase+'__'),(New-OwnerProbeFailure $phase))}
$definitions=''
foreach($name in @('Test-OwnerProbeCanonical','Get-OwnerProbeCompilerAncestors','Test-OwnerProbeCompilerMetadata','Test-OwnerProbeCompilerWorkspace','Read-OwnerProbeNativeSource')){$definitions+='function '+$name+' {'+(Get-Command $name -CommandType Function).Definition+"}`n"}
$arguments='-NoLogo -NoProfile -NonInteractive -EncodedCommand '+[Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($definitions+$code))
if($arguments.Length+512 -ge 32767){throw 'BOOTSTRAP_WINDOWS_COMMAND_LINE_TOO_LONG'}
Write-Output ('PASS bootstrap_command_line_chars_'+$arguments.Length)
if($code.Contains('[Console]::OpenStandardInput()')){$code=$code.Replace('[Console]::OpenStandardInput()','$script:ownerBootstrapInputStream')}
$wire=(New-OwnerProbeFailure 'UNSUPPORTED_PLATFORM').Replace('"','""')
# This type is inert, even when the embedded production entry is reached.
$null=Add-Type -TypeDefinition ('public static class GoriqPrivateOwnerProbe { public static bool EntryFailure; public static string ObserveJson() { if(EntryFailure) throw new System.InvalidOperationException("PRIVATE_ENTRY_PATH"); return @"'+$wire+'"; } }')
$signatureModule=New-Module -Name Microsoft.PowerShell.Security -ScriptBlock {
 function Get-AuthenticodeSignature {
  param($LiteralPath,$ErrorAction)
  if($global:OwnerBootstrapScenario -ceq 'signature'){throw 'PRIVATE_SIGNATURE_PATH'}
  return [pscustomobject]@{Status='Valid';SignerCertificate=[pscustomobject]@{Subject='O=Microsoft Corporation'}}
 }
 Export-ModuleMember -Function Get-AuthenticodeSignature
}
Import-Module $signatureModule -Force
function Import-Module {
 param($Name,$ErrorAction)
 $module=[IO.Path]::GetFileNameWithoutExtension($Name)
 $script:imports+=@($module)
 if($global:OwnerBootstrapScenario -ceq $module){throw 'PRIVATE_MODULE_PATH'}
}
function Test-OwnerProbeCompilerWorkspace {param($Workspace);return $true}
function Add-Type {
 param($TypeDefinition,$Language,$ErrorAction)
 $script:builds++
 if($global:OwnerBootstrapScenario -ceq 'build'){throw 'PRIVATE_COMPILER_PATH'}
 if($global:OwnerBootstrapScenario -ceq 'build-access'){throw [UnauthorizedAccessException]::new('PRIVATE_COMPILER_PATH')}
 if($global:OwnerBootstrapScenario -ceq 'build-os-access'){throw [ComponentModel.Win32Exception]::new(5,'PRIVATE_COMPILER_PATH')}
 if($global:OwnerBootstrapScenario -ceq 'build-missing'){throw [ComponentModel.Win32Exception]::new(2,'PRIVATE_COMPILER_PATH')}
 if($global:OwnerBootstrapScenario -ceq 'build-reference'){throw 'PRIVATE_COMPILER_PATH error CS0246: PRIVATE_SOURCE'}
 if($global:OwnerBootstrapScenario -ceq 'build-source'){throw 'PRIVATE_COMPILER_PATH error CS1002: PRIVATE_SOURCE'}
}
$scenarios=[ordered]@{
 'Microsoft.PowerShell.Management'='NATIVE_MODULE_MANAGEMENT_UNAVAILABLE'
 'Microsoft.PowerShell.Security'='NATIVE_MODULE_SECURITY_UNAVAILABLE'
 'Microsoft.PowerShell.Utility'='NATIVE_MODULE_UTILITY_UNAVAILABLE'
 'signature'='NATIVE_SIGNATURE_UNAVAILABLE'
 'source'='NATIVE_SOURCE_BASE64_REJECTED'
 'source-bom'='UNSUPPORTED_PLATFORM'
 'build'='NATIVE_BUILD_UNAVAILABLE'
 'build-access'='NATIVE_BUILD_ACCESS_DENIED'
 'build-os-access'='NATIVE_BUILD_ACCESS_DENIED'
 'build-missing'='NATIVE_BUILD_COMPILER_MISSING'
 'build-reference'='NATIVE_BUILD_REFERENCE_UNAVAILABLE'
 'build-source'='NATIVE_BUILD_SOURCE_REJECTED'
 'entry'='NATIVE_ENTRY_UNAVAILABLE'
 'success'='UNSUPPORTED_PLATFORM'
}
$checks=0
foreach($phase in $phases){
 $fabricated=New-OwnerProbeFailure $phase|ConvertFrom-Json
 $fabricated.target='IDENTITY'
 $fabricated.observations=@(@{target='IDENTITY';reason=$phase;storageVerified=$false;attributesVerified=$false;finalPathVerified=$false;owner='UNOBSERVED';dacl='UNOBSERVED'})
 $rejected=$false
 try{$null=ConvertTo-OwnerProbeClosedJson ($fabricated|ConvertTo-Json -Depth 5 -Compress)}catch{$rejected=$true}
 if(-not $rejected){throw ('BOOTSTRAP_REASON_ACCEPTED_AS_TARGET_OBSERVATION:'+$phase)}
}
foreach($scenario in $scenarios.Keys){
 $global:OwnerBootstrapScenario=$scenario;$script:imports=@();$script:builds=0
 [GoriqPrivateOwnerProbe]::EntryFailure=$scenario -ceq 'entry'
 $encoded=[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes('inert bootstrap source'))
 if($scenario -ceq 'source'){$encoded='PRIVATE_INVALID_BASE64!'}
 $savedIn=[Console]::In;$savedOut=[Console]::Out
 $inputBytes=[Text.Encoding]::UTF8.GetBytes($encoded+"`n")
 if($scenario -ceq 'source-bom'){$inputBytes=[byte[]]([Text.Encoding]::UTF8.GetPreamble()+$inputBytes)}
 $inputStream=[IO.MemoryStream]::new($inputBytes);$script:ownerBootstrapInputStream=$inputStream
 # Model .NET Framework Console.In: the original reader disables BOM detection.
 $reader=[IO.StreamReader]::new($inputStream,[Text.UTF8Encoding]::new($false),$false,1024,$true)
 $writer=New-Object IO.StringWriter
 try {
  [Console]::SetIn($reader);[Console]::SetOut($writer)
  & ([ScriptBlock]::Create($code))
 }finally{[Console]::SetIn($savedIn);[Console]::SetOut($savedOut);$reader.Dispose();$inputStream.Dispose()}
 $text=$writer.ToString();$writer.Dispose()
 $clean=ConvertTo-OwnerProbeClosedJson $text
 $result=$clean|ConvertFrom-Json
 if($result.reason -cne $scenarios[$scenario] -or $result.target -cne 'NONE' -or $result.observations.Count -ne 0){throw ('BOOTSTRAP_PHASE_LOST:'+ $scenario+':'+$result.reason)}
 if($clean -match 'PRIVATE_|PATH|S-1-5'){throw 'BOOTSTRAP_PRIVATE_OUTPUT_LEAKED'}
 $expectedImports=3
 if($scenario -ceq 'Microsoft.PowerShell.Management'){$expectedImports=1}
 if($scenario -ceq 'Microsoft.PowerShell.Security'){$expectedImports=2}
 if($script:imports.Count -ne $expectedImports){throw 'BOOTSTRAP_DID_NOT_STOP_AT_IMPORT'}
 $expectedBuilds=0;if($scenario.StartsWith('build') -or $scenario -cin @('entry','success','source-bom')){$expectedBuilds=1}
 if($script:builds -ne $expectedBuilds){throw 'BOOTSTRAP_BUILD_EARLY_STOP_FAILED'}
 $checks++;Write-Output ('PASS bootstrap_phase_'+$scenario)
}
Write-Output ('TOTAL_PASS='+$checks)
& (Join-Path $PSScriptRoot 'test-owner-probe-source-stream.ps1')
