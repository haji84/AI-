import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { URL } from "node:url";
import {
  createOwnerSessionToken,
  OWNER_SESSION_MAX_AGE_SECONDS,
  verifyOwnerPasscode,
  verifyOwnerSessionToken,
} from "../src/app/owner-auth.ts";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("SEC-001 owner-login route stays bound to the fail-closed owner-auth primitives", () => {
  const route = read("src/app/api/owner-login/route.ts");

  assert.match(route, /const secret = jarvisOwnerSecret\(\);/);
  assert.match(route, /if \(!secret\)[\s\S]*status: 503/);
  assert.match(route, /if \(!verifyOwnerPasscode\(secret, passcode\)\)[\s\S]*status: 401/);
  assert.match(route, /response\.cookies\.set\(OWNER_SESSION_COOKIE, createOwnerSessionToken\(secret\)/);
  assert.match(route, /httpOnly: true/);
  assert.match(route, /secure: process\.env\.NODE_ENV === "production"/);
  assert.match(route, /sameSite: "strict"/);
  assert.match(route, /maxAge: OWNER_SESSION_MAX_AGE_SECONDS/);
});

test("SEC-001 owner-only broker guard fails closed and validates the signed owner cookie", () => {
  const broker = read("src/app/api/jarvis/broker.ts");

  assert.match(broker, /const ownerSecret = jarvisOwnerSecret\(\);/);
  assert.match(broker, /if \(!ownerSecret\) return false;/);
  assert.match(
    broker,
    /verifyOwnerSessionToken\(ownerSecret, cookieStore\.get\(OWNER_SESSION_COOKIE\)\?\.value\)/,
  );
});

test("SEC-001 authentication primitives reject a wrong passcode and wrong session secret", () => {
  const secret = "sec001-owner-secret";
  assert.equal(verifyOwnerPasscode(secret, secret), true);
  assert.equal(verifyOwnerPasscode(secret, "wrong-secret"), false);

  const token = createOwnerSessionToken(secret);
  assert.equal(verifyOwnerSessionToken(secret, token), true);
  assert.equal(verifyOwnerSessionToken("different-owner-secret", token), false);
  assert.equal(OWNER_SESSION_MAX_AGE_SECONDS, 60 * 60 * 12);
});
