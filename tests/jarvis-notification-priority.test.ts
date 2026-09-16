import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { deriveJarvisPriorityNotifications } from "../src/app/jarvis/notification-priority.ts";

const component = readFileSync(new URL("../src/app/jarvis/JarvisPriorityNotifications.tsx", import.meta.url), "utf8");
const shell = readFileSync(new URL("../src/app/jarvis/JarvisPrimaryShell.tsx", import.meta.url), "utf8");

test("Human Gate outranks failed, running and queued work", () => {
  const items = deriveJarvisPriorityNotifications({
    queued: 7,
    running: 3,
    completed: 20,
    failed: 2,
    needsHuman: 1,
  });
  assert.deepEqual(items.map((item) => item.id), ["human-gate", "failed", "running", "queued"]);
  assert.deepEqual(items.map((item) => item.priority), ["critical", "attention", "activity", "activity"]);
});

test("zero and malformed negative counts do not invent notifications", () => {
  assert.deepEqual(deriveJarvisPriorityNotifications({
    queued: 0,
    running: -2,
    completed: 4,
    failed: Number.NaN,
    needsHuman: 0,
  }), []);
});

test("priority surface is read-only and uses the protected state endpoint", () => {
  assert.match(component, /fetch\("\/api\/jarvis\/state", \{ cache: "no-store" \}\)/);
  assert.match(component, /response\.status === 401/);
  assert.match(component, /通知は状態表示だけ。ここからHuman Gate承認や端末操作は実行しない。/);
  assert.doesNotMatch(component, /method:\s*["']POST["']/);
  assert.doesNotMatch(component, /Notification\.requestPermission/);
  assert.doesNotMatch(component, /navigator\.permissions/);
});

test("primary shell mounts the priority surface outside the login route", () => {
  assert.match(shell, /if \(pathname\.startsWith\("\/jarvis\/login"\)\) return children;/);
  assert.match(shell, /<JarvisPriorityNotifications \/>/);
  assert.match(component, /aria-label="優先通知"/);
  assert.match(component, /aria-live="polite"/);
});
