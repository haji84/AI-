param(
  [string]$Repository = 'haji84/AI-'
)

$ErrorActionPreference = 'Stop'
$Workflow = 'goriq-repair-engines-runtime.yml'

foreach ($command in @('gh','node')) {
  if (-not (Get-Command $command -ErrorAction SilentlyContinue)) {
    throw "$command is required."
  }
}

& gh auth status | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'GitHub CLI is not authenticated.' }

Write-Host 'Opening Groq API Keys page...'
Start-Process 'https://console.groq.com/keys'
Write-Host 'Create/copy a Free Plan API key in the browser, then return here.'
$secure = Read-Host 'Groq API key' -AsSecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
$plain = ''
try {
  $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
  if ([string]::IsNullOrWhiteSpace($plain)) { throw 'Groq API key is empty.' }

  $env:GROQ_API_KEY = $plain
  $validate = @'
const key = process.env.GROQ_API_KEY || "";
const response = await fetch("https://api.groq.com/openai/v1/models", {
  headers: { Authorization: `Bearer ${key}` },
  signal: AbortSignal.timeout(15000),
});
if (!response.ok) {
  process.stderr.write(`ERROR: Groq API key validation failed (HTTP ${response.status}).\n`);
  process.exit(1);
}
const payload = await response.json();
const models = Array.isArray(payload?.data) ? payload.data.map((item) => item?.id).filter(Boolean) : [];
if (!models.includes("qwen/qwen3.8-27b")) {
  process.stderr.write("ERROR: Groq key is valid but qwen/qwen3.8-27b is not available to this account.\n");
  process.exit(1);
}
process.stdout.write("Groq Free Plan API key validated; qwen/qwen3.8-27b is available.\n");
'@
  $validate | & node
  if ($LASTEXITCODE -ne 0) { throw 'Groq API key validation failed.' }

  $plain | & gh secret set GROQ_API_KEY --repo $Repository
  if ($LASTEXITCODE -ne 0) { throw 'Failed to store GROQ_API_KEY in GitHub Actions secrets.' }

  Write-Host "GROQ_API_KEY stored as a GitHub Actions repository secret for $Repository."
  Write-Host 'The key was not written to the repository.'

  & gh workflow run $Workflow --repo $Repository --ref main
  if ($LASTEXITCODE -ne 0) { throw 'Failed to dispatch GORIQ Repair Engines Runtime verification.' }
  Write-Host 'GORIQ Repair Engines Runtime verification dispatched.'
} finally {
  Remove-Item Env:GROQ_API_KEY -ErrorAction SilentlyContinue
  if ($bstr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
  $plain = $null
}
