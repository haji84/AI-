import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { URL } from "node:url";

const broker = readFileSync(new URL("../scripts/jarvis-broker.ts", import.meta.url), "utf8");

test("replacement challenge and owner review routes remain behind owner auth", () => {
  const adminStart = broker.indexOf('path.startsWith("/api/jarvis/admin/")');
  const ownerGate = broker.indexOf("if (!requireOwner(request))", adminStart);
  const readyRoute = broker.indexOf('path === "/api/jarvis/admin/replacement/ready"', ownerGate);
  const challengeRoute = broker.indexOf('path === "/api/jarvis/admin/replacement/challenge"', ownerGate);
  const discardRoute = broker.indexOf('path === "/api/jarvis/admin/replacement/discard"', ownerGate);
  assert(adminStart >= 0 && ownerGate > adminStart);
  assert(readyRoute > ownerGate);
  assert(challengeRoute > ownerGate);
  assert(discardRoute > ownerGate);
});

test("untrusted replacement proof route returns only bounded proof summary and no identity mutation", () => {
  const adminEnd = broker.indexOf('if (method === "POST" && path === "/api/jarvis/replacement/prove")');
  const enrollmentStart = broker.indexOf('if (method === "POST" && path === "/api/jarvis/enroll")', adminEnd);
  assert(adminEnd >= 0 && enrollmentStart > adminEnd);
  const section = broker.slice(adminEnd, enrollmentStart);
  assert.match(section, /replacementTransport\.prove/);
  assert.match(section, /candidateId, nodeId and signatureBase64 are required/);
  assert.doesNotMatch(section, /saveWorkerIdentity|revokeWorkerIdentity|deleteWorkerIdentity|publicKeyPem/);
});

test("Broker exposes no replacement approval route that could bypass the explicit Human Gate", () => {
  assert.doesNotMatch(broker, /\/api\/jarvis\/admin\/replacement\/(approve|commit|apply|rebind|revoke)/);
  assert.match(broker, /READY_FOR_HUMAN_GATE|replacement\/ready/);
});
