import assert from "node:assert/strict";
import test from "node:test";
import { beginGoogleOwnerEnrollment, completeGoogleOwnerEnrollment } from "../src/app/google-owner-service.ts";

const jwk = { kty: "EC", crv: "P-256", x: "abc", y: "def" } as JsonWebKey;

test("begin is disabled by default and returns only public OAuth context when enabled", async () => {
  await assert.rejects(() => beginGoogleOwnerEnrollment({ deviceId: "device_1234567890abcdef", publicKeyJwk: jwk, state: "s", nonce: "n", pkceChallenge: "p" }, { enabled: false, clientId: "c", issueContext: async () => ({ contextId: "x", expiresAt: 1 }) }));
  const result = await beginGoogleOwnerEnrollment({ deviceId: "device_1234567890abcdef", publicKeyJwk: jwk, state: "s", nonce: "n", pkceChallenge: "p" }, { enabled: true, clientId: "c", issueContext: async () => ({ contextId: "ctx", expiresAt: 1300 }) });
  assert.equal(result.clientId, "c");
  assert.equal(result.contextId, "ctx");
  assert.ok(!("secret" in result));
});

test("complete consumes context verifies PKCE identity registers device and returns td credential only", async () => {
  let registered = false; let bound = false;
  const result = await completeGoogleOwnerEnrollment({ contextId: "ctx", deviceId: "device_1234567890abcdef", publicKeyJwk: jwk, state: "s", nonce: "n", code: "auth-code", codeVerifier: "verifier", redirectUri: "com.example:/oauth2redirect" }, {
    clientId: "c", bootstrapEmail: "owner@example.com", redirectUri: "com.example:/oauth2redirect",
    consumeContext: async () => ({ pkceChallenge: "iMnq5o6zALKXGivsnlom_0F5_WYda32GHkxlV7mq7hQ" }),
    exchangeCode: async () => ({ id_token: "id-token" }),
    verifyIdToken: async () => ({ iss: "https://accounts.google.com", aud: "c", sub: "sub", email: "owner@example.com", email_verified: true, iat: 1, exp: 2, nonce: "n" }),
    lookupIdentity: async () => ({ bound: false }),
    bindIdentity: async () => { bound = true; },
    registerDevice: async () => { registered = true; },
    createCredential: () => "td1.fixture.signature",
  });
  assert.equal(result.credential, "td1.fixture.signature");
  assert.equal(registered, true); assert.equal(bound, true);
  assert.deepEqual(Object.keys(result).sort(), ["credential", "ok"]);
});

test("device registration failure leaves first Google identity unbound", async () => {
  let bound = false;
  await assert.rejects(() => completeGoogleOwnerEnrollment({ contextId: "ctx", deviceId: "device_1234567890abcdef", publicKeyJwk: jwk, state: "s", nonce: "n", code: "auth-code", codeVerifier: "verifier", redirectUri: "com.example:/oauth2redirect" }, {
    clientId: "c", bootstrapEmail: "owner@example.com", redirectUri: "com.example:/oauth2redirect",
    consumeContext: async () => ({ pkceChallenge: "iMnq5o6zALKXGivsnlom_0F5_WYda32GHkxlV7mq7hQ" }),
    exchangeCode: async () => ({ id_token: "id-token" }),
    verifyIdToken: async () => ({ iss: "https://accounts.google.com", aud: "c", sub: "sub", email: "owner@example.com", email_verified: true, iat: 1, exp: 2, nonce: "n" }),
    lookupIdentity: async () => ({ bound: false }),
    bindIdentity: async () => { bound = true; },
    registerDevice: async () => { throw new Error("registry unavailable"); },
    createCredential: () => "td1.fixture.signature",
  }));
  assert.equal(bound, false);
});

test("wrong Google bootstrap identity never registers a trusted device", async () => {
  let registered = false;
  await assert.rejects(() => completeGoogleOwnerEnrollment({ contextId: "ctx", deviceId: "device_1234567890abcdef", publicKeyJwk: jwk, state: "s", nonce: "n", code: "auth-code", codeVerifier: "verifier", redirectUri: "com.example:/oauth2redirect" }, {
    clientId: "c", bootstrapEmail: "owner@example.com", redirectUri: "com.example:/oauth2redirect",
    consumeContext: async () => ({ pkceChallenge: "iMnq5o6zALKXGivsnlom_0F5_WYda32GHkxlV7mq7hQ" }),
    exchangeCode: async () => ({ id_token: "id-token" }),
    verifyIdToken: async () => ({ iss: "https://accounts.google.com", aud: "c", sub: "wrong", email: "other@example.com", email_verified: true, iat: 1, exp: 2, nonce: "n" }),
    lookupIdentity: async () => ({ bound: false }),
    bindIdentity: async () => { throw new Error("should not bind"); },
    registerDevice: async () => { registered = true; },
    createCredential: () => "td1.fixture.signature",
  }));
  assert.equal(registered, false);
});
