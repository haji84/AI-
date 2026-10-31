#!/usr/bin/env node
import process from "node:process";
import { Buffer } from "node:buffer";
import { attestLocalCandidate } from "./jarvis-independent-artifact-attestation.mjs";

try {
  const chunks = []; let length = 0;
  for await (const chunk of process.stdin) {
    length += chunk.length;
    if (length > 32768) throw Error("ARTIFACT_READBACK_REQUEST_TOO_LARGE");
    chunks.push(chunk);
  }
  const request = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  const attestation = attestLocalCandidate(request);
  process.stdout.write(JSON.stringify({ ok: true, attestation }));
} catch (error) {
  process.stdout.write(JSON.stringify({ ok: false, blocker: error instanceof Error ? error.message : "ARTIFACT_READBACK_FAILED" }));
  process.exitCode = 1;
}
