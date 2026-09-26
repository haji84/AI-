import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { URL } from "node:url";

const broker = readFileSync(new URL("../scripts/jarvis-broker.ts", import.meta.url), "utf8");
const client = (() => {
  try { return readFileSync(new URL("../src/app/owner-recovery-registry-client.ts", import.meta.url), "utf8"); }
  catch (error) { if (error.code === "ENOENT") return ""; throw error; }
})();

test("Owner recovery is handled inside the authenticated Broker admin boundary", () => {
  const adminBoundary = broker.indexOf('path.startsWith("/api/jarvis/admin/")');
  const ownerGate = broker.indexOf("if (!requireOwner(request))", adminBoundary);
  const recoveryRoute = broker.indexOf('path === "/api/jarvis/admin/owner-recovery"', ownerGate);
  const trustedDeviceRoute = broker.indexOf('path === "/api/jarvis/admin/trusted-devices"', recoveryRoute);
  assert.ok(adminBoundary >= 0 && ownerGate > adminBoundary);
  assert.ok(recoveryRoute > ownerGate && trustedDeviceRoute > recoveryRoute);
  assert.doesNotMatch(broker.slice(recoveryRoute, trustedDeviceRoute), /invitations|OwnerInvitationStore|createEnrollment/);
});

test("Next server client uses only the typed authenticated recovery admin contract", () => {
  assert.match(client, /jarvisBrokerFetch/);
  assert.match(client, /\/api\/jarvis\/admin\/owner-recovery/);
  assert.match(client, /AbortSignal\.timeout\(5_000\)/);
  for (const action of ["issue", "cancel", "redeem"]) assert.match(client, new RegExp(`action: "${action}"`));
  assert.doesNotMatch(client, /JARVIS_OWNER_SECRET|console\.|code.*URLSearchParams|code.*cookie/i);
});
