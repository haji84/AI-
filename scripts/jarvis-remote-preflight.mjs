import { execFileSync } from 'node:child_process';
import { looksLikePublicFunnel, privateServeUrl, tailscaleBackendIsRunning } from './jarvis-remote-access-lib.mjs';

const dashboardPort = Number(process.env.JARVIS_DASHBOARD_PORT || 3000);
const tailscale = process.platform === 'win32' ? 'tailscale.exe' : 'tailscale';

function run(args, options = {}) {
  try {
    return execFileSync(tailscale, args, {
      encoding: 'utf8',
      timeout: options.timeout ?? 15_000,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch (error) {
    const stdout = String(error?.stdout || '').trim();
    const stderr = String(error?.stderr || '').trim();
    const detail = [stdout, stderr, error?.message].filter(Boolean).join('\n');
    if (options.allowFailure) return detail;
    throw new Error(`tailscale ${args.join(' ')} failed: ${detail}`);
  }
}

async function checkHttp(name, url, optional = false) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(5_000), redirect: 'follow' });
    if (response.status >= 500) throw new Error(`HTTP ${response.status}`);
    console.log(`PASS ${name}: ${url} -> HTTP ${response.status}`);
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (optional) {
      console.warn(`WARN ${name}: ${message}`);
      return false;
    }
    throw new Error(`${name} unavailable at ${url}: ${message}`);
  }
}

let status;
try {
  status = JSON.parse(run(['status', '--json']));
} catch (error) {
  console.error(`REMOTE_ACCESS_REFUSED: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(2);
}

if (!tailscaleBackendIsRunning(status)) {
  console.error(`REMOTE_ACCESS_REFUSED: Tailscale is not Running (state=${status?.BackendState || 'unknown'}). Sign in and connect this host first.`);
  process.exit(2);
}

const privateUrl = privateServeUrl(status);
if (!privateUrl) {
  console.error('REMOTE_ACCESS_REFUSED: Tailscale DNSName is unavailable. Enable MagicDNS/HTTPS in the tailnet first.');
  process.exit(2);
}

const funnelStatus = run(['funnel', 'status'], { allowFailure: true });
if (looksLikePublicFunnel(funnelStatus)) {
  console.error('REMOTE_ACCESS_REFUSED: public Tailscale Funnel appears active. Disable Funnel before enabling JARVIS remote access.');
  process.exit(2);
}

run(['serve', '--bg', '--yes', String(dashboardPort)], { timeout: 30_000 });
const serveStatus = run(['serve', 'status'], { allowFailure: true });
if (looksLikePublicFunnel(serveStatus)) {
  console.error('REMOTE_ACCESS_REFUSED: Serve status indicates public Funnel exposure.');
  process.exit(2);
}

await checkHttp('dashboard', `http://127.0.0.1:${dashboardPort}`, true);
await checkHttp('broker', 'http://127.0.0.1:8787/health', true);
await checkHttp('remote gateway', 'http://127.0.0.1:8790/health', true);

console.log(`REMOTE_ACCESS_READY: ${privateUrl}`);
console.log('This URL is tailnet-private. Keep Tailscale connected on the remote phone; do not enable Funnel.');
