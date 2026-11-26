param([string]$Scenario,[string]$FixtureRoot)

# owner-code-preflight-1218.ps1 intentionally normalizes only PSModulePath.
# Preserve that production operation and its exact case source, then restore the
# prior value before the generic worker's strict environment comparison. Any
# other value is an error; all other environment mutations remain worker errors.
$goriqPreflightOriginalModulePath=[Environment]::GetEnvironmentVariable('PSModulePath')
try {
  . ([IO.Path]::Combine($FixtureRoot,($Scenario+'.ps1')))
} finally {
  $goriqPreflightFinalModulePath=[Environment]::GetEnvironmentVariable('PSModulePath')
  [Environment]::SetEnvironmentVariable('PSModulePath',$goriqPreflightOriginalModulePath)
  if($goriqPreflightFinalModulePath -cne $goriqPreflightOriginalModulePath -and
     $goriqPreflightFinalModulePath -cne [IO.Path]::Combine($PSHOME,'Modules')) {
    # Keep an already propagating terminating error or exit intact. The generic
    # worker also rejects every nonterminating error in this stream.
    Microsoft.PowerShell.Utility\Write-Error 'PS_PREFLIGHT_MODULE_PATH_CHANGED' -ErrorAction Continue
  }
}
