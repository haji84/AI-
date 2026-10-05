export function restartDelayMs(attempt: number, baseMs?: number, maxMs?: number): number;
export function looksLikePublicFunnel(statusText: string): boolean;
export function inspectPrivateIngress(output: string, options?: {
  commandSucceeded?: boolean; dashboardPort?: number; dnsName?: string; protectedLocalPorts?: number[];
}): { state: "unknown" | "public" | "private" | "unconfigured"; ready: boolean; reason: string };
export function serviceHealthMatches(name: string, status: number, body: unknown): boolean;
export function tailscaleBackendIsRunning(status: unknown): boolean;
export function privateServeUrl(status: unknown): string | null;
