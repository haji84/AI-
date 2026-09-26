import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { URL } from "node:url";

function source(path) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

const routePaths = [
  "../src/app/api/owner-login/trusted/recovery/issue/route.ts",
  "../src/app/api/owner-login/trusted/recovery/redeem/route.ts",
  "../src/app/api/owner-login/trusted/recovery/cancel/route.ts",
];
const routes = routePaths.map(source);
const routeHandlers = source("../src/app/owner-recovery-http.ts");
const registry = source("../src/jarvis/trusted-device-registry.ts");
const broker = source("../scripts/jarvis-broker.ts");
const service = source("../src/app/owner-recovery-service.ts");
const client = source("../src/app/owner-recovery-registry-client.ts");
const runtime = source("../apps/ios-owner/Sources/OwnerCredentialRuntime.swift");
const view = source("../apps/ios-owner/Sources/JarvisIOSOwnerApp.swift");

test("recovery transport never places the code in URLs, cookies, browser storage, logs, or pasteboard", () => {
  for (const route of [...routes, routeHandlers]) {
    assert.doesNotMatch(route, /URLSearchParams|searchParams|response\.cookies\.set|Set-Cookie|localStorage|sessionStorage|console\.|logger\./);
  }
  const recoveryBrokerBlock = broker.slice(
    broker.indexOf('if (path === "/api/jarvis/admin/owner-recovery")'),
    broker.indexOf('if (path === "/api/jarvis/admin/trusted-devices")'),
  );
  assert.doesNotMatch(recoveryBrokerBlock, /console\.|logger\.|url\.searchParams/);
  assert.doesNotMatch(service + client, /console\.|logger\.|localStorage|sessionStorage|document\.cookie/);
  assert.doesNotMatch(runtime + view, /UIPasteboard|UniformTypeIdentifiers|UserDefaults[^\n]*(?:recovery|code)|Keychain\.save[^\n]*(?:recovery|code)/i);
});

test("durable recovery state stores a keyed digest and never a raw code field", () => {
  const record = registry.slice(registry.indexOf("type RecoveryRecord"), registry.indexOf("type IssueEvent"));
  assert.match(record, /codeDigest: string/);
  assert.doesNotMatch(record, /\bcode\s*:/);
  assert.match(registry, /createHmac\("sha256", this\.recoverySecret\)/);
  assert.doesNotMatch(registry, /state\.active\s*=\s*\{[^}]*\bcode\s*:/s);
});

test("all public routes require an explicit disabled-by-default feature gate", () => {
  for (const route of routes) {
    assert.match(route, /process\.env\.GORIQ_OWNER_RECOVERY_ENROLLMENT_ENABLED === "1"/);
  }
  assert.match(routeHandlers, /if \(!dependencies\.enabled\).*503/);
  for (const path of ["../next.config.ts", "../scripts/jarvis-production-config.mjs", "../vercel.json", "../.env", "../.env.local"]) {
    const url = new URL(path, import.meta.url);
    if (!existsSync(url)) continue;
    assert.doesNotMatch(readFileSync(url, "utf8"), /GORIQ_OWNER_RECOVERY_ENROLLMENT_ENABLED\s*(?:=|:)\s*["']?1\b/);
  }
});

test("operator documentation records the security and rollback contract without physical acceptance", () => {
  const architecture = source("../docs/architecture/iphone-owner-recovery-enrollment.md");
  for (const phrase of [
    "5分間・1回限り",
    "fresh",
    "atomic",
    "rate limit",
    "発行元端末の失効",
    "challenge/signature",
    "generic",
    "disabled by default",
    "既存の信頼済み端末は削除しない",
    "実機受入は未完了",
  ]) assert.match(architecture, new RegExp(phrase));
});
