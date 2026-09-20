import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";\nimport { URL } from "node:url";

test("trusted PIN client keeps the PIN local and retains passcode fallback", async () => {
  const client = await readFile(new URL("../src/app/jarvis/trusted-device-client.ts", import.meta.url), "utf8");
  const login = await readFile(new URL("../src/app/jarvis/OwnerLogin.tsx", import.meta.url), "utf8");
  assert.equal(client.includes("PBKDF2_ITERATIONS = 600_000"), true);
  assert.equal(client.includes("AES-GCM"), true);
  assert.equal(client.includes("ECDSA"), true);
  assert.equal(client.includes('body: JSON.stringify({ pin'), false);
  assert.equal(login.includes("PINでログイン"), true);
  assert.equal(login.includes("本番ログインコード"), true);
});

test("trusted login challenge is HttpOnly and consumed", async () => {
  const challenge = await readFile(new URL("../src/app/api/owner-login/trusted/challenge/route.ts", import.meta.url), "utf8");
  const verify = await readFile(new URL("../src/app/api/owner-login/trusted/verify/route.ts", import.meta.url), "utf8");
  assert.equal(challenge.includes("httpOnly: true"), true);
  assert.equal(challenge.includes('sameSite: "strict"'), true);
  assert.equal(verify.includes("cookieStore.delete(TRUSTED_DEVICE_CHALLENGE_COOKIE)"), true);
  assert.equal(verify.includes("verifyTrustedDeviceProof"), true);
});
