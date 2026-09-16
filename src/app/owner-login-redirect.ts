const FALLBACK = "/jarvis";

export function safeOwnerReturnPath(requested: unknown): string {
  if (typeof requested !== "string" || !requested.startsWith("/") || requested.startsWith("//")) return FALLBACK;
  const unsafe = (text: string) => [...text].some(char => char === "\\" || char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127);
  if (unsafe(requested)) return FALLBACK;
  try {
    const parsed = new URL(requested, "https://jarvis.invalid");
    const decodedPath = decodeURIComponent(parsed.pathname);
    if (parsed.origin !== "https://jarvis.invalid" || parsed.pathname.startsWith("//") || decodedPath.startsWith("//") || unsafe(decodedPath)) return FALLBACK;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch { return FALLBACK; }
}

export function ownerLoginLocation(requested: unknown, failed = false): string {
  const next = safeOwnerReturnPath(requested);
  // A relative Location preserves the browser's origin even behind a local proxy.
  return failed ? `/jarvis/login?error=1&next=${encodeURIComponent(next)}` : next;
}
