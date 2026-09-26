import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { URL } from "node:url";
import test from "node:test";

const begin = readFileSync(new URL("../src/app/api/owner-login/google/begin/route.ts", import.meta.url), "utf8");
const complete = readFileSync(new URL("../src/app/api/owner-login/google/complete/route.ts", import.meta.url), "utf8");

test("Google Owner endpoints are disabled by default and no-store", () => {
  assert.match(begin, /GORIQ_GOOGLE_OWNER_ENROLLMENT_ENABLED/);
  assert.match(complete, /GORIQ_GOOGLE_OWNER_ENROLLMENT_ENABLED/);
  assert.match(begin, /Cache-Control.*no-store/s);
  assert.match(complete, /Cache-Control.*no-store/s);
});

test("Google completion never returns the long-lived Owner secret", () => {
  assert.match(complete, /createTrustedDeviceCredential/);
  assert.doesNotMatch(complete, /NextResponse\.json\(\{[^}]*\bsecret\b/s);
  assert.match(complete, /OWNER_REDIRECT_URI/);
  assert.match(complete, /verifyGoogleIdToken/);
});
