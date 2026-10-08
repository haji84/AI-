#!/usr/bin/env node
export function formatDevicectlFailure(exitCode: number, output: string, operation = "devicectl list devices"): string {
  const printable = [...output].filter((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code === 9 || code === 10 || code === 13 || (code >= 32 && code !== 127);
  }).join("");
  const redacted = printable
    .replace(/\/Users\/[^/\s]+/g, "/Users/[REDACTED]")
    .replace(/\b[0-9a-f]{8}-[0-9a-f-]{8,}\b/gi, "[DEVICE-ID-REDACTED]")
    .trim();
  const safeOperation = /^[a-zA-Z0-9 .-]{1,80}$/.test(operation) ? operation : "device command";
  return `${safeOperation} failed (exit ${exitCode})${redacted ? `\n${redacted}` : "\nNo diagnostic output was returned."}`;
}
