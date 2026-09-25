import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { URL } from "node:url";
import test from "node:test";

const google = readFileSync(new URL("../apps/ios-owner/Sources/GoogleOwnerEnrollment.swift", import.meta.url), "utf8");
const runtime = readFileSync(new URL("../apps/ios-owner/Sources/OwnerCredentialRuntime.swift", import.meta.url), "utf8");
const ui = readFileSync(new URL("../apps/ios-owner/Sources/JarvisIOSOwnerApp.swift", import.meta.url), "utf8");
const plist = readFileSync(new URL("../apps/ios-owner/Info.plist", import.meta.url), "utf8");

test("iPhone primary enrollment uses Google OAuth with state nonce PKCE and ephemeral browser", () => {
  assert.match(ui, /GoogleでOwner登録/);
  assert.match(google, /ASWebAuthenticationSession/);
  assert.match(google, /prefersEphemeralWebBrowserSession = true/);
  assert.match(google, /code_challenge_method/);
  assert.match(google, /S256/);
  assert.match(google, /state/);
  assert.match(google, /nonce/);
});

test("Google enrollment never persists OAuth tokens or requires Production Owner code", () => {
  assert.doesNotMatch(google, /refresh_token|UserDefaults.*token|Keychain.*token|JARVIS_OWNER_SECRET/);
  assert.match(runtime, /storeTrustedDevice/);
  assert.match(plist, /com\.haji84\.jarvis\.iosowner/);
});

test("manual code enrollment remains recovery-only", () => {
  assert.match(ui, /復旧用/);
  assert.match(ui, /GoogleでOwner登録/);
});

test("disabled Google enrollment shows a specific safe server-configuration error", () => {
  assert.match(google, /http\.statusCode == 503 && path == "\/api\/owner-login\/google\/begin"/);
  assert.match(google, /case \.serverNotConfigured: return "Google Owner登録はまだ有効ではありません（サーバー設定待ち）"/);
  assert.doesNotMatch(google, /String\(data: data|localizedDescription.*data/);
});
