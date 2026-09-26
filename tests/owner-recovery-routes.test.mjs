import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path) {
  try { return readFileSync(new URL(path, import.meta.url), "utf8"); }
  catch (error) { if (error.code === "ENOENT") return ""; throw error; }
}

const issue = source("../src/app/api/owner-login/trusted/recovery/issue/route.ts");
const redeem = source("../src/app/api/owner-login/trusted/recovery/redeem/route.ts");
const cancel = source("../src/app/api/owner-login/trusted/recovery/cancel/route.ts");
const ordinaryLogin = source("../src/app/api/owner-login/route.ts");
const workerEnrollment = source("../src/app/api/jarvis/enroll/route.ts") + source("../scripts/jarvis-broker.ts");

test("public recovery routes are disabled by default, bounded, POST-only, and non-cacheable", () => {
  for (const route of [issue, redeem, cancel]) {
    assert.match(route, /export async function POST/);
    assert.match(route, /GORIQ_OWNER_RECOVERY_ENROLLMENT_ENABLED === "1"/);
    assert.match(route, /Cache-Control["']?:?\s*["']no-store|"Cache-Control": "no-store"/);
    assert.match(route, /Referrer-Policy["']?:?\s*["']no-referrer|"Referrer-Policy": "no-referrer"/);
    assert.match(route, /4_096|4096/);
    assert.match(route, /JSON\.parse/);
  }
});

test("issue and cancel require a fresh device-bound cookie and bind its device id", () => {
  for (const route of [issue, cancel]) {
    assert.match(route, /OWNER_SESSION_COOKIE/);
    assert.match(route, /verifyFreshTrustedOwnerSessionAccess/);
    assert.match(route, /issuerDeviceId/);
    assert.match(route, /status: 401/);
  }
});

test("redeem is sessionless, uses only a HMACed platform source bucket, and never creates a login cookie", () => {
  assert.match(redeem, /x-vercel-forwarded-for/);
  assert.match(redeem, /ownerRecoverySourceBucket/);
  assert.match(redeem, /redeemOwnerRecoveryEnrollment/);
  assert.doesNotMatch(redeem, /OWNER_SESSION_COOKIE|cookies\(\)|response\.cookies\.set|console\./);
  assert.doesNotMatch(redeem, /URLSearchParams|searchParams/);
});

test("generic Japanese failures do not expose which recovery predicate failed", () => {
  assert.match(issue, /復旧コードを発行できません/);
  assert.match(cancel, /復旧コードを取り消せません/);
  assert.match(redeem, /復旧コードで端末を登録できません/);
  assert.doesNotMatch(issue + redeem + cancel, /error\.message|String\(error\)|console\./);
});

test("redeem distinguishes retryable Broker outage from a generic rejected code without exposing detail", () => {
  assert.match(redeem, /OwnerRecoveryBrokerError/);
  assert.match(redeem, /error\.status !== 409 \? 503 : 403/);
  assert.doesNotMatch(redeem, /error\.message|String\(error\)/);
});

test("recovery codes are absent from ordinary Owner login and Worker enrollment authority", () => {
  assert.doesNotMatch(ordinaryLogin, /owner-recovery|recovery\/redeem|OR-/);
  assert.doesNotMatch(workerEnrollment, /owner-login\/trusted\/recovery|recoveryCode/);
});
