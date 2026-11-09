"""Bounded PR1905 stage-two diagnostics; exact public fixtures only."""
import base64
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time

NATIVE='scripts/owner-code-rotation-native-1218.ps1'
FIXTURE='tests/owner-code-cutover-peer.fixture.ps1'
TEST='scripts/owner-code-cutover-peer.test.mjs'
EXPECTED={NATIVE:'287212853b7dd68adb901f6dd8d3c768732dcd0b',FIXTURE:'67656bc2083ac08fc244afaf60aab508dae89cb8',TEST:'1b6e730c925c87fe0fd2ca0234f1c07be4a11020'}


def once(s,a,b):
    if s.count(a)!=1: raise ValueError('ANCHOR_REQUIRED')
    return s.replace(a,b,1)


def annotate_native(source):
    """Disposable, exact-original-logic branch points for original Job close."""
    begin=source.index('  function Close-OwnerCutoverOwnedPeerPipes {')
    end=source.index('  function Close-OwnerCutoverOwnedPeerObserver {',begin)
    block=source[begin:end]
    block=once(block,
        "    $owner=Get-OwnerCutoverOwnedPeerJobCleanupOwner;if($null -eq $owner){return};$c=$owner.OriginalConstructor",
        "    [Console]::Error.WriteLine('PIPE_ENTER|YES');$owner=Get-OwnerCutoverOwnedPeerJobCleanupOwner;if($null -eq $owner){[Console]::Error.WriteLine('PIPE_OWNER|NO');return};[Console]::Error.WriteLine('PIPE_OWNER|YES');$c=$owner.OriginalConstructor")
    block=once(block,
        "    $all=$true;$held=[Collections.Generic.List[object]]::new();",
        "    [Console]::Error.WriteLine('PIPE_BEFORE_REFS|YES');$all=$true;$held=[Collections.Generic.List[object]]::new();")
    block=block.replace("catch{$all=$false}","catch{$all=$false;[Console]::Error.WriteLine('PIPE_ITEM_EXCEPTION|'+$_.Exception.GetBaseException().GetType().Name)}")
    block=once(block,"     if(-not $all -or $refs.Count -ne 3){",
         "     [Console]::Error.WriteLine('PIPE_ALL|'+$(if($all){'YES'}else{'NO'}));[Console]::Error.WriteLine('PIPE_REFS3|'+$(if($refs.Count -eq 3){'YES'}else{'NO'}));if(-not $all -or $refs.Count -ne 3){")
    declaration="Microsoft.PowerShell.Utility\\New-Variable -Name ownedPeerJobCanonicalPipes -Scope Script -Option Constant -Value ([Tuple[object,object,object]]::new($c,$refs,$origin.Value)) -ErrorAction Stop"
    block=once(block,declaration,
         "try{"+declaration+";[Console]::Error.WriteLine('PIPE_NEWVAR|PASS')}catch{[Console]::Error.WriteLine('PIPE_NEWVAR|'+$_.Exception.GetBaseException().GetType().Name);throw}")
    block=once(block,"   }catch{}\n",
        "   }catch{[Console]::Error.WriteLine('PIPE_OUTER|'+$_.Exception.GetBaseException().GetType().Name)}\n")
    return source[:begin]+block+source[end:]

def cleanup_wrapper_candidate(native):
    # The original CWT/job/certificate checks are not removed. Any extra
    # disposal is of the original, already-exited Process's own wrappers only.
    marker="    $all=$true;foreach($pair in $refs){try{if($pair -isnot"
    if native.count(marker)!=1: raise ValueError('PIPE_ORIGINAL_ANCHOR_REQUIRED')
    extra=("    $all=$true;"
           "if($c.Item2 -isnot [Diagnostics.Process] -or -not $c.Item2.HasExited){return};"
           "foreach($wrapper in @($c.Item2.StandardInput,$c.Item2.StandardOutput,$c.Item2.StandardError)){"
           "try{$wrapper.Dispose()}catch{$all=$false}};"
           "foreach($pair in $refs){try{if($pair -isnot")
    return native.replace(marker,extra,1)

