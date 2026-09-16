import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import {
  FIXED_ENROLLMENT_PORTAL_DEFAULT_PORT,
  FIXED_ENROLLMENT_TTL_MS,
  FixedEnrollmentRateLimiter,
  fixedEnrollmentRequest,
  normalizeFixedEnrollmentBindHost,
  normalizeFixedEnrollmentBrokerUrl,
  normalizeFixedEnrollmentGroup,
  safeEqualEnrollmentKey,
  validateFixedEnrollmentRedirect,
} from "../src/jarvis/fixed-enrollment.ts";
import {
  JARVIS_PAIRING_GRANT_MAX_TTL_MS,
  JARVIS_PAIRING_WINDOW_MAX_ISSUES,
  JARVIS_PAIRING_WINDOW_MAX_TTL_MS,
  JarvisEnrollmentPairingWindow,
} from "../src/jarvis/enrollment-pairing-window.ts";

test("fixed enrollment request is always fresh, single-device and 10 minutes", () => {
  assert.equal(FIXED_ENROLLMENT_TTL_MS, 600_000);
  assert.deepEqual(fixedEnrollmentRequest("default"), {
    mode: "quick",
    maxDevices: 1,
    ttlMs: 600_000,
    group: "default",
  });
  assert.deepEqual(fixedEnrollmentRequest("  "), {
    mode: "quick",
    maxDevices: 1,
    ttlMs: 600_000,
  });
});

test("fixed enrollment portal default port does not collide with Remote Gateway", () => {
  assert.equal(FIXED_ENROLLMENT_PORTAL_DEFAULT_PORT, 8791);
  assert.notEqual(FIXED_ENROLLMENT_PORTAL_DEFAULT_PORT, 8790);
});

test("portal key comparison is exact", () => {
  const key = "12345678901234567890123456789012";
  assert.equal(safeEqualEnrollmentKey(key, key), true);
  assert.equal(safeEqualEnrollmentKey(`${key}x`, key), false);
  assert.equal(safeEqualEnrollmentKey(key.replace("1", "2"), key), false);
});

test("portal bind stays loopback unless LAN is explicitly allowed", () => {
  assert.equal(normalizeFixedEnrollmentBindHost(undefined, false), "127.0.0.1");
  assert.equal(normalizeFixedEnrollmentBindHost("::1", false), "::1");
  assert.throws(
    () => normalizeFixedEnrollmentBindHost("0.0.0.0", false),
    /JARVIS_ENROLLMENT_PORTAL_ALLOW_LAN=1/,
  );
  assert.equal(normalizeFixedEnrollmentBindHost("0.0.0.0", true), "0.0.0.0");
});

test("portal may only call a loopback Broker without URL credentials", () => {
  assert.equal(normalizeFixedEnrollmentBrokerUrl(undefined), "http://127.0.0.1:8787");
  assert.equal(normalizeFixedEnrollmentBrokerUrl("http://localhost:8787/"), "http://localhost:8787");
  assert.throws(() => normalizeFixedEnrollmentBrokerUrl("https://10.0.0.5:8787"), /loopback-only/);
  assert.throws(() => normalizeFixedEnrollmentBrokerUrl("http://user:pass@127.0.0.1:8787"), /credentials/);
});

test("one-tap redirect must be HTTPS and cannot contain URL credentials", () => {
  assert.equal(
    validateFixedEnrollmentRedirect("https://jarvis.example.test/enroll/abc"),
    "https://jarvis.example.test/enroll/abc",
  );
  assert.throws(() => validateFixedEnrollmentRedirect("http://jarvis.example.test/enroll/abc"), /HTTPS/);
  assert.throws(() => validateFixedEnrollmentRedirect("https://user:pass@jarvis.example.test/enroll/abc"), /credentials/);
  assert.throws(() => validateFixedEnrollmentRedirect(undefined), /one-tap/);
});

test("enrollment group is bounded and safe", () => {
  assert.equal(normalizeFixedEnrollmentGroup("fleet-01"), "fleet-01");
  assert.equal(normalizeFixedEnrollmentGroup(undefined), undefined);
  assert.throws(() => normalizeFixedEnrollmentGroup("not allowed"), /unsupported characters/);
  assert.throws(() => normalizeFixedEnrollmentGroup("a".repeat(65)), /64 characters/);
});

