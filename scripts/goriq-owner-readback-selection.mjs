// Validate optional workflow selectors before reading owner credentials.
// This is input validation only: no network, state access, or execution grant.
import { log } from "node:console";
import process from "node:process";
import { pathToFileURL } from "node:url";

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9:_.-]{5,159}$/;
function validIdentifier(value) {
  return typeof value === "string" && value.length >= 6 && value.length <= 160 &&
    value.trim() === value && !value.includes("..") && IDENTIFIER.test(value);
}

export function classifyReadbackSelection(goalId, jobId) {
  if (goalId === "" && jobId === "") return "CONNECTION_ONLY";
  return validIdentifier(goalId) && validIdentifier(jobId) ? "TARGETED_READBACK" : "INVALID";
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const selection = args.length === 2 ? classifyReadbackSelection(...args) : "INVALID";
  // Do not echo identifiers, arbitrary input, credentials, or environment values.
  log(`AI09_READBACK_SELECTION=${selection}`);
  if (selection === "INVALID") process.exitCode = 2;
}
