# Test-only: execute each reviewed inert fixture in a fresh PowerShell runspace.
# Process/static/native-isolation tests must keep their original fresh processes.
$ErrorActionPreference='Stop'
Add-Type @'
using System;
using System.Globalization;
using System.Management.Automation.Host;
public sealed class GoriqFixtureBatchHost : PSHost {
  private readonly Guid id = Guid.NewGuid();
  public int ExitCode = 0;
  public override Guid InstanceId { get { return id; } }
  public override string Name { get { return "GoriqFixtureBatch"; } }
  public override Version Version { get { return new Version(1, 0); } }
  public override PSHostUserInterface UI { get { return null; } }
  public override CultureInfo CurrentCulture { get { return CultureInfo.CurrentCulture; } }
  public override CultureInfo CurrentUICulture { get { return CultureInfo.CurrentUICulture; } }
  public override void SetShouldExit(int code) { ExitCode = code; }
  public override void EnterNestedPrompt() { throw new InvalidOperationException("PS_FIXTURE_INTERACTIVE_REFUSED"); }
  public override void ExitNestedPrompt() { throw new InvalidOperationException("PS_FIXTURE_INTERACTIVE_REFUSED"); }
  public override void NotifyBeginApplication() { }
  public override void NotifyEndApplication() { }
}
'@
$request=[Console]::In.ReadToEnd()|ConvertFrom-Json
$rows=@()
foreach($scenario in $request.scenarios) {
  $initialEnvironment=[Environment]::GetEnvironmentVariables()
  $initialDirectory=[Environment]::CurrentDirectory
  $hostRecord=[GoriqFixtureBatchHost]::new()
  $state=[Management.Automation.Runspaces.InitialSessionState]::CreateDefault()
  $runspace=[Management.Automation.Runspaces.RunspaceFactory]::CreateRunspace($hostRecord,$state)
  $runspace.Open()
  $pipeline=[PowerShell]::Create();$pipeline.Runspace=$runspace
  $output=@();$errors=@();$status=0
  try {
    $arguments=@{};$arguments[[string]$request.parameter]=[string]$scenario
    foreach($property in $request.parameters.PSObject.Properties) {
      $arguments[$property.Name]=[string]$property.Value
    }
    # Native -File puts its top-level functions in the runspace's global scope.
    # An AddCommand file creates a child scope and breaks GetNewClosure callbacks
    # resolving those functions. Dot-source into this case's fresh global scope;
    # pass data as arguments, never interpolate it into PowerShell source.
    $null=$pipeline.AddScript('param($fixtureFile,$fixtureArguments) . $fixtureFile @fixtureArguments',$false).AddArgument([string]$request.fixture).AddArgument($arguments)
    try { $output=@($pipeline.Invoke()|ForEach-Object {[string]$_}) }
    catch { $errors+=@([string]$_);$status=1 }
    foreach($stream in @('Error','Warning','Verbose','Debug','Information')) {
      $errors+=@($pipeline.Streams.$stream|ForEach-Object {[string]$_})
    }
    # A file command's explicit exit is surfaced as LASTEXITCODE; a top-level
    # host exit uses SetShouldExit. Reject both. Fixtures intentionally retaining
    # a failed native child's exit code keep their original process path.
    $lastExit=$runspace.SessionStateProxy.GetVariable('LASTEXITCODE')
    if($hostRecord.ExitCode -ne 0) { $status=$hostRecord.ExitCode }
    elseif($null -ne $lastExit -and $lastExit -ne 0) { $status=[int]$lastExit }
    elseif($errors.Count -gt 0 -or $pipeline.InvocationStateInfo.State -ne 'Completed') { $status=1 }
    $currentEnvironment=[Environment]::GetEnvironmentVariables()
    $changed=$initialDirectory -cne [Environment]::CurrentDirectory -or $currentEnvironment.Count -ne $initialEnvironment.Count
    foreach($key in $initialEnvironment.Keys) {
      if(-not $currentEnvironment.Contains($key) -or $currentEnvironment[$key] -cne $initialEnvironment[$key]) {$changed=$true}
    }
    if($changed) { $status=1;$errors+=@('PS_FIXTURE_PROCESS_STATE_CHANGED') }
    $stdout=($output -join "`n");if($output.Count -gt 0){$stdout+="`n"}
    $stderr=($errors -join "`n")
    if([Text.Encoding]::UTF8.GetByteCount($stdout) -gt 131072 -or [Text.Encoding]::UTF8.GetByteCount($stderr) -gt 131072) {
      throw 'PS_FIXTURE_OUTPUT_BOUND'
    }
    $rows+=@{scenario=[string]$scenario;status=$status;stdout=$stdout;stderr=$stderr}
  } finally {
    $pipeline.Dispose();$runspace.Dispose()
    # A changed process environment is a failure, and must not reach later cases.
    foreach($key in @([Environment]::GetEnvironmentVariables().Keys)) {
      if(-not $initialEnvironment.Contains($key)) {[Environment]::SetEnvironmentVariable([string]$key,$null)}
    }
    foreach($key in $initialEnvironment.Keys) {[Environment]::SetEnvironmentVariable([string]$key,[string]$initialEnvironment[$key])}
    [Environment]::CurrentDirectory=$initialDirectory
  }
}
@{version=1;cases=@($rows)}|ConvertTo-Json -Depth 5 -Compress
