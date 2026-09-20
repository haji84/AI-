import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { URL } from "node:url";
import {
  createOwnerSessionToken,
  OWNER_SESSION_FUTURE_TOLERANCE_SECONDS,
  OWNER_SESSION_MAX_AGE_SECONDS,
  verifyOwnerSessionToken,
} from "../src/app/owner-auth.ts";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const secret = "sec002-owner-secret";
const issuedAtSeconds = 2_000_000_000;

test("SEC-002 owner sessions stay unique and bounded by expiry and clock tolerance", () => {
  const first = createOwnerSessionToken(secret, { issuedAtSeconds });
  const second = createOwnerSessionToken(secret, { issuedAtSeconds });

  assert.notEqual(first, second);
  assert.equal(
    verifyOwnerSessionToken(secret, first, { nowSeconds: issuedAtSeconds + OWNER_SESSION_MAX_AGE_SECONDS }),
    true,
  );
  assert.equal(
    verifyOwnerSessionToken(secret, first, { nowSeconds: issuedAtSeconds + OWNER_SESSION_MAX_AGE_SECONDS + 1 }),
    false,
  );

  const toleratedFuture = createOwnerSessionToken(secret, {
    issuedAtSeconds: issuedAtSeconds + OWNER_SESSION_FUTURE_TOLERANCE_SECONDS,
    nonce: "C".repeat(24),
  });
  const staleFuture = createOwnerSessionToken(secret, {
    issuedAtSeconds: issuedAtSeconds + OWNER_SESSION_FUTURE_TOLERANCE_SECONDS + 1,
    nonce: "D".repeat(24),
  });
  assert.equal(verifyOwnerSessionToken(secret, toleratedFuture, { nowSeconds: issuedAtSeconds }), true);
  assert.equal(verifyOwnerSessionToken(secret, staleFuture, { nowSeconds: issuedAtSeconds }), false);
  assert.equal(verifyOwnerSessionToken("different-owner-secret", first, { nowSeconds: issuedAtSeconds }), false);
});

test("SEC-002 login creates a strict bounded session cookie", () => {
  const route = read("src/app/api/owner-login/route.ts");

  assert.match(route, /response\.cookies\.set\(OWNER_SESSION_COOKIE, createOwnerSessionToken\(secret\)/);
  assert.match(route, /httpOnly: true/);
  assert.match(route, /secure: process\.env\.NODE_ENV === "production"/);
  assert.match(route, /sameSite: "strict"/);
  assert.match(route, /path: "\/"/);
  assert.match(route, /maxAge: OWNER_SESSION_MAX_AGE_SECONDS/);
  assert.match(route, /"Cache-Control": "no-store"/);
});

test("SEC-002 logout clears only the owner session cookie with strict attributes", () => {
  const route = read("src/app/api/owner-logout/route.ts");

  assert.match(route, /response\.cookies\.set\(OWNER_SESSION_COOKIE, "",/);
  assert.match(route, /httpOnly: true/);
  assert.match(route, /secure: process\.env\.NODE_ENV === "production"/);
  assert.match(route, /sameSite: "strict"/);
  assert.match(route, /path: "\/"/);
  assert.match(route, /maxAge: 0/);
  assert.match(route, /"Cache-Control": "no-store"/);
  assert.match(route, /Location: "\/jarvis\/login"/);
  assert.doesNotMatch(route, /JARVIS_OWNER_SECRET|AI_COMPANY_OWNER_SECRET|JARVIS_OWNER_TOKEN/);
});

test("SEC-002 broker session gate remains fail-closed", () => {
  const broker = read("src/app/api/jarvis/broker.ts");

  assert.match(broker, /const ownerSecret = jarvisOwnerSecret\(\);/);
  assert.match(broker, /if \(!ownerSecret\) return false;/);
  assert.match(
    broker,
    /verifyOwnerSessionToken\(ownerSecret, cookieStore\.get\(OWNER_SESSION_COOKIE\)\?\.value\)/,
  );
});
