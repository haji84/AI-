"""Exact source-bound candidate, no timeout/acceptance changes."""
def once(s,a,b):
    if s.count(a)!=1: raise ValueError('PIPELINE_ANCHOR_REQUIRED')
    return s.replace(a,b,1)

def patch(source):
    source=once(source,'function New-PublicPrivateJobDriver([int]$Group,[string]$InputJson){','function New-PublicPrivateJobDriver([int]$Group,[string]$InputJson,[switch]$PrepareOnly){')
    source=once(source,"try{Require ($p.Start()) 'JOB_FIXED_MANAGER_START';",
        "try{$priorDriverInputEncoding=[Console]::InputEncoding;try{[Console]::InputEncoding=$driverUtf8;Require ($p.Start()) 'JOB_FIXED_MANAGER_START'}finally{[Console]::InputEncoding=$priorDriverInputEncoding};")
    source=once(source,'$wire=[byte[]]$driverUtf8.GetBytes($InputJson+[char]10);',
        "Require ($p.StandardInput.Encoding.GetPreamble().Length -eq 0 -and $p.StandardInput.Encoding.CodePage -eq 65001) 'JOB_ACTUAL_DRIVER_WRITER_BOM_FREE_REQUIRED';$wire=[byte[]]$driverUtf8.GetBytes($InputJson+[char]10);")
    old="$line=Read-PublicPrivateJobLine $p.StandardOutput 4096;if($Group -eq 2){$script:jobWindowsPhase='EARLY_CHILD_LINE'};$data=$line|Microsoft.PowerShell.Utility\\ConvertFrom-Json;if($Group -eq 2){$script:jobWindowsPhase='EARLY_CHILD_PARSED'};return @{held=$held;data=$data;stderr=$stderr;info=$info}"
    new="$driver=@{held=$held;data=$null;stderr=$stderr;info=$info;group=$Group;readConsumed=$false};if(-not $PrepareOnly){Complete-PublicPrivateJobDriver $driver};return $driver"
    source=once(source,old,new)
    helper="""function Complete-PublicPrivateJobDriver($Driver){
 Assert-PublicPrivateJobCaseBudget;Require ($Driver -is [hashtable] -and -not $Driver.readConsumed -and $Driver.group -in @(1,2) -and $Driver.held -is [Tuple[object,IntPtr,long]]) 'JOB_PREPARED_DRIVER_REQUIRED'
 $Driver.readConsumed=$true;$line=Read-PublicPrivateJobLine $Driver.held.Item1.StandardOutput 4096
 if($Driver.group -eq 2){$script:jobWindowsPhase='EARLY_CHILD_LINE'};$Driver.data=$line|Microsoft.PowerShell.Utility\\ConvertFrom-Json
 if($Driver.group -eq 2){$script:jobWindowsPhase='EARLY_CHILD_PARSED'}
}
"""
    source=once(source,'function Stop-PublicPrivateJobAllocatedProcess($Held){',helper+'function Stop-PublicPrivateJobAllocatedProcess($Held){')
    source=once(source," try{if($usePublicActor){$publicActor=Open-PublicWindowsEofActor",
        " $preparedDrivers=@{};try{if($OwnedJobWindows -and $TransportGroup -eq 0){foreach($preparedGroup in @(2,1)){$preparedDrivers[$preparedGroup]=New-PublicPrivateJobDriver $preparedGroup $publicInput -PrepareOnly}};if($usePublicActor){$publicActor=Open-PublicWindowsEofActor")
    source=once(source,'$earlyDriver=New-PublicPrivateJobDriver 2 $publicInput;',
        '$earlyDriver=$preparedDrivers[2];Complete-PublicPrivateJobDriver $earlyDriver;')
    source=once(source,'$driver=New-PublicPrivateJobDriver 1 $publicInput;$message=',
        '$driver=$preparedDrivers[1];Complete-PublicPrivateJobDriver $driver;$message=')
    source=once(source,'}}}finally{if($publicActorStage){',
        "}}}finally{$preparedCleanup=$true;foreach($prepared in $preparedDrivers.Values){if(-not (Stop-PublicPrivateJobAllocatedProcess $prepared.held)){$preparedCleanup=$false}};if(-not $preparedCleanup){throw 'JOB_PREPARED_DRIVER_CLEANUP_UNCONFIRMED'};if($publicActorStage){")
    return source
