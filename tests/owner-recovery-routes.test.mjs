import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { URL } from "node:url";

function source(path) {
  try { return readFileSync(new URL(path, import.meta.url), "utf8"); }
  catch (error) { if (error.code === "ENOENT") return ""; throw error; }
}

const issue = source("../src/app/api/owner-login/trusted/recovery/issue/route.ts");
const redeem = source("../src/app/api/owner-login/trusted/recovery/redeem/route.ts");
const cancel = source("../src/app/api/owner-login/trusted/recovery/cancel/route.ts");
const handlers = source("../src/app/owner-recovery-http.ts");
const ordinaryLogin = source("../src/app/api/owner-login/route.ts");
const workerEnrollment = source("../src/app/api/jarvis/enroll/route.ts") + source("../scripts/jarvis-broker.ts");

test("public recovery routes are disabled by default, bounded, POST-only, and non-cacheable", () => {
  for (const route of [issue, redeem, cancel]) {
    assert.match(route, /export async function POST/);
    assert.match(route, /GORIQ_OWNER_RECOVERY_ENROLLMENT_ENABLED === "1"/);
  }
  assert.match(handlers, /"Cache-Control": "no-store"/);
  assert.match(handlers, /"Referrer-Policy": "no-referrer"/);
  assert.match(handlers, /4_096|4096/);
  assert.match(handlers, /JSON\.parse/);
});

test("issue and cancel require a fresh device-bound cookie and bind its device id", () => {
  for (const route of [issue, cancel]) {
    assert.match(route, /OWNER_SESSION_COOKIE/);
    assert.match(route, /verifyFreshTrustedOwnerSessionAccess/);
  }
  assert.match(handlers, /issuerDeviceId/);
  assert.match(handlers, /401/);
});

test("redeem is sessionless, uses only a HMACed platform source bucket, and never creates a login cookie", () => {
  assert.match(redeem, /x-vercel-forwarded-for/);
  assert.match(handlers, /ownerRecoverySourceBucket/);
  assert.match(handlers, /redeemOwnerRecoveryEnrollment/);
  assert.doesNotMatch(redeem, /OWNER_SESSION_COOKIE|cookies\(\)|response\.cookies\.set|console\./);
  assert.doesNotMatch(redeem, /URLSearchParams|searchParams/);
});

test("generic Japanese failures do not expose which recovery predicate failed", () => {
  assert.match(handlers, /復旧コードを発行できません/);
  assert.match(handlers, /復旧コードを取り消せません/);
  assert.match(handlers, /復旧コードで端末を登録できません/);
  assert.doesNotMatch(issue + redeem + cancel + handlers, /error\.message|String\(error\)|console\./);
});

test("redeem distinguishes retryable Broker outage from a generic rejected code without exposing detail", () => {
  assert.match(handlers, /OwnerRecoveryBrokerError/);
  assert.match(handlers, /error\.status !== 409 \? 503 : 403/);
  assert.doesNotMatch(handlers, /error\.message|String\(error\)/);
});

test("recovery codes are absent from ordinary Owner login and Worker enrollment authority", () => {
  assert.doesNotMatch(ordinaryLogin, /owner-recovery|recovery\/redeem|OR-/);
  assert.doesNotMatch(workerEnrollment, /owner-login\/trusted\/recovery|recoveryCode/);
});
