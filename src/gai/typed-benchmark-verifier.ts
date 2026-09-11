export type BenchmarkVerifier =
  | { type: "exact"; expected: string }
  | { type: "contains"; expected: string }
  | { type: "number"; expected: number; tolerance?: number }
  | { type: "json"; expected: unknown }
  | { type: "set"; expected: string[] };

export function normalizeBenchmarkOutput(value: unknown): string {
  return String(value ?? "")
    .trim()
    .replace(/```(?:json|javascript|typescript|js|ts)?/gi, "")
    .replace(/```/g, "")
    .trim();
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(Object.keys(record).sort().map((key) => [key, canonical(record[key])]));
  }
  return value;
}

export function verifyTypedBenchmark(verifier: BenchmarkVerifier, output: unknown): boolean {
  const text = normalizeBenchmarkOutput(output);
  if (verifier.type === "exact") {
    return text.replace(/\s+/g, " ").toLowerCase() === verifier.expected.trim().replace(/\s+/g, " ").toLowerCase();
  }
  if (verifier.type === "contains") return text.toLowerCase().includes(verifier.expected.toLowerCase());
  if (verifier.type === "number") {
    const match = text.match(/[-+]?\d+(?:\.\d+)?(?:e[-+]?\d+)?/i);
    if (!match) return false;
    const actual = Number(match[0]);
    return Number.isFinite(actual) && Math.abs(actual - verifier.expected) <= (verifier.tolerance ?? 0);
  }
  if (verifier.type === "json") {
    try {
      return JSON.stringify(canonical(JSON.parse(text))) === JSON.stringify(canonical(verifier.expected));
    } catch {
      return false;
    }
  }
  const clean = text.replace(/^\[/, "").replace(/\]$/, "").trim();
  const actual = clean ? clean.split(",").map((item) => item.trim().replace(/^['"]|['"]$/g, "")).filter(Boolean).sort() : [];
  const expected = [...verifier.expected].map(String).sort();
  return JSON.stringify(actual) === JSON.stringify(expected);
}
