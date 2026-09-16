import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  createOwnerSessionToken,
  OWNER_SESSION_MAX_AGE_SECONDS,
  verifyOwnerPasscode,
  verifyOwnerSessionToken,
} from "../src/app/owner-auth.ts";

const NOW = new Date("2026-09-17T00:00:00.000Z");
const NONCE_A = "abcdefghijklmnopqrstuvwx";
const NONCE_B = "zyxwvutsrqponmlkjihgfedc";

const loginRoute = readFileSync(new URL("../src/app/api/owner-login/route.ts", import.meta.url), "utf8");

test("owner session token validates only with the configured secret inside its bounded lifetime", () => {
  const token = createOwnerSessionToken("secret-a", { now: NOW, nonce: NONCE_A });
  assert.equal(verifyOwnerSessionToken("secret-a", token, { now: NOW }), true);
  assert.equal(verifyOwnerSessionToken("secret-b", token, { now: NOW }), false);

  const insideLifetime = new Date(NOW.getTime() + OWNER_SESSION_MAX_AGE_SECONDS * 1000);
  const expired = new Date(insideLifetime.getTime() + 1);
  assert.equal(verifyOwnerSessionToken("secret-a", token, { now: insideLifetime }), true);
  assert.equal(verifyOwnerSessionToken("secret-a", token, { now: expired }), false);
});

test("owner session rejects future-issued, tampered, malformed, and legacy deterministic tokens", () => {
  const future = createOwnerSessionToken("secret-a", {
    now: new Date(NOW.getTime() + 61_000),
    nonce: NONCE_A,
  });
  assert.equal(verifyOwnerSessionToken("secret-a", future, { now: NOW }), false);

  const token = createOwnerSessionToken("secret-a", { now: NOW, nonce: NONCE_A });
  const replacement = token.endsWith("0") ? "1" : "0";
  const tampered = `${token.slice(0, -1)}${replacement}`;
  assert.equal(verifyOwnerSessionToken("secret-a", tampered, { now: NOW }), false);
  assert.equal(verifyOwnerSessionToken("secret-a", "not-a-session-token", { now: NOW }), false);
  assert.equal(verifyOwnerSessionToken("secret-a", "9c9a76b6a3d11223344556677889900a", { now: NOW }), false);
});

test("owner sessions rotate per login nonce instead of producing a deterministic bearer token", () => {
  const tokenA = createOwnerSessionToken("secret-a", { now: NOW, nonce: NONCE_A });
  const tokenB = createOwnerSessionToken("secret-a", { now: NOW, nonce: NONCE_B });
  assert.notEqual(tokenA, tokenB);
  assert.equal(verifyOwnerSessionToken("secret-a", tokenA, { now: NOW }), true);
  assert.equal(verifyOwnerSessionToken("secret-a", tokenB, { now: NOW }), true);
});

test("owner login cookie uses the same bounded lifetime as the signed session token", () => {
  assert.equal(OWNER_SESSION_MAX_AGE_SECONDS, 60 * 60 * 24);
  assert.match(loginRoute, /maxAge: OWNER_SESSION_MAX_AGE_SECONDS/);
  assert.match(loginRoute, /httpOnly: true/);
  assert.match(loginRoute, /sameSite: "strict"/);
});

test("owner passcode comparison rejects mismatches", () => {
  assert.equal(verifyOwnerPasscode("secret-a", "secret-a"), true);
  assert.equal(verifyOwnerPasscode("secret-a", "secret-b"), false);
  assert.equal(verifyOwnerPasscode("", ""), false);
});
