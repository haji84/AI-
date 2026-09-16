import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { URL } from "node:url";

const broker = readFileSync(new URL("../scripts/jarvis-broker.ts", import.meta.url), "utf8");
const audit = readFileSync(new URL("../docs/audit/jarvis-p4-device-owner-provisioning-2026-09-16.md", import.meta.url), "utf8");

test("Device Owner provisioning pins admin component, APK location/checksum and JARVIS extras", () => {
  const start = broker.indexOf("function fullProvisioningPayload");
  const end = broker.indexOf("function provisioningQrPngBase64", start);
  assert(start >= 0 && end > start, "fullProvisioningPayload helper must exist");
  const helper = broker.slice(start, end);

  assert.match(helper, /PROVISIONING_DEVICE_ADMIN_COMPONENT_NAME/);
  assert.match(helper, /ai\.jarvis\.worker\/\.JarvisDeviceAdminReceiver/);
  assert.match(helper, /PROVISIONING_DEVICE_ADMIN_PACKAGE_DOWNLOAD_LOCATION/);
  assert.match(helper, /PROVISIONING_DEVICE_ADMIN_PACKAGE_CHECKSUM/);
  assert.match(helper, /PROVISIONING_ADMIN_EXTRAS_BUNDLE/);
  assert.match(helper, /jarvis_broker/);
  assert.match(helper, /jarvis_token/);
});

test("managed provisioning remains behind owner-authenticated admin enrollment", () => {
  const publicEnroll = broker.indexOf('method === "GET" && path === "/enroll"');
  const adminStart = broker.indexOf('path.startsWith("/api/jarvis/admin/")');
  const ownerGate = broker.indexOf("if (!requireOwner(request))", adminStart);
  const enrollmentRoute = broker.indexOf('path === "/api/jarvis/admin/enrollment"', ownerGate);
  const provisioningCall = broker.indexOf("fullProvisioningPayload(publicBrokerUrl, fullToken.token, apk)", enrollmentRoute);

  assert(publicEnroll >= 0 && adminStart > publicEnroll, "fixed enrollment route must precede the admin-only branch");
  assert(ownerGate > adminStart, "admin branch must authenticate the owner before enrollment handling");
  assert(enrollmentRoute > ownerGate, "admin enrollment route must be inside the authenticated branch");
  assert(provisioningCall > enrollmentRoute, "managed provisioning must be constructed only after the admin enrollment route is selected");

  const publicSection = broker.slice(publicEnroll, adminStart);
  assert.doesNotMatch(publicSection, /fullProvisioningPayload|PROVISIONING_DEVICE_ADMIN/);
  assert.equal((broker.match(/fullProvisioningPayload\(/g) ?? []).length, 2, "provisioning helper should have one definition and one authenticated call site");
});

test("Device Owner evidence stays physical-gated and personal lock fallback remains human-gated", () => {
  assert.match(broker, /requireHumanForLockedDevice:\s*true/);
  assert.match(audit, /does \*\*not\*\* claim that Device Owner provisioning has succeeded on a physical handset/i);
  assert.match(audit, /remain PHYSICAL-gated/i);
  assert.match(audit, /must not store or auto-type a user's lock credential/i);
  assert.match(audit, /existing-device one-tap enrollment path/i);
});
