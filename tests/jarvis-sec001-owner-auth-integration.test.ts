import assert from "node:assert/strict";
import test from "node:test";
import { POST as ownerLoginPost } from "../src/app/api/owner-login/route.ts";
import { OWNER_SESSION_COOKIE, verifyOwnerSessionToken } from "../src/app/owner-auth.ts";

const OWNER_SECRET_KEYS = ["JARVIS_OWNER_SECRET", "AI_COMPANY_OWNER_SECRET"] as const;

function snapshotOwnerEnv(): Record<string, string | undefined> {
  return Object.fromEntries(OWNER_SECRET_KEYS.map((key) => [key, process.env[key]]));
}

function restoreOwnerEnv(snapshot: Record<string, string | undefined>): void {
  for (const key of OWNER_SECRET_KEYS) {
    const value = snapshot[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function loginRequest(passcode: string): Request {
  const body = new FormData();
  body.set("passcode", passcode);
  body.set("next", "/jarvis");
  return new Request("https://jarvis.invalid/api/owner-login", {
    method: "POST",
    headers: { Accept: "application/json" },
    body,
  });
}

test("SEC-001 owner login fails closed when no owner secret is configured", async () => {
  const snapshot = snapshotOwnerEnv();
  try {
    delete process.env.JARVIS_OWNER_SECRET;
    delete process.env.AI_COMPANY_OWNER_SECRET;

    const response = await ownerLoginPost(loginRequest("anything"));
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("set-cookie"), null);
    assert.deepEqual(await response.json(), { ok: false });
  } finally {
    restoreOwnerEnv(snapshot);
  }
});

test("SEC-001 owner login rejects a wrong passcode without issuing a session", async () => {
  const snapshot = snapshotOwnerEnv();
  try {
    process.env.JARVIS_OWNER_SECRET = "sec001-owner-secret";
    delete process.env.AI_COMPANY_OWNER_SECRET;

    const response = await ownerLoginPost(loginRequest("wrong-secret"));
    assert.equal(response.status, 401);
    assert.equal(response.headers.get("set-cookie"), null);
    assert.deepEqual(await response.json(), { ok: false });
  } finally {
    restoreOwnerEnv(snapshot);
  }
});

test("SEC-001 successful owner login issues a bounded signed HttpOnly strict session", async () => {
  const snapshot = snapshotOwnerEnv();
  try {
    const secret = "sec001-owner-secret";
    process.env.JARVIS_OWNER_SECRET = secret;
    delete process.env.AI_COMPANY_OWNER_SECRET;

    const response = await ownerLoginPost(loginRequest(secret));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true });

    const setCookie = response.headers.get("set-cookie") ?? "";
    assert.match(setCookie, new RegExp(`^${OWNER_SESSION_COOKIE}=`));
    assert.match(setCookie, /HttpOnly/i);
    assert.match(setCookie, /SameSite=Strict/i);
    assert.match(setCookie, /Max-Age=43200/i);

    const cookiePair = setCookie.split(";", 1)[0] ?? "";
    const token = cookiePair.slice(cookiePair.indexOf("=") + 1);
    assert.equal(verifyOwnerSessionToken(secret, token), true);
    assert.equal(verifyOwnerSessionToken("different-owner-secret", token), false);
  } finally {
    restoreOwnerEnv(snapshot);
  }
});
