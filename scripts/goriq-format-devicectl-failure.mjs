#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

export function formatDevicectlFailure(exitCode, output) {
  const printable = [...output].filter((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code === 9 || code === 10 || code === 13 || (code >= 32 && code !== 127);
  }).join("");
  const redacted = printable
    .replace(/\/Users\/[^/\s]+/g, "/Users/[REDACTED]")
    .replace(/\b[0-9a-f]{8}-[0-9a-f-]{8,}\b/gi, "[DEVICE-ID-REDACTED]")
    .trim();
  return `devicectl list devices failed (exit ${exitCode})${redacted ? `\n${redacted}` : "\nNo diagnostic output was returned."}`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [exitCodeValue, outputFile] = process.argv.slice(2);
  if (!exitCodeValue || !outputFile) throw new Error("usage: goriq-format-devicectl-failure.mjs <exit-code> <output-file>");
  const exitCode = Number.parseInt(exitCodeValue, 10);
  if (!Number.isSafeInteger(exitCode) || exitCode < 1) throw new Error("exit code must be a positive integer");
  process.stderr.write(`${formatDevicectlFailure(exitCode, await readFile(outputFile, "utf8"))}\n`);
}
