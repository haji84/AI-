export function restartDelayMs(attempt, baseMs = 1_000, maxMs = 30_000) {
  const safeAttempt = Number.isInteger(attempt) && attempt > 0 ? attempt : 1;
  const safeBase = Number.isFinite(baseMs) && baseMs > 0 ? baseMs : 1_000;
  const safeMax = Number.isFinite(maxMs) && maxMs >= safeBase ? maxMs : 30_000;
  return Math.min(safeMax, safeBase * (2 ** Math.min(safeAttempt - 1, 10)));
}

export function looksLikePublicFunnel(statusText) {
  const value = String(statusText || "").toLowerCase();
  if (!value.trim()) return false;
  return value.includes("available on the internet") ||
    value.includes("funnel on") ||
    value.includes('"funnel":true') ||
    value.includes('"allowfunnel":true');
}

export function tailscaleBackendIsRunning(status) {
  const backendState = String(status?.BackendState || status?.backendState || "").toLowerCase();
  return backendState === "running";
}

export function privateServeUrl(status) {
  const dnsName = String(status?.Self?.DNSName || status?.self?.dnsName || "").replace(/\.$/, "");
  return dnsName ? `https://${dnsName}` : null;
}