def annotate_fixture(source, module_api_candidate=False, early_cert_candidate=False):
    if early_cert_candidate:
        # Disposable module-only test. Original owner CWT and all negative
        # acceptance gates remain; never modify native product source.
        early=r"""  if($OwnedJobData -or $ClockContainmentData -or $OwnedJobWindows){
   &$module {
    $fn=Get-Command Initialize-OwnerCutoverOwnedPeer -ErrorAction Stop
    $body=$fn.ScriptBlock.ToString()
    $needle='if(-not $process.Start()){throw ''ROTATION_CUTOVER_PEER_PROOF_REJECTED''};Assert-OwnerCutoverPrivateClock;Confirm-OwnerCutoverOwnedPeerCleanupIdentity;'
    if(-not $body.Contains($needle)){throw 'EARLY_CERT_ANCHOR'}
    $proof=@'
try{
 $owner=Get-OwnerCutoverOwnedPeerJobCleanupOwner
 $cert=if($owner){$owner.OriginalConstructor}else{$null}
 $original=Microsoft.PowerShell.Utility\Get-Variable -Name ownedPeerJobOriginalBinding -Scope Script -ErrorAction SilentlyContinue
 if($cert -isnot [Tuple[object,object,object,object]] -or $null -eq $original -or (($original.Options -band [Management.Automation.ScopedItemOptions]::Constant) -eq 0) -or -not [object]::ReferenceEquals($cert.Item2,$process) -or -not [object]::ReferenceEquals($cert.Item3,$process.StartInfo) -or -not [object]::ReferenceEquals($original.Value.Item3,$ExecutionContext.SessionState.Module) -or $process.HasExited){throw 'EARLY_CERT_ORIGIN'}
 $handle=$process.Handle;$born=$process.StartTime.ToUniversalTime().Ticks
 if($handle -eq [IntPtr]::Zero -or $handle -eq [IntPtr]::new(-1) -or $born -le 0){throw 'EARLY_CERT_BIRTH'}
 $pairs=[Collections.Generic.List[object]]::new()
 foreach($kind in @('INPUT','OUTPUT','ERROR')){
  $stream=switch($kind){'INPUT'{$process.StandardInput.BaseStream};'OUTPUT'{$process.StandardOutput.BaseStream};'ERROR'{$process.StandardError.BaseStream}}
  $safe=if($stream -is [IO.FileStream]){$stream.SafeFileHandle}elseif($stream -is [IO.Pipes.PipeStream]){$stream.SafePipeHandle}else{throw 'EARLY_CERT_STREAM'}
  if($safe -isnot [Runtime.InteropServices.SafeHandle] -or $safe.IsClosed){throw 'EARLY_CERT_HANDLE'}
  $pairs.Add([Tuple[object,object]]::new($stream,$safe))
 }
 if($pairs.Count -ne 3 -or (Microsoft.PowerShell.Utility\Get-Variable -Name ownedPeerJobCanonicalPipes -Scope Script -ErrorAction SilentlyContinue)){throw 'EARLY_CERT_COUNT'}
 $refs=[Collections.ObjectModel.ReadOnlyCollection[object]]::new($pairs)
 $value=[Tuple[object,object,object]]::new($cert,$refs,$original.Value)
 Microsoft.PowerShell.Utility\New-Variable -Name ownedPeerJobCanonicalPipes -Scope Script -Option Constant -Value $value -ErrorAction Stop
 $stored=Microsoft.PowerShell.Utility\Get-Variable -Name ownedPeerJobCanonicalPipes -Scope Script -ErrorAction Stop
 if((($stored.Options -band [Management.Automation.ScopedItemOptions]::Constant) -eq 0) -or -not [object]::ReferenceEquals($stored.Value,$value)){throw 'EARLY_CERT_READBACK'}
 [Console]::Error.WriteLine('PIPE_EARLY|PASS')
}catch{[Console]::Error.WriteLine('PIPE_EARLY|FAIL');throw}
'@
    $replacement=$needle.Replace('Confirm-OwnerCutoverOwnedPeerCleanupIdentity;',$proof+[char]10+'Confirm-OwnerCutoverOwnedPeerCleanupIdentity;')
    $body=$body.Replace($needle,$replacement)
    Set-Item -Path Function:script:Initialize-OwnerCutoverOwnedPeer -Value ([scriptblock]::Create($body)) -ErrorAction Stop
    [Console]::Error.WriteLine('PIPE_EARLY_INSTALLED|YES')
   }
  }
"""
        # No additional diagnostic stderr is permitted in a green original test.
        # A failed proof still refuses and stays observable.
        early=early.replace("[Console]::Error.WriteLine('PIPE_EARLY|PASS')","")
        early=early.replace("[Console]::Error.WriteLine('PIPE_EARLY_INSTALLED|YES')","")
        marker="  Write-PublicPeerProgress ($phaseCase+'_KERNEL_DONE')"
        return once(source,marker,early+"\n"+marker)
    a="}catch{$script:jobWindowsResult=@{pass=$false;status='INCONCLUSIVE';code='PUBLIC_PRIVATE_JOB_WINDOWS_PROOF_UNCONFIRMED';nativeAuthority=$false}}"
    b="""}catch{$publicStageReason='UNKNOWN';$publicMessage=$_.Exception.GetBaseException().Message;if($publicMessage -cmatch '\\A(?:PEER_FIXTURE|CUTOVER_BOOTSTRAP_FIXTURE)_[A-Z0-9_]{1,150}\\z'){$publicStageReason=$publicMessage};[Console]::Error.WriteLine('JOB_NATIVE_STAGE|'+$publicStageReason+'|'+$_.Exception.GetBaseException().GetType().Name);$script:jobWindowsResult=@{pass=$false;status='INCONCLUSIVE';code='PUBLIC_PRIVATE_JOB_WINDOWS_PROOF_UNCONFIRMED';nativeAuthority=$false}}"""
    source=once(source,a,b)
    stage="    Refused {&$module {Initialize-OwnerCutoverOwnedPeer}}\\n    $containment="
    stage_new="    [Console]::Error.WriteLine('CLOCK_MARK|BEFORE');Refused {&$module {Initialize-OwnerCutoverOwnedPeer}};[Console]::Error.WriteLine('CLOCK_MARK|AFTER')\\n    $containment="
    source=once(source,stage.replace('\\n','\n'),stage_new.replace('\\n','\n'))
    guard="Require ($script:ownedPeerLifetime.observerContainment -ceq 'CLOSED' -and $script:r2HeldProof.HasExited -and -not $script:ownedPeerCleanupCertificate.Item4.Item1.IsRunning) 'R2_EARLY_ORIGINAL_ACTOR_CLOSED'"
    indicators=(
      "[Console]::Error.WriteLine('CLOCK_CONTAINMENT|'+$(if($script:ownedPeerLifetime.observerContainment -ceq 'CLOSED'){'YES'}else{'NO'}));"
      "[Console]::Error.WriteLine('CLOCK_EXITED|'+$(if($script:r2HeldProof.HasExited){'YES'}else{'NO'}));"
      "[Console]::Error.WriteLine('CLOCK_WATCH|'+$(if(-not $script:ownedPeerCleanupCertificate.Item4.Item1.IsRunning){'YES'}else{'NO'}));"
    )
    identityFlags=(
      "$clockOwner=$null;try{$clockOwner=Get-OwnerCutoverOwnedPeerJobCleanupOwner}catch{};"
      "[Console]::Error.WriteLine('CLOCK_OWNER_CHECK|YES');"
      "[Console]::Error.WriteLine('CLOCK_JOB_OWNER|'+$(if($null -ne $clockOwner){'YES'}else{'NO'}));"
      "[Console]::Error.WriteLine('CLOCK_JOB_CLOSED|'+$(if($script:ownedPeerJobCloseState -ceq 'RETURNED_CONFIRMED'){'YES'}else{'NO'}));"
      "[Console]::Error.WriteLine('CLOCK_OWNER_CLOSED|'+$(if($clockOwner -and $clockOwner.CloseConfirmed){'YES'}else{'NO'}));"
      "[Console]::Error.WriteLine('CLOCK_STARTED|'+$(if($script:ownedPeerCleanupStarted -is [Tuple[object,IntPtr,long]]){'YES'}else{'NO'}));"
      "[Console]::Error.WriteLine('CLOCK_CERT_CLOSED|'+$(if([object]::ReferenceEquals($script:ownedPeerCleanupClosed,$script:ownedPeerCleanupCertificate)){'YES'}else{'NO'}));"
      "[Console]::Error.WriteLine('CLOCK_PIPE_CLOSED|'+$(if($script:ownedPeerJobPipeState -ceq 'CLOSED'){'YES'}else{'NO'}));"
    )
    source=once(source,guard,indicators+identityFlags+guard)
    jobMarker="$held=$script:jobDataAssignFailureProof;Require ("
    jobIndicators=(
      "$held=$script:jobDataAssignFailureProof;"
      "$jobResolved=Get-OwnerCutoverOwnedPeerJobCleanupOwner;"
      "$jobCanonical=Microsoft.PowerShell.Utility\\Get-Variable -Name ownedPeerJobCanonicalPipes -Scope Script -ErrorAction SilentlyContinue;"
      "$jobOrigin=Microsoft.PowerShell.Utility\\Get-Variable -Name ownedPeerJobOriginalBinding -Scope Script -ErrorAction SilentlyContinue;"
      "[Console]::Error.WriteLine('JOB_ORIGIN_EXISTS|'+$(if($null -ne $jobOrigin){'YES'}else{'NO'}));"
      "[Console]::Error.WriteLine('JOB_ORIGIN_CONSTANT|'+$(if($jobOrigin -and ($jobOrigin.Options -band [Management.Automation.ScopedItemOptions]::Constant)){'YES'}else{'NO'}));"
      "[Console]::Error.WriteLine('JOB_ORIGIN_TUPLE|'+$(if($jobOrigin -and $jobOrigin.Value -is [Tuple[object,object,object]]){'YES'}else{'NO'}));"
      "[Console]::Error.WriteLine('JOB_ORIGIN_MODULE|'+$(if($jobOrigin -and [object]::ReferenceEquals($jobOrigin.Value.Item3,$ExecutionContext.SessionState.Module)){'YES'}else{'NO'}));"
      "[Console]::Error.WriteLine('JOB_CANONICAL_EXISTS|'+$(if($null -ne $jobCanonical){'YES'}else{'NO'}));"
      "$jobConstructor=$jobResolved.OriginalConstructor;"
      "$jobProcess=$jobConstructor.Item2;"
      "$jobStarted=$script:ownedPeerCleanupStarted;"
      "$pipeRefs=$script:ownedPeerJobPipeReferences;"
      "[Console]::Error.WriteLine('JOB_REFS_3|'+$(if($pipeRefs -and $pipeRefs.Count -eq 3){'YES'}else{'NO'}));"
      "[Console]::Error.WriteLine('JOB_REF_STREAMS|'+$(if(@($pipeRefs|Where-Object {$_.Item1 -isnot [IO.Stream]}).Count -eq 0){'YES'}else{'NO'}));"
      "[Console]::Error.WriteLine('JOB_REF_HANDLES|'+$(if(@($pipeRefs|Where-Object {$_.Item2 -isnot [Runtime.InteropServices.SafeHandle]}).Count -eq 0){'YES'}else{'NO'}));"
      "[Console]::Error.WriteLine('JOB_REF_DISTINCT|'+$(if(-not [object]::ReferenceEquals($pipeRefs[0].Item1,$pipeRefs[1].Item1) -and -not [object]::ReferenceEquals($pipeRefs[1].Item1,$pipeRefs[2].Item1) -and -not [object]::ReferenceEquals($pipeRefs[0].Item1,$pipeRefs[2].Item1)){'YES'}else{'NO'}));"
      "[Console]::Error.WriteLine('JOB_REF_HELD0|'+$(if([object]::ReferenceEquals($pipeRefs[0].Item2,$script:jobDataAssignFailurePipes[0])){'YES'}else{'NO'}));"
      "[Console]::Error.WriteLine('JOB_REF_HELD1|'+$(if([object]::ReferenceEquals($pipeRefs[1].Item2,$script:jobDataAssignFailurePipes[1])){'YES'}else{'NO'}));"
      "[Console]::Error.WriteLine('JOB_REF_HELD2|'+$(if([object]::ReferenceEquals($pipeRefs[2].Item2,$script:jobDataAssignFailurePipes[2])){'YES'}else{'NO'}));"
      "[Console]::Error.WriteLine('JOB_REFS_EMPTY|'+$(if(-not $pipeRefs -or $pipeRefs.Count -eq 0){'YES'}else{'NO'}));"
      "[Console]::Error.WriteLine('JOB_CONSTRUCTOR|'+$(if($jobConstructor -is [Tuple[object,object,object,object]]){'YES'}else{'NO'}));"
      "[Console]::Error.WriteLine('JOB_STARTED_SAME|'+$(if($jobStarted -and [object]::ReferenceEquals($jobStarted.Item1,$jobConstructor)){'YES'}else{'NO'}));"
      "[Console]::Error.WriteLine('JOB_STARTINFO_SAME|'+$(if([object]::ReferenceEquals($jobProcess.StartInfo,$jobConstructor.Item3)){'YES'}else{'NO'}));"
      "[Console]::Error.WriteLine('JOB_CERT_HANDLE|'+$(if($jobProcess.Handle -eq $jobStarted.Item2){'YES'}else{'NO'}));"
      "[Console]::Error.WriteLine('JOB_CERT_BIRTH|'+$(if($jobProcess.StartTime.ToUniversalTime().Ticks -eq $jobStarted.Item3){'YES'}else{'NO'}));"
      "[Console]::Error.WriteLine('JOB_OWNER_RESOLVED|'+$(if($null -ne $jobResolved){'YES'}else{'NO'}));"
      "[Console]::Error.WriteLine('JOB_CANONICAL_PRESENT|'+$(if($jobCanonical -and ($jobCanonical.Options -band [Management.Automation.ScopedItemOptions]::Constant)){'YES'}else{'NO'}));"
      "[Console]::Error.WriteLine('JOB_STARTED_PRESENT|'+$(if($script:ownedPeerCleanupStarted -is [Tuple[object,IntPtr,long]]){'YES'}else{'NO'}));"
      "[Console]::Error.WriteLine('JOB_OWNER_CLOSED|'+$(if($jobResolved -and $jobResolved.CloseConfirmed){'YES'}else{'NO'}));"
      "[Console]::Error.WriteLine('JOB_PIPE0_CLOSED|'+$(if($script:jobDataAssignFailurePipes[0].IsClosed){'YES'}else{'NO'}));"
      "[Console]::Error.WriteLine('JOB_PIPE1_CLOSED|'+$(if($script:jobDataAssignFailurePipes[1].IsClosed){'YES'}else{'NO'}));"
      "[Console]::Error.WriteLine('JOB_PIPE2_CLOSED|'+$(if($script:jobDataAssignFailurePipes[2].IsClosed){'YES'}else{'NO'}));"
      "[Console]::Error.WriteLine('JOB_SAME_HANDLE|'+$(if($held.Item1.Handle -eq $held.Item2){'YES'}else{'NO'}));"
      "[Console]::Error.WriteLine('JOB_SAME_BIRTH|'+$(if($held.Item1.StartTime.ToUniversalTime().Ticks -eq $held.Item3){'YES'}else{'NO'}));"
      "[Console]::Error.WriteLine('JOB_ACTOR_EXITED|'+$(if($held.Item1.HasExited){'YES'}else{'NO'}));"
      "[Console]::Error.WriteLine('JOB_PIPES_CLOSED|'+$(if(@($script:jobDataAssignFailurePipes|Where-Object {-not $_.IsClosed}).Count -eq 0){'YES'}else{'NO'}));"
      "[Console]::Error.WriteLine('JOB_STATE_CLOSED|'+$(if($script:ownedPeerJobPipeState -ceq 'CLOSED'){'YES'}else{'NO'}));"
      "Require ("
    )
    source=once(source,jobMarker,jobIndicators)
    # This probe is installed only inside a disposable native-data module, never in
    # source files or a deployed runtime. Original guards and refusal stay intact.
    install=r"""  if($OwnedJobData -or $ClockContainmentData -or $OwnedJobWindows){
   &$module {
    $fn=Get-Command Close-OwnerCutoverOwnedPeerPipes -ErrorAction Stop
    $body=[string]$fn.ScriptBlock.ToString()
    $guard='if(-not $all -or $refs.Count -ne 3){'
    $guardDiagnostic=@'
[Console]::Error.WriteLine('PIPE_ALL|'+$(if($all){'YES'}else{'NO'}));[Console]::Error.WriteLine('PIPE_REFS3|'+$(if($refs.Count -eq 3){'YES'}else{'NO'}));
'@
    if(-not $body.Contains($guard)){throw 'PIPE_DIAG_GUARD_MISSING'}
    $body=$body.Replace($guard,$guardDiagnostic+$guard)
    $newVar='Microsoft.PowerShell.Utility\New-Variable -Name ownedPeerJobCanonicalPipes -Scope Script -Option Constant -Value ([Tuple[object,object,object]]::new($c,$refs,$origin.Value)) -ErrorAction Stop'
    $newVarDiagnostic=@'
$existingScript=Microsoft.PowerShell.Utility\Get-Variable -Name ownedPeerJobCanonicalPipes -Scope Script -ErrorAction SilentlyContinue
$existingLocal=Microsoft.PowerShell.Utility\Get-Variable -Name ownedPeerJobCanonicalPipes -Scope Local -ErrorAction SilentlyContinue
$existingGlobal=Microsoft.PowerShell.Utility\Get-Variable -Name ownedPeerJobCanonicalPipes -Scope Global -ErrorAction SilentlyContinue
$prior1=Microsoft.PowerShell.Utility\Get-Variable -Name ownedPeerJobCanonicalPipes -Scope 1 -ErrorAction SilentlyContinue
$prior2=Microsoft.PowerShell.Utility\Get-Variable -Name ownedPeerJobCanonicalPipes -Scope 2 -ErrorAction SilentlyContinue
$prior3=Microsoft.PowerShell.Utility\Get-Variable -Name ownedPeerJobCanonicalPipes -Scope 3 -ErrorAction SilentlyContinue
[Console]::Error.WriteLine('PIPE_PRE_GLOBAL|'+$(if($existingGlobal){'YES'}else{'NO'}))
[Console]::Error.WriteLine('PIPE_PRE_UP1|'+$(if($prior1){'YES'}else{'NO'}))
[Console]::Error.WriteLine('PIPE_PRE_UP2|'+$(if($prior2){'YES'}else{'NO'}))
[Console]::Error.WriteLine('PIPE_PRE_UP3|'+$(if($prior3){'YES'}else{'NO'}))
[Console]::Error.WriteLine('PIPE_PRE_SCRIPT|'+$(if($existingScript){'YES'}else{'NO'}))
[Console]::Error.WriteLine('PIPE_PRE_LOCAL|'+$(if($existingLocal){'YES'}else{'NO'}))
try{
 $canonicalTuple=[Tuple[object,object,object]]::new($c,$refs,$origin.Value)
 [Console]::Error.WriteLine('PIPE_TUPLE|PASS')
 ORIGINAL_NEW_VAR
 [Console]::Error.WriteLine('PIPE_NEWVAR|PASS')
}catch{
 $err=$_.Exception.GetBaseException()
 $reason='OTHER'
 if($_.Exception.Message -match '(?i)already exists'){$reason='EXISTS'}
 elseif($_.Exception.Message -match '(?i)constant'){$reason='CONSTANT'}
 elseif($_.Exception.Message -match '(?i)read.only'){$reason='READONLY'}
 elseif($_.Exception.Message -match '(?i)cannot overwrite'){$reason='OVERWRITE'}
 [Console]::Error.WriteLine('PIPE_NEWVAR|'+$err.GetType().Name)
 [Console]::Error.WriteLine('PIPE_NEWVAR_REASON|'+$reason)
 $fqid=[string]$_.FullyQualifiedErrorId
 $code='OTHER'
 if($fqid -match '(?i)VariableAlreadyExists|VariableExists'){$code='VARIABLE_EXISTS'}
 elseif($fqid -match '(?i)VariableNotWritable|NotWritable'){$code='VARIABLE_NOT_WRITABLE'}
 elseif($fqid -match '(?i)SessionState'){$code='SESSION_STATE'}
 elseif($fqid -match '(?i)WriteError'){$code='WRITE_ERROR'}
 [Console]::Error.WriteLine('PIPE_NEWVAR_FQID|'+$code)
 $kind='OTHER'
 $full=[string]$_.Exception.Message
 if($full -match '(?i)maximum|too many|capacity|limit.*variable|variable.*limit'){$kind='VARIABLE_CAPACITY'}
 elseif($full -match '(?i)scope|session.*state'){$kind='SCOPE_OR_SESSION'}
 elseif($full -match '(?i)constant|read.?only|overwrite|exists'){$kind='CONSTANT_CONFLICT'}
 elseif($full -match '(?i)runspace|pipeline|thread|closed'){$kind='RUNSPACE_STATE'}
 [Console]::Error.WriteLine('PIPE_EXCEPTION_CLASS|'+$kind)
 $count=[int]@((Microsoft.PowerShell.Utility\Get-Variable -Scope Script -ErrorAction SilentlyContinue)).Count
 $maximum=0
 try{$maximum=[int](Microsoft.PowerShell.Utility\Get-Variable MaximumVariableCount -ValueOnly -ErrorAction Stop)}catch{}
 [Console]::Error.WriteLine('PIPE_CAP_CONFIG|'+$(if($maximum -ge 1024 -and $maximum -le 32768){'VALID'}else{'UNKNOWN'}))
 [Console]::Error.WriteLine('PIPE_CAP_NEAR|'+$(if($maximum -gt 0 -and $count -ge ($maximum - 10)){'YES'}else{'NO'}))
 [Console]::Error.WriteLine('PIPE_CAP_USED|'+$(if($count -ge 4090){'HIGH'}elseif($count -ge 2048){'MID'}else{'LOW'}))
 $altState='UNKNOWN'
 try{
  Microsoft.PowerShell.Utility\New-Variable -Name publicJobUniqueCertProbe1905 -Scope Script -Option Constant -Value $canonicalTuple -ErrorAction Stop
  $altState='PASS'
 }catch{$altState='FAIL'}
 [Console]::Error.WriteLine('PIPE_UNIQUE|'+$altState)
 throw
}
'@
    if(-not $body.Contains($newVar)){throw 'PIPE_DIAG_NEWVAR_MISSING'}
    $body=$body.Replace($newVar,$newVarDiagnostic.Replace('ORIGINAL_NEW_VAR',$newVar.Replace('([Tuple[object,object,object]]::new($c,$refs,$origin.Value))','$canonicalTuple')))
    $itemCatch='catch{$all=$false}'
    $itemDiagnostic=@'
catch{$all=$false;[Console]::Error.WriteLine('PIPE_ITEM_EXCEPTION|'+$_.Exception.GetBaseException().GetType().Name)}
'@
    if(-not $body.Contains($itemCatch)){throw 'PIPE_DIAG_ITEM_MISSING'}
    $body=$body.Replace($itemCatch,$itemDiagnostic)
    Set-Item -Path Function:script:Close-OwnerCutoverOwnedPeerPipes -Value ([scriptblock]::Create($body)) -ErrorAction Stop
    [Console]::Error.WriteLine('PIPE_INMEMORY_INSTALLED|YES')
   }
  }
"""
    if module_api_candidate:
        # Test-only alternative: attach a CONSTANT PSVariable to the exact
        # original ModuleInfo already bound by the original CWT owner guard.
        # Do not relax any original owner, stream or lifecycle assertion.
        original_line="$body=$body.Replace($newVar,$newVarDiagnostic.Replace('ORIGINAL_NEW_VAR',$newVar.Replace('([Tuple[object,object,object]]::new($c,$refs,$origin.Value))','$canonicalTuple')))"
        candidate=r"""$apiNative=@'
try{
 $pipeCert=[Tuple[object,object,object]]::new($c,$refs,$origin.Value)
 $targetModule=$origin.Value.Item3
 if($targetModule -isnot [Management.Automation.PSModuleInfo]){throw 'PIPE_TARGET_NOT_MODULE'}
 $pipeVar=[Management.Automation.PSVariable]::new('ownedPeerJobCanonicalPipes',$pipeCert,[Management.Automation.ScopedItemOptions]::Constant)
 $targetModule.SessionState.PSVariable.Set($pipeVar)
 $stored=$targetModule.SessionState.PSVariable.Get('ownedPeerJobCanonicalPipes')
 if(-not $stored -or -not [object]::ReferenceEquals($stored.Value,$pipeCert) -or (($stored.Options -band [Management.Automation.ScopedItemOptions]::Constant) -eq 0)){throw 'PIPE_CONST_NOT_BOUND'}
 [Console]::Error.WriteLine('PIPE_API|PASS')
}catch{[Console]::Error.WriteLine('PIPE_API|'+$_.Exception.GetBaseException().GetType().Name);throw}
'@
    $body=$body.Replace($newVar,$apiNative)"""
        install=once(install,original_line,candidate)
    if module_api_candidate:
        # Same module that passed the original CWT/owner binding must own the
        # read-back. In-memory comparison only; no source file or gate changed.
        lookup="$canonical=Microsoft.PowerShell.Utility\\Get-Variable -Name ownedPeerJobCanonicalPipes -Scope Script -ErrorAction SilentlyContinue"
        replacement="$canonical=$origin.Value.Item3.SessionState.PSVariable.Get('ownedPeerJobCanonicalPipes');[Console]::Error.WriteLine('PIPE_LOOKUP|'+$(if($canonical){'YES'}else{'NO'}))"
        install=once(install,"    $body=$body.Replace($newVar,$apiNative)",
            "    $body=$body.Replace($newVar,$apiNative)\n    $lookup='"+lookup+"'\n    $body=$body.Replace($lookup, '"+replacement.replace("'","''")+"')")
    source=once(source,"  Write-PublicPeerProgress ($phaseCase+'_KERNEL_DONE')",install+"\n  Write-PublicPeerProgress ($phaseCase+'_KERNEL_DONE')")
    return source


