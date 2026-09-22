export function restartDelayMs(attempt, baseMs = 1_000, maxMs = 30_000) {
  const safeAttempt = Number.isInteger(attempt) && attempt > 0 ? attempt : 1;
  const safeBase = Number.isFinite(baseMs) && baseMs > 0 ? baseMs : 1_000;
  const safeMax = Number.isFinite(maxMs) && maxMs >= safeBase ? maxMs : 30_000;
  return Math.min(safeMax, safeBase * (2 ** Math.min(safeAttempt - 1, 10)));
}

export function looksLikePublicFunnel(statusText) {
  try { if (funnelState(JSON.parse(String(statusText))) === 'public') return true; } catch {}
  const value = String(statusText || "").toLowerCase();
  if (!value.trim()) return false;
  return value.includes("available on the internet") ||
    value.includes("funnel on") ||
    /"(?:funnel|allowfunnel)"\s*:\s*true/.test(value);
}

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function funnelState(config) {
  if (!object(config)) return 'unknown';
  let state = 'private';
  for (const [key, value] of Object.entries(config)) {
    if (['allowfunnel', 'funnel'].includes(key.toLowerCase())) {
      const flags = object(value) ? Object.values(value) : [value];
      if (flags.includes(true)) return 'public';
      if (flags.some(flag => flag !== false)) state = 'unknown';
    } else if (object(value)) {
      const nested = funnelState(value);
      if (nested === 'public') return 'public';
      if (nested === 'unknown') state = 'unknown';
    }
  }
  return state;
}

function protectedBackendProxy(config, protectedLocalPorts) {
  if (!object(config)) return null;
  for (const [key, value] of Object.entries(config)) {
    if (key.toLowerCase() === 'proxy' && typeof value === 'string') {
      try {
        const target = new URL(value);
        const port = Number(target.port || (target.protocol === 'https:' ? 443 : 80));
        if (protectedLocalPorts.includes(port)) return target.toString();
      } catch {
        // Shape validation below remains responsible for malformed Serve configuration.
      }
    }
    if (object(value)) {
      const nested = protectedBackendProxy(value, protectedLocalPorts);
      if (nested) return nested;
    }
  }
  return null;
}

// Call with successful `tailscale serve status --json` output only.
// Unknown/failed responses must never be reported as proof of private ingress.
export function inspectPrivateIngress(output, { commandSucceeded = true, dashboardPort = 3000, dnsName, protectedLocalPorts = [8787, 8790] } = {}) {
  if (!commandSucceeded) return { state: 'unknown', ready: false, reason: 'Tailscale status command failed' };
  let config;
  try { config = JSON.parse(String(output)); } catch { return { state: 'unknown', ready: false, reason: 'Invalid Tailscale status JSON' }; }
  if (config === null) return { state: 'unconfigured', ready: false, reason: 'No Serve configuration yet' };
  if (!object(config)) return { state: 'unknown', ready: false, reason: 'Tailscale configuration unavailable' };
  const state = funnelState(config);
  if (state !== 'private') return { state, ready: false, reason: state === 'public' ? 'Public Funnel enabled' : 'Invalid Funnel configuration' };
  const known = new Set(['TCP', 'Web', 'AllowFunnel', 'Foreground', 'Services']);
  if (Object.entries(config).some(([key, value]) => !known.has(key) || !object(value))) return { state: 'unknown', ready: false, reason: 'Unrecognized Serve configuration shape' };
  const protectedTarget = protectedBackendProxy(config, protectedLocalPorts);
  if (protectedTarget) return { state: 'unknown', ready: false, reason: `Protected backend exposed directly through private ingress: ${protectedTarget}` };
  const expectedProxy = `http://127.0.0.1:${dashboardPort}`;
  const expectedHost = typeof dnsName === 'string' ? `${dnsName.replace(/\.$/, '')}:443` : null;
  const configured = config.TCP?.['443']?.HTTPS === true && object(config.Web) && Object.entries(config.Web).some(([host, server]) =>
    (!expectedHost || host === expectedHost) && server?.Handlers?.['/']?.Proxy === expectedProxy);
  return { state: configured ? 'private' : 'unconfigured', ready: configured, reason: configured ? 'Private HTTPS routes to the loopback dashboard' : 'Expected private HTTPS dashboard route is missing' };
}

export function serviceHealthMatches(name, status, body) {
  if (status !== 200 || !object(body)) return false;
  return name === 'dashboard' ? body.status === 'ok' : body.ok === true && body.service === `jarvis-${name}`;
}

export function tailscaleBackendIsRunning(status) {
  const backendState = String(status?.BackendState || status?.backendState || "").toLowerCase();
  return backendState === "running";
}

export function privateServeUrl(status) {
  const dnsName = String(status?.Self?.DNSName || status?.self?.dnsName || "").replace(/\.$/, "");
  return dnsName ? `https://${dnsName}` : null;
}
