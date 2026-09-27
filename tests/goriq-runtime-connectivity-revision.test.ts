import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { URL } from "node:url";

test("connectivity exposes non-secret Broker runtime revision evidence", async () => {
  const s = await readFile(new URL("../src/app/api/jarvis/connectivity/route.ts", import.meta.url), "utf8");
  assert.match(s, /runtimeRevision/);
  assert.match(s, /typeof health\?\.runtimeRevision === "string"/);
  const responseObject = s.slice(s.indexOf("return NextResponse.json({"));
  assert.doesNotMatch(responseObject, /JARVIS_OWNER_TOKEN/);
  assert.doesNotMatch(responseObject, /JARVIS_BROKER_URL/);
  assert.match(responseObject, /ownerTokenConfigured/);
  assert.match(responseObject, /runtimeRevision/);
});
