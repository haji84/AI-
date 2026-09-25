import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { URL } from "node:url";
import test from "node:test";

const files = [
  "../src/app/google-owner-oidc.ts",
  "../src/app/google-owner-service.ts",
  "../src/app/api/owner-login/google/begin/route.ts",
  "../src/app/api/owner-login/google/complete/route.ts",
  "../apps/ios-owner/Sources/GoogleOwnerEnrollment.swift",
].map(path => readFileSync(new URL(path, import.meta.url), "utf8")).join("\n");

test("Google Owner flow does not write authentication material to diagnostics", () => {
  assert.doesNotMatch(files, /console\.log|print\(|NSLog|Logger\./);
  assert.doesNotMatch(files, /refresh_token/);
});

test("Google Owner flow uses identity-only scopes and PKCE", () => {
  assert.match(files, /openid email profile/);
  assert.match(files, /code_challenge_method/);
  assert.match(files, /S256/);
  assert.doesNotMatch(files, /drive|gmail|youtube/i);
});