def decoder(fixture,out,explicit_values=False,renamed=False):
    match=re.search(r"\$snapshotContract=\[Text.Encoding\]::UTF8.GetString\(\[Convert\]::FromBase64String\('([^']+)'\)\)",fixture)
    body=base64.b64decode(match[1],validate=True).decode()
    a='$bytes=New-Bytes $width ([System.UInt64[]]@(4,8,12));$result=$type::Decode($bytes,$bytes.Length,$width,0,[System.UInt64]4);'
    b="$bytes=New-Bytes $width ([System.UInt64[]]@(4,8,12));[Console]::Out.WriteLine('DEC_VECTOR|'+$width+'|'+$bytes.Length+'|'+$bytes.GetType().FullName);$result=$type::Decode($bytes,$bytes.Length,$width,0,[System.UInt64]4);[Console]::Out.WriteLine('DEC_RETURN|'+$width+'|'+$result.Count);"
    body=once(body,a,b)
    if explicit_values:
        body=once(body,'$bytes=New-Bytes $width ([System.UInt64[]]@(4,8,12))',
            '$publicValues=[System.UInt64[]]@([System.UInt64]4,[System.UInt64]8,[System.UInt64]12);$bytes=New-Bytes -Width $width -Values $publicValues')
        body=once(body,'$b=New-Bytes $width $values',
            '$b=New-Bytes -Width $width -Values $values')
        body=once(body,'$valid=New-Bytes 8 ([System.UInt64[]]@(4))',
            '$valid=New-Bytes -Width 8 -Values ([System.UInt64[]]@([System.UInt64]4))')
    body=once(body,'$t=$null;$e=$null;$ast=',"[Console]::Out.WriteLine('DEC_SCRIPT_ENTER');$t=$null;$e=$null;$ast=")
    body=once(body,'$source=Get-PublicWindowsEofActorSource',"$source=Get-PublicWindowsEofActorSource;[Console]::Out.WriteLine('DEC_SOURCE_OK')")
    body=once(body,"$type='PublicEofOwnHandleSnapshot' -as [type];", "[Console]::Out.WriteLine('DEC_TYPE_BEGIN');$type='PublicEofOwnHandleSnapshot' -as [type];")
    body=once(body,'$rows=@();$bad=@()',"[Console]::Out.WriteLine('DEC_FUNCTIONS_READY');$rows=@();$bad=@()")
    body=once(body,'foreach($width in @(4,8)){',"[Console]::Out.WriteLine('DEC_LOOP_READY');foreach($width in @(4,8)){[Console]::Out.WriteLine('DEC_LOOP_ENTER|'+$width);")

    if not explicit_values and not renamed:
        # Distinguish a parameter conversion problem, missing function,
        # and actual decoder invocation with finite non-secret status.
        body=once(body,'$bytes=New-Bytes $width ([System.UInt64[]]@(4,8,12));',
            "$publicArray=[System.UInt64[]]@(4,8,12);[Console]::Out.WriteLine('DEC_CAST_COMPLETE|'+$publicArray.Length);[Console]::Out.WriteLine('DEC_COMMAND_VISIBLE|'+([bool](Get-Command -Name New-Bytes -CommandType Function -ErrorAction SilentlyContinue)));$bytes=New-Bytes $width $publicArray;")

    # Read-only public probe only: emit fixed stage names before the failing
    # width-4 source-vector builder; no inner exception, handle or path values.
    body=once(body,'function Put-Pointer([byte[]]$Buffer,[int]$Offset,[System.UInt64]$Value,[int]$Width){',
        "function Put-Pointer([byte[]]$Buffer,[int]$Offset,[System.UInt64]$Value,[int]$Width){[Console]::Out.WriteLine('DEC_PUT_ENTER|'+$Width);")
    body=once(body,'[Buffer]::BlockCopy($data,0,$Buffer,$Offset,$Width)}',
        "[Console]::Out.WriteLine('DEC_BEFORE_COPY|'+$Width);[Buffer]::BlockCopy($data,0,$Buffer,$Offset,$Width);[Console]::Out.WriteLine('DEC_AFTER_COPY|'+$Width)}")
    body=once(body,'function New-Bytes([int]$Width,[System.UInt64[]]$Values){',
        "function New-Bytes([int]$Width,[System.UInt64[]]$Values){[Console]::Out.WriteLine('DEC_NEW_ENTER|'+$Width);")
    body=once(body,'Put-Pointer $buffer 0 ([System.UInt64]$Values.Count) $Width;',
        "[Console]::Out.WriteLine('DEC_BEFORE_COUNT|'+$Width);Put-Pointer $buffer 0 ([System.UInt64]$Values.Count) $Width;[Console]::Out.WriteLine('DEC_AFTER_COUNT|'+$Width);")
    body=once(body,'Put-Pointer $buffer ($header+$stride*$i) $Values[$i] $Width',
        "[Console]::Out.WriteLine('DEC_BEFORE_ITEM|'+$Width);Put-Pointer $buffer ($header+$stride*$i) $Values[$i] $Width;[Console]::Out.WriteLine('DEC_AFTER_ITEM|'+$Width)")
    if renamed:
        # Preserve original test vectors and failure controls, change only the
        # local helper command name after instrumenting the function body.
        body=body.replace('New-Bytes','New-PublicSnapshotBytes')
    script=r'''param([string]$Fixture)
$ErrorActionPreference='Stop';Set-StrictMode -Version Latest
$stage='PARSE'
try{
 $t=$null;$e=$null;$a=[Management.Automation.Language.Parser]::ParseFile($Fixture,[ref]$t,[ref]$e);if($e.Count){throw 'PARSE'}
 $f=@($a.FindAll({param($n)$n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -ceq 'Get-PublicWindowsEofActorSource'},$true));if($f.Count -ne 1){throw 'SOURCE'}
 .([scriptblock]::Create($f[0].Extent.Text));$source=Get-PublicWindowsEofActorSource;$stage='COMPILE'
 $r=[Runtime.InteropServices.RuntimeEnvironment]::GetRuntimeDirectory();Add-Type -TypeDefinition $source -ReferencedAssemblies @((Join-Path $r 'System.Runtime.Serialization.dll'),(Join-Path $r 'System.Xml.dll')) -ErrorAction Stop
 $stage='VECTOR';[Console]::Out.WriteLine('DEC_NATIVE_WIDTH|'+[IntPtr]::Size)
 $body=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('__BODY__'));$v=&([scriptblock]::Create($body)) -Fixture $Fixture
 [Console]::Out.WriteLine('DEC_COMPLETE')
}catch{
 $type=$_.Exception.GetBaseException().GetType().Name;$known=@('ArgumentException','RuntimeException','MethodException','MethodInvocationException','PSInvalidCastException','InvalidCastException','OverflowException','InvalidOperationException','MissingMethodException');if($known -cnotcontains $type){$type='OTHER'}
 $code='UNKNOWN';$fqid=[string]$_.FullyQualifiedErrorId;if($fqid -match '\A[A-Za-z][A-Za-z0-9_]{0,71}\z'){$code=$fqid}
 [Console]::Out.WriteLine('DEC_FAILURE|'+$stage+'|'+$type+'|'+$code+'|'+[int]$_.Exception.GetBaseException().HResult)
 exit 1
}
'''.replace('__BODY__',base64.b64encode(body.encode()).decode())
    p=out/'decoder.ps1';p.write_text(script,encoding='utf8')
    shell=os.path.join(os.environ['SystemRoot'],'System32','WindowsPowerShell','v1.0','powershell.exe')
    r=subprocess.run([shell,'-NoProfile','-NonInteractive','-File',str(p),'-Fixture',str(Path(FIXTURE).resolve())],capture_output=True,text=True,encoding='utf8',errors='replace',timeout=30)
    return {'exit':r.returncode,'rows':[x for x in r.stdout.splitlines() if re.fullmatch(r'DEC_[A-Z_]+(?:\|[A-Za-z0-9_.\[\]-]{1,80})*',x)]}


