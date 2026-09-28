#!/usr/bin/env node
import { readFileSync } from "node:fs";

const [healthPath, minimumUpdatedAtRaw] = process.argv.slice(2);
if (!healthPath || !minimumUpdatedAtRaw) process.exit(2);

let health;
try {
  health = JSON.parse(readFileSync(healthPath, "utf8"));
} catch {
  process.exit(3);
}

const minimumUpdatedAt = Number(minimumUpdatedAtRaw);
const updatedAt = Date.parse(String(health.updatedAt ?? ""));
const acceptable = new Set(["idle", "processing", "synced", "reconciling"]);
const pid = Number(health.pid);

const ok = Number.isFinite(minimumUpdatedAt)
  && Number.isFinite(updatedAt)
  && updatedAt >= minimumUpdatedAt
  && acceptable.has(String(health.status ?? ""))
  && Number.isInteger(pid)
  && pid > 0;

if (!ok) process.exit(1);
process.stdout.write(JSON.stringify(health, null, 2) + "\n");
