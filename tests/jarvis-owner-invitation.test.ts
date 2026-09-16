import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { OwnerInvitationStore } from "../src/jarvis/owner-invitation.ts";
import { invitationUrl, invitationIntent } from "../src/jarvis/invitation-link.ts";
import { GET } from "../src/app/android-join/route.ts";

test("invitation persists consumption across restart, rejects duplicate and 101st identity", t => {
  const dir = mkdtempSync(join(tmpdir(), "jarvis-invitation-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, "invitation.json");
  const store = new OwnerInvitationStore(file);
  const { secret } = store.create();
  assert.equal(readFileSync(file, "utf8").includes(secret), false);
  assert.throws(() => store.create());
  store.consume(secret, "node-0");
  const restarted = new OwnerInvitationStore(file);
  assert.equal(restarted.status().usedDevices, 1);
  assert.throws(() => restarted.consume(secret, "node-0"));
  assert.throws(() => restarted.consume("ji_" + "a".repeat(43), "wrong"));
  for (let n = 1; n < 100; n++) restarted.consume(secret, `node-${n}`);
  assert.throws(() => restarted.consume(secret, "node-100"));
  assert.equal(restarted.status().remaining, 0);
});

test("revocation survives restart and rotation never restores the old invitation", t => {
  const dir = mkdtempSync(join(tmpdir(), "jarvis-invitation-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, "invitation.json");
  const store = new OwnerInvitationStore(file);
  const { secret } = store.create(2);
  store.consume(secret, "existing");
  store.revoke();
  const restarted = new OwnerInvitationStore(file);
  assert.throws(() => restarted.consume(secret, "new"));
  assert.equal(restarted.status().usedDevices, 1);
  const replacement = restarted.create(2);
  assert.throws(() => restarted.consume(secret, "new"));
  restarted.consume(replacement.secret, "new");
  writeFileSync(file, "{}");
  assert.throws(() => restarted.create());
  assert.throws(() => restarted.consume(replacement.secret, "another"));
});

test("link carries secret only in fragment and refuses public or insecure ingress", () => {
  const secret = "ji_" + "a".repeat(43);
  const url = new URL(invitationUrl("https://192.168.0.169:8792", secret));
  assert.equal(url.search, "");
  assert.ok(url.hash.includes(secret));
  assert.ok(invitationIntent(url.hash).endsWith("#Intent;scheme=jarvis;package=ai.jarvis.worker;end"));
  for (const broker of ["http://192.168.0.169:8792", "https://example.com", "https://127.0.0.1", "https://user:pass@192.168.0.169", "https://192.168.0.169/extra"]) {
    assert.throws(() => invitationUrl(broker, secret));
  }
});

test("static landing uses exact script CSP and no third-party scripts or token in server response", async () => {
  const response = GET();
  const html = await response.text();
  const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script);
  assert.ok(response.headers.get("Content-Security-Policy")?.includes(`'sha256-${createHash("sha256").update(script).digest("base64")}'`));
  assert.equal(response.headers.get("Referrer-Policy"), "no-referrer");
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal(/<script[^>]+src=/.test(html), false);
  assert.equal(/fetch\(|localStorage|sendBeacon/.test(script), false);
});