def writer_parent(fixture, test_source, out, exact_load=False, snapshot_origin=False, identity_accept=False):
    """Classify original CreateNew and a temporary actor-local type-origin candidate."""
    if snapshot_origin:
        fixture=once(fixture,
            'typeof(PublicWindowsEofActor).Assembly.Location',
            'typeof(PublicEofOwnHandleSnapshot).Assembly.Location')
    outer=re.search(r" \$publicWindowsEofActorControls=@'\r?\n([\s\S]*?)\r?\n'@",fixture)
    if outer is None: raise ValueError('PUBLIC_CONTROLS_ANCHOR_REQUIRED')
    controls=outer.group(1)
    embedded=re.search(r"\$writerParentContract=\[Text.Encoding\]::UTF8.GetString\(\[Convert\]::FromBase64String\('([^']+)'\)\)",controls)
    if embedded is None: raise ValueError('WRITER_CONTRACT_ANCHOR_REQUIRED')
    original=base64.b64decode(embedded.group(1),validate=True).decode()
    expected="if($writer -isnot [IO.FileStream] -or $writer.Name -cne $path -or $writer.Length -ne 0){throw 'ACTUAL_SOURCE_CREATE_NEW_REQUIRED'}"
    observed="""$isWriter=($writer -is [IO.FileStream]);$strictPath=$false;$loosePath=$false;$empty=$false
 $sameDirectory=$false;$baseClass='NONE';if($isWriter){$strictPath=([string]::Equals($writer.Name,$path,[StringComparison]::Ordinal));$loosePath=([string]::Equals($writer.Name,$path,[StringComparison]::OrdinalIgnoreCase));$empty=($writer.Length -eq 0);$sameDirectory=[string]::Equals([IO.Path]::GetDirectoryName($writer.Name),[IO.Path]::GetDirectoryName($path),[StringComparison]::OrdinalIgnoreCase);$basename=[IO.Path]::GetFileName($writer.Name);if($basename -ceq 'actor-stdout-observation.json'){$baseClass='STDOUT'}elseif($basename -ceq 'actor-stderr-observation.json'){$baseClass='STDERR'}else{$baseClass='OTHER'}}
 $writerDir=if($isWriter){[IO.Path]::GetDirectoryName($writer.Name)}else{''}
 $typeLocation=try{[IO.Path]::GetDirectoryName($type.Assembly.Location)}catch{''}
 $typeCodeBase=try{[IO.Path]::GetDirectoryName(([Uri]$type.Assembly.CodeBase).LocalPath)}catch{''}
 $actorLocation=try{[IO.Path]::GetDirectoryName([PublicWindowsEofActor].Assembly.Location)}catch{''}
 $eq=[StringComparison]::OrdinalIgnoreCase
 $matchesWriterLocation=$isWriter -and [string]::Equals($writerDir,$typeLocation,$eq)
 $matchesWriterCodebase=$isWriter -and [string]::Equals($writerDir,$typeCodeBase,$eq)
 $matchesExpectedLocation=[string]::Equals([IO.Path]::GetDirectoryName($path),$typeLocation,$eq)
 $matchesExpectedCodebase=[string]::Equals([IO.Path]::GetDirectoryName($path),$typeCodeBase,$eq)
 $matchesExpectedActor=[string]::Equals([IO.Path]::GetDirectoryName($path),$actorLocation,$eq)
 $expectedExists=[IO.File]::Exists($path)
 $actualExists=$isWriter -and [IO.File]::Exists($writer.Name)
 $fileIdentity='UNKNOWN';$identityReader=$null
 try{
  if($isWriter -and $expectedExists){
   $identitySource=@'
using System;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;
[StructLayout(LayoutKind.Sequential)] public struct PublicFt20261108 { public uint Low; public uint High; }
[StructLayout(LayoutKind.Sequential)] public struct PublicHandleInfo20261108 {
 public uint Attributes;
 public PublicFt20261108 Created;
 public PublicFt20261108 Accessed;
 public PublicFt20261108 Modified;
 public uint Volume;
 public uint FileSizeHigh;
 public uint FileSizeLow;
 public uint Links;
 public uint IndexHigh;
 public uint IndexLow;
}
public static class PublicFileIdentityProbe20261108 {
 [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
 [DllImport("kernel32.dll",ExactSpelling=true,SetLastError=true)]
 [return:MarshalAs(UnmanagedType.Bool)]
 private static extern bool GetFileInformationByHandle(SafeFileHandle handle,out PublicHandleInfo20261108 info);
 public static int Compare(SafeFileHandle a,SafeFileHandle b){
  PublicHandleInfo20261108 x,y;
  if(a==null||b==null||a.IsInvalid||b.IsInvalid||!GetFileInformationByHandle(a,out x)||!GetFileInformationByHandle(b,out y))return -1;
  if(x.Volume==y.Volume && x.IndexHigh==y.IndexHigh && x.IndexLow==y.IndexLow && (x.IndexHigh!=0||x.IndexLow!=0))return 1;
  return 0;
 }
}
'@
   if(-not ('PublicFileIdentityProbe20261108' -as [type])){$null=Add-Type -TypeDefinition $identitySource -ErrorAction Stop}
   $identityReader=[IO.FileStream]::new($path,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::ReadWrite);[Console]::Out.WriteLine('WRITER_READOPEN|YES')
   $sameFile=[PublicFileIdentityProbe20261108]::Compare($writer.SafeFileHandle,$identityReader.SafeFileHandle)
   if($sameFile -eq 1){$fileIdentity='MATCH'}elseif($sameFile -eq 0){$fileIdentity='DIFFERENT'}
  }
 }catch{}finally{if($identityReader){$identityReader.Dispose()}}
 [Console]::Out.WriteLine('WRITER_IDENTITY|'+$fileIdentity)
 foreach($diag in @(@('LOCATION_WRITER',$matchesWriterLocation),@('CODEBASE_WRITER',$matchesWriterCodebase),@('LOCATION_EXPECTED',$matchesExpectedLocation),@('CODEBASE_EXPECTED',$matchesExpectedCodebase),@('ACTOR_EXPECTED',$matchesExpectedActor),@('EXPECTED_EXISTS',$expectedExists),@('ACTUAL_EXISTS',$actualExists))){[Console]::Out.WriteLine('WRITER_'+$diag[0]+'|'+$(if($diag[1]){'YES'}else{'NO'}))}
 [Console]::Out.WriteLine('WRITER_TYPE|'+$(if($isWriter){'YES'}else{'NO'}));[Console]::Out.WriteLine('WRITER_PATH|'+$(if($strictPath){'YES'}else{'NO'}));[Console]::Out.WriteLine('WRITER_PATH_CASELESS|'+$(if($loosePath){'YES'}else{'NO'}));[Console]::Out.WriteLine('WRITER_EMPTY|'+$(if($empty){'YES'}else{'NO'}));[Console]::Out.WriteLine('WRITER_DIRECTORY|'+$(if($sameDirectory){'YES'}else{'NO'}));[Console]::Out.WriteLine('WRITER_BASENAME|'+$baseClass)
 """+expected
    # Once the on-branch source incorporates the sealed file-id proof, run
    # the original, uninstrumented full EOF data contract in this disposable
    # working copy. Previous experimental writers no longer own this source.
    if expected not in original:
        if original.count('PublicWriterIdentity1905') < 1 or original.count('GetFileInformationByHandle') < 1:
            raise ValueError('WRITER_PARENT_SOURCE_CHANGED_UNKNOWN')
        Path(FIXTURE).write_text(fixture,encoding='utf8')
        Path(TEST).write_text(test_source,encoding='utf8')
        r=subprocess.run(['node','--test','--test-concurrency=1','--test-name-pattern=^public Windows EOF actor compiles as data',TEST],
                         capture_output=True,text=True,encoding='utf8',errors='replace',timeout=40)
        return {'exit':r.returncode,'verification':'ORIGINAL_SOURCE_BOUND_FULL_EOF_DATA_TEST','no_injected_output':True}
    revised=once(original,expected,observed)
    if identity_accept:
        # One-time DISPOSABLE comparison only: retain FileStream, zero-length,
        # CreateNew, foreign preservation, source-hash and all real test guards.
        # A Windows Volume/FileIndex match is mandatory when textual names differ.
        stronger="if($writer -isnot [IO.FileStream] -or (($writer.Name -cne $path) -and $fileIdentity -cne 'MATCH') -or $writer.Length -ne 0){throw 'ACTUAL_SOURCE_CREATE_NEW_REQUIRED'}"
        revised=once(revised,expected,stronger)
    if exact_load:
        # Bind the exact compiled artifact, not a PowerShell type-name cache.
        revised=once(revised,'$assembly=[PublicWindowsEofActor].Assembly;',
            '$assembly=[Reflection.Assembly]::LoadFile($assemblyPath);')
    controls=once(controls,embedded.group(0),embedded.group(0).replace(embedded.group(1),base64.b64encode(revised.encode()).decode()))
    updated_fixture=once(fixture,outer.group(0),outer.group(0).replace(outer.group(1),controls))
    marker="if(child.error!==undefined||child.status!==0||child.stderr!=='')console.log('GORIQ_PUBLIC_EOF_DATA_CONTROL_FAILURE '"
    prelude="if(child.stdout){const safe=child.stdout.split(/\\r?\\n/).filter(v=>/^WRITER_(?:TYPE|PATH|PATH_CASELESS|EMPTY|DIRECTORY|BASENAME|LOCATION_WRITER|CODEBASE_WRITER|LOCATION_EXPECTED|CODEBASE_EXPECTED|ACTOR_EXPECTED|EXPECTED_EXISTS|ACTUAL_EXISTS|IDENTITY|READOPEN)[|](?:YES|NO|STDOUT|STDERR|OTHER|NONE|MATCH|DIFFERENT|UNKNOWN)$/.test(v));if(safe.length)console.log('WRITER_SAFE_STAGES '+JSON.stringify(safe))}"
    # Only in the disposable diagnostics checkout: strip OUR added WRITER_*
    # lines before passing stdout to the unchanged original JSON/parser/assertions.
    # No real actor line, negative assertion, wire data or expected value is dropped.
    if identity_accept:
        scrub=("if(child.stdout){const lines=child.stdout.split(/\\r?\\n/);"
               "child.stdout=lines.filter(v=>!/^WRITER_(?:TYPE|PATH|PATH_CASELESS|EMPTY|DIRECTORY|BASENAME|LOCATION_WRITER|CODEBASE_WRITER|LOCATION_EXPECTED|CODEBASE_EXPECTED|ACTOR_EXPECTED|EXPECTED_EXISTS|ACTUAL_EXISTS|IDENTITY|READOPEN)[|](?:YES|NO|STDOUT|STDERR|OTHER|NONE|MATCH|DIFFERENT|UNKNOWN)$/.test(v)).join('\\n');}")
        prelude=prelude+scrub
    updated_test=once(test_source,marker,prelude+marker)
    Path(FIXTURE).write_text(updated_fixture,encoding='utf8')
    Path(TEST).write_text(updated_test,encoding='utf8')
    r=subprocess.run(['node','--test','--test-concurrency=1','--test-name-pattern=^public Windows EOF actor compiles as data',TEST],
        capture_output=True,text=True,encoding='utf8',errors='replace',timeout=40)
    matches=re.findall(r'WRITER_(?:TYPE|PATH|PATH_CASELESS|EMPTY|DIRECTORY|BASENAME|LOCATION_WRITER|CODEBASE_WRITER|LOCATION_EXPECTED|CODEBASE_EXPECTED|ACTOR_EXPECTED|EXPECTED_EXISTS|ACTUAL_EXISTS|IDENTITY|READOPEN)\|(?:YES|NO|STDOUT|STDERR|OTHER|NONE|MATCH|DIFFERENT|UNKNOWN)',r.stdout)
    observed_failure=re.search(r'GORIQ_PUBLIC_EOF_DATA_CONTROL_FAILURE (\{[^\r\n]+\})',r.stdout+"\n"+r.stderr)
    failure=None
    if observed_failure:
        try:
            record=json.loads(observed_failure.group(1))
            failure={k:record.get(k) for k in ('phase','code','category','nativeAuthority')}
        except ValueError: failure={'code':'UNPARSEABLE_PUBLIC_ENUM'}
    failure_kind='UNKNOWN'
    if r.returncode == 0: failure_kind='NONE'
    elif 'Unexpected token' in r.stdout or 'SyntaxError' in r.stdout: failure_kind='JSON_PARSE'
    elif 'AssertionError' in r.stdout or 'ERR_ASSERTION' in r.stdout: failure_kind='ASSERTION'
    elif 'ACTUAL_SOURCE_CREATE_NEW_REQUIRED' in r.stdout: failure_kind='CREATE_NEW'
    elif 'PUBLIC_' in r.stdout: failure_kind='PUBLIC_CONTRACT'
    return {'exit':r.returncode,'predicates':sorted(set(matches)), 'observed_predicate_count':len(matches), 'public_failure':failure, 'test_failure_kind':failure_kind}