test("rate limiter bounds client and global minting and resets after its window", () => {
  const limiter = new FixedEnrollmentRateLimiter(1_000, 2, 3, 4);
  assert.deepEqual(limiter.consume("a", 10_000), { allowed: true, retryAfterMs: 0 });
  assert.deepEqual(limiter.consume("a", 10_100), { allowed: true, retryAfterMs: 0 });
  assert.equal(limiter.consume("a", 10_200).allowed, false);
  assert.deepEqual(limiter.consume("b", 10_300), { allowed: true, retryAfterMs: 0 });
  assert.equal(limiter.consume("c", 10_400).allowed, false);
  assert.deepEqual(limiter.consume("a", 11_001), { allowed: true, retryAfterMs: 0 });
});

test("rate limiter refuses unbounded new client tracking", () => {
  const limiter = new FixedEnrollmentRateLimiter(10_000, 10, 100, 2);
  assert.equal(limiter.consume("a", 1_000).allowed, true);
  assert.equal(limiter.consume("b", 1_000).allowed, true);
  assert.equal(limiter.consume("c", 1_000).allowed, false);
  assert.equal(limiter.consume("c", 11_001).allowed, true);
});

test("pairing window starts closed, expires, exhausts and a fresh instance is closed after restart", () => {
  const window = new JarvisEnrollmentPairingWindow();
  assert.deepEqual(window.status(1_000), { open: false, reason: "closed", maxIssues: 0, issued: 0, remaining: 0 });

  const opened = window.open({ ttlMs: 120_000, maxIssues: 2, group: "batch-1" }, 10_000);
  assert.equal(opened.open, true);
  assert.equal(opened.remaining, 2);
  const first = window.reserveIssue(10_100);
  const second = window.reserveIssue(10_200);
  assert(first);
  assert(second);
  assert.equal(first.group, "batch-1");
  assert.equal(first.grantTtlMs <= JARVIS_PAIRING_GRANT_MAX_TTL_MS, true);
  assert.equal(first.status.remaining, 1);
  assert.equal(second.status.open, false);
  assert.equal(second.status.reason, "exhausted");
  assert.equal(window.reserveIssue(10_300), undefined);

  const expiring = new JarvisEnrollmentPairingWindow();
  expiring.open({ ttlMs: 60_000, maxIssues: 10 }, 20_000);
  assert.equal(expiring.status(80_000).reason, "expired");

  const restarted = new JarvisEnrollmentPairingWindow();
  assert.equal(restarted.status(20_001).open, false);
  assert.equal(restarted.status(20_001).reason, "closed");
});

test("pairing window clamps owner input to one hour and 100 issues", () => {
  const window = new JarvisEnrollmentPairingWindow();
  const opened = window.open({ ttlMs: 24 * 60 * 60_000, maxIssues: 999 }, 100_000);
  assert.equal(opened.maxIssues, JARVIS_PAIRING_WINDOW_MAX_ISSUES);
  assert.equal(Date.parse(opened.expiresAt!) - 100_000, JARVIS_PAIRING_WINDOW_MAX_TTL_MS);
});

test("fixed broker route is token-free and pairing-window gated", () => {
  const broker = readFileSync(resolve(process.cwd(), "scripts/jarvis-broker.ts"), "utf8");
  assert.match(broker, /path === "\/enroll"/);
  assert.match(broker, /pairingWindow\.reserveIssue/);
  assert.match(broker, /\/api\/jarvis\/admin\/enrollment-window/);
  assert.match(broker, /maxDevices: 1/);
  assert.doesNotMatch(broker, /`\$\{publicBrokerUrl\}\/enroll\/\$\{.*ownerToken/);
});

test("fixed portal no longer carries a permanent enrollment bearer in its URL", () => {
  const portal = readFileSync(resolve(process.cwd(), "scripts/jarvis-fixed-enrollment-portal.ts"), "utf8");
  assert.match(portal, /url\.pathname !== "\/enroll"/);
  assert.match(portal, /`\$\{brokerUrl\}\/enroll`/);
  assert.doesNotMatch(portal, /JARVIS_ENROLLMENT_PORTAL_KEY/);
  assert.doesNotMatch(portal, /Authorization:/);
  assert.doesNotMatch(portal, /\/enroll\/<opaque-key>/);
});
