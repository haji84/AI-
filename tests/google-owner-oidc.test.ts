import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import test from "node:test";
import { pkceChallenge, verifyGoogleIdToken } from "../src/app/google-owner-oidc.ts";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = publicKey.export({ format: "jwk" });
Object.assign(jwk, { kid: "fixture", alg: "RS256", use: "sig" });
const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
function token(claims: Record<string, unknown>, kid = "fixture") {
  const header = encode({ alg: "RS256", typ: "JWT", kid });
  const payload = encode(claims);
  const body = `${header}.${payload}`;
  return `${body}.${sign("RSA-SHA256", Buffer.from(body), privateKey).toString("base64url")}`;
}
const now = 2_000_000_000;
const base = { iss: "https://accounts.google.com", aud: "client-id", sub: "google-sub", email: "owner@example.com", email_verified: true, iat: now - 10, exp: now + 300, nonce: "nonce-1" };

test("validates Google ID token signature issuer audience expiry and nonce", async () => {
  const claims = await verifyGoogleIdToken(token(base), { clientId: "client-id", nonce: "nonce-1", nowSeconds: now, fetchJwks: async () => ({ keys: [jwk] }) });
  assert.equal(claims.sub, "google-sub");
});

for (const [name, patch] of [["issuer", { iss: "https://evil.example" }], ["audience", { aud: "other" }], ["expiry", { exp: now - 1 }], ["nonce", { nonce: "wrong" }]] as const) {
  test(`rejects invalid ${name}`, async () => assert.rejects(() => verifyGoogleIdToken(token({ ...base, ...patch }), { clientId: "client-id", nonce: "nonce-1", nowSeconds: now, fetchJwks: async () => ({ keys: [jwk] }) })));
}

test("rejects unknown kid and bad signature", async () => {
  await assert.rejects(() => verifyGoogleIdToken(token(base, "unknown"), { clientId: "client-id", nonce: "nonce-1", nowSeconds: now, fetchJwks: async () => ({ keys: [jwk] }) }));
  const bad = token(base).replace(/.$/, "x");
  await assert.rejects(() => verifyGoogleIdToken(bad, { clientId: "client-id", nonce: "nonce-1", nowSeconds: now, fetchJwks: async () => ({ keys: [jwk] }) }));
});

test("computes RFC7636 S256 challenge", () => {
  assert.equal(pkceChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"), "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
});