def main():
    if sys.argv[1:]!=['--run'] or os.environ.get('GITHUB_REPOSITORY')!='haji84/AI-' or os.environ.get('RUNNER_ENVIRONMENT')!='github-hosted' or os.name!='nt': raise ValueError('HOSTED_WINDOWS_REQUIRED')
    for p,h in EXPECTED.items():
        if subprocess.check_output(['git','hash-object',p],text=True).strip()!=h: raise ValueError('SOURCE_DRIFT')
    out=Path(os.environ['RUNNER_TEMP'])/'pr1905-fixture-stage2';out.mkdir(exist_ok=False)
    data={p:Path(p).read_bytes() for p in EXPECTED};report={'schema':'PR1905_STAGE2_V1','production_accepted':False,'source_changed':False}
    try:
        report['decoder']=decoder(data[FIXTURE].decode(),out)
        report['decoder_explicit_values']=decoder(data[FIXTURE].decode(),out,True)
        report['decoder_renamed']=decoder(data[FIXTURE].decode(),out,False,True)
        report['writer_parent']=writer_parent(data[FIXTURE].decode(),data[TEST].decode(),out)
        for p,b in data.items(): Path(p).write_bytes(b)
        report['writer_parent_exact_load']=writer_parent(data[FIXTURE].decode(),data[TEST].decode(),out,True)
        for p,b in data.items(): Path(p).write_bytes(b)
        report['writer_parent_snapshot_origin']=writer_parent(data[FIXTURE].decode(),data[TEST].decode(),out,False,True)
        for p,b in data.items(): Path(p).write_bytes(b)
        report['writer_parent_identity_candidate']=writer_parent(data[FIXTURE].decode(),data[TEST].decode(),out,False,False,True)
        for p,b in data.items(): Path(p).write_bytes(b)
        # First split diagnosis: preserve byte-for-byte original native source.
        # Only the disposable public fixture gets fixed boolean breadcrumbs.
        # Combining a native-source mutation here can trigger pinned-source
        # rejection before the actual Clock/Job predicate is ever reached.
        Path(NATIVE).write_bytes(data[NATIVE])
        Path(FIXTURE).write_bytes(annotate_fixture(data[FIXTURE].decode()).encode())
        source=data[TEST].decode()
        source=source.replace("assert.equal(child.error,undefined);assert.equal(child.status,0", "if(child.stderr){const safe=child.stderr.split(/\\r?\\n/).filter(x=>/^(?:PIPE_(?:ENTER|OWNER|BEFORE_REFS|ITEM_EXCEPTION|ALL|REFS3|NEWVAR|NEWVAR_REASON|NEWVAR_FQID|EXCEPTION_CLASS|CAP_CONFIG|CAP_NEAR|CAP_USED|PRE_SCRIPT|PRE_LOCAL|PRE_GLOBAL|PRE_UP[123]|TUPLE|UNIQUE|API|LOOKUP|OUTER|INMEMORY_INSTALLED)|JOB_NATIVE_STAGE|CLOCK_(?:MARK|CONTAINMENT|EXITED|WATCH|JOB_OWNER|JOB_CLOSED|OWNER_CLOSED|STARTED|CERT_CLOSED|PIPE_CLOSED|OWNER_CHECK)|JOB_(?:SAME_HANDLE|SAME_BIRTH|ACTOR_EXITED|PIPES_CLOSED|STATE_CLOSED|OWNER_RESOLVED|CANONICAL_PRESENT|CANONICAL_EXISTS|STARTED_PRESENT|OWNER_CLOSED|ORIGIN_EXISTS|ORIGIN_CONSTANT|ORIGIN_TUPLE|ORIGIN_MODULE|REF_STREAMS|REF_HANDLES|REF_DISTINCT|REF_HELD[012]|PIPE[012]_CLOSED|REFS_3|REFS_EMPTY|CONSTRUCTOR|STARTED_SAME|STARTINFO_SAME|CERT_HANDLE|CERT_BIRTH))(?:\\|[A-Za-z0-9_-]{1,180})*$/.test(x));if(safe.length)console.log('CLOSED_STAGE '+JSON.stringify(safe.slice(-45)));}assert.equal(child.error,undefined);assert.equal(child.status,0")
        Path(TEST).write_bytes(source.encode())
        pattern='^(clock R2 refusal cleans|private original-State owned Job finite policy and cleanup group2|Windows private original-State Job contains|private owned Job thrown close)'
        start=time.monotonic();r=subprocess.run(['node','--test','--test-concurrency=1','--test-name-pattern='+pattern,TEST],capture_output=True,text=True,encoding='utf8',errors='replace',timeout=120)
        rows=[]
        for line in r.stdout.splitlines():
            mark=line.find('CLOSED_STAGE ')
            if mark>=0:
                try: rows.extend(json.loads(line[mark+13:]))
                except (ValueError,TypeError): pass
        fixed=re.findall(r'(?:PIPE_(?:ENTER|OWNER|BEFORE_REFS|ALL|REFS3|NEWVAR|NEWVAR_REASON|NEWVAR_FQID|EXCEPTION_CLASS|CAP_CONFIG|CAP_NEAR|CAP_USED|PRE_SCRIPT|PRE_LOCAL|PRE_GLOBAL|PRE_UP[123]|TUPLE|UNIQUE|INMEMORY_INSTALLED)|CLOCK_(?:MARK|CONTAINMENT|EXITED|WATCH|JOB_OWNER|JOB_CLOSED|OWNER_CLOSED|STARTED|CERT_CLOSED|PIPE_CLOSED|OWNER_CHECK)|JOB_(?:SAME_HANDLE|SAME_BIRTH|ACTOR_EXITED|PIPES_CLOSED|STATE_CLOSED|OWNER_RESOLVED|CANONICAL_PRESENT|CANONICAL_EXISTS|STARTED_PRESENT|OWNER_CLOSED|ORIGIN_EXISTS|ORIGIN_CONSTANT|ORIGIN_TUPLE|ORIGIN_MODULE|REF_STREAMS|REF_HANDLES|REF_DISTINCT|REF_HELD[012]|PIPE[012]_CLOSED|REFS_3|REFS_EMPTY|CONSTRUCTOR|STARTED_SAME|STARTINFO_SAME|CERT_HANDLE|CERT_BIRTH))\|(?:YES|NO|BEFORE|AFTER)',r.stdout+'\n'+r.stderr)
        report['cleanup']={'exit':r.returncode,'seconds':round(time.monotonic()-start,3),
            'fixed_stage_rows':rows[:100], 'fixed_predicates':sorted(set(fixed))[:30],
            'original_native_hash_pinned':True}
        # Run the exact failed public fixture in a fresh isolated test process
        # with only original ownership checks plus original wrapper disposal.
        for p,b in data.items(): Path(p).write_bytes(b)
        Path(NATIVE).write_bytes(cleanup_wrapper_candidate(data[NATIVE].decode()).encode())
        pattern='^(private original-State owned Job finite policy and cleanup group2|clock R2 refusal cleans|Windows private original-State Job contains|private owned Job thrown close)'
        start=time.monotonic()
        v=subprocess.run(['node','--test','--test-concurrency=1','--test-name-pattern='+pattern,TEST],
                          capture_output=True,text=True,encoding='utf8',errors='replace',timeout=125)
        markers=sorted(set(re.findall(r'(?:CUTOVER_BOOTSTRAP_FIXTURE|PEER_FIXTURE|PUBLIC_CLOCK|JOB_WINDOWS)_[A-Z0-9_]{1,120}',v.stdout+v.stderr)))
        report['candidate_pipe_wrappers']={'exit':v.returncode,'seconds':round(time.monotonic()-start,3),'failure_codes':markers[:25]}
        # Candidate never changes native script files, actual credentials or
        # acceptance assertions; it is a bounded temporary module operation.
        for p,b in data.items(): Path(p).write_bytes(b)
        Path(FIXTURE).write_bytes(annotate_fixture(data[FIXTURE].decode(),True).encode())
        Path(TEST).write_bytes(source.encode())
        start=time.monotonic()
        a=subprocess.run(['node','--test','--test-concurrency=1','--test-name-pattern='+pattern,TEST],
                         capture_output=True,text=True,encoding='utf8',errors='replace',timeout=120)
        api=re.findall(r'PIPE_API\|(?:PASS|[A-Za-z]{3,45})',a.stdout+'\n'+a.stderr)
        detail=re.findall(r'(?:CUTOVER_BOOTSTRAP_FIXTURE|PUBLIC_CLOCK|JOB_WINDOWS)_[A-Z0-9_]{1,120}',a.stdout+'\n'+a.stderr)
        # Only report known, bounded phase booleans from disposable test stdout.
        # A single API PASS may belong to a passing case rather than assign-fail.
        api_proof=re.findall(r'(?:PIPE_(?:API|LOOKUP)|JOB_(?:CANONICAL_EXISTS|STATE_CLOSED|PIPES_CLOSED|PIPE[012]_CLOSED|OWNER_RESOLVED|OWNER_CLOSED)|CLOCK_(?:CONTAINMENT|PIPE_CLOSED|JOB_CLOSED|OWNER_CLOSED))\|(?:PASS|YES|NO|[A-Za-z]{3,40})',a.stdout+'\n'+a.stderr)
        report['module_api_lookup_candidate']={'exit':a.returncode,'seconds':round(time.monotonic()-start,3),
            'api_states':sorted(set(api))[:12], 'api_proof_rows':api_proof[-80:], 'failure_codes':sorted(set(detail))[:15],
            'original_native_unchanged':True,'production_accepted':False}
        for p,b in data.items(): Path(p).write_bytes(b)
        on_branch="EARLY_CERT_ORIGIN" in data[NATIVE].decode()
        # Once this source is under test, run original unmodified assertions.
        # Never falsely count a second injected helper as original behavior.
        Path(FIXTURE).write_bytes(data[FIXTURE] if on_branch else annotate_fixture(data[FIXTURE].decode(),early_cert_candidate=True).encode())
        # The candidate is checked by the byte-for-byte ORIGINAL Node tests.
        # Do not hide any runtime stderr; candidate emits none when successful.
        Path(TEST).write_bytes(data[TEST])
        started=time.monotonic()
        early_result=subprocess.run(['node','--test','--test-concurrency=1','--test-name-pattern='+pattern,TEST],
                         capture_output=True,text=True,encoding='utf8',errors='replace',timeout=120)
        early_rows=re.findall(r'PIPE_EARLY(?:_INSTALLED)?\|(?:PASS|FAIL|YES|NO)',early_result.stdout+'\n'+early_result.stderr)
        failure_codes=sorted(set(re.findall(r'(?:CUTOVER_BOOTSTRAP_FIXTURE|PUBLIC_CLOCK|JOB_WINDOWS)_[A-Z0-9_]{1,120}',early_result.stdout+'\n'+early_result.stderr)))
        # Only emit test names from a pre-authorized four-case whitelist, not
        # stderr, filesystem paths, underlying runtime messages or secrets.
        public_cases=('clock R2 refusal cleans','private original-State owned Job finite policy and cleanup group2',
          'Windows private original-State Job contains','private owned Job thrown close')
        outcomes={}
        for case in public_cases:
            failed=bool(re.search(r'(?m)^.*(?:✖|not ok [0-9]+ -)\s*'+re.escape(case),early_result.stdout))
            passed=bool(re.search(r'(?m)^.*(?:✔|ok [0-9]+ -)\s*'+re.escape(case),early_result.stdout))
            outcomes[case]='FAIL' if failed else 'PASS' if passed else 'UNKNOWN'
        # Untrusted child text is narrowed to fixed public case IDs and
        # fixed non-secret stage names only. No raw stderr, paths or handles.
        phase_proof=[]
        permitted=('process-mirror','all-mirrors','early-start-refusal','source-before-entry','certificate-mismatch')
        for observation in re.finditer(r'GORIQ_PUBLIC_CLOCK_CASE_PROGRESS (\{[^\r\n]{1,16000}\})',early_result.stdout):
            try:
                value=json.loads(observation.group(1))
                if value.get('case') not in permitted: continue
                rows=value.get('rows',[])
                rows=[row for row in rows if isinstance(row,str) and re.fullmatch(r'[A-Z_]{3,70}:[0-9]{1,9}',row)]
                phase_proof.append({'case':value['case'],'last_phases':rows[-10:]})
            except (ValueError,TypeError,AttributeError): pass
        report['early_cert_candidate']={'exit':early_result.returncode,'seconds':round(time.monotonic()-started,3),
          'stages':early_rows[-24:],'failure_codes':failure_codes[:15],'case_outcomes':outcomes,
          'clock_phases':phase_proof[:8],'original_source_under_test':on_branch, 'production_accepted':False}
    finally:
        for p,b in data.items(): Path(p).write_bytes(b)
        (out/'report.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2))
    sys.exit(1)

if __name__=='__main__':main()
