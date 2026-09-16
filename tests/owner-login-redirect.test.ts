import assert from "node:assert/strict";
import test from "node:test";
import { ownerLoginLocation, safeOwnerReturnPath } from "../src/app/owner-login-redirect.ts";

test("owner login keeps the browser origin for IP, DNS and private HTTPS entrypoints", () => {
  for (const origin of ["http://127.0.0.1:3097", "http://localhost:3097", "https://zbook.example.ts.net"]) {
    for (const failed of [false, true]) {
      const location = ownerLoginLocation("/jarvis/recordings?limit=5#latest", failed);
      assert.equal(new URL(location, origin).origin, origin);
      assert.equal(location.startsWith("//"), false);
      if (failed) assert.equal(new URL(location, origin).searchParams.get("next"), "/jarvis/recordings?limit=5#latest");
    }
  }
});

test("owner return path rejects authority confusion, encoded separators and controls", () => {
  for (const input of [undefined, "", "https://evil.test", "//evil.test", "/\\evil.test", "/%5cevil.test", "/%2fevil.test", "/a/..//evil.test", "/%2e%2e//evil.test", "/\tevil.test", "/x\r\nLocation:evil", "/%0aevil", "/%invalid"]) {
    assert.equal(safeOwnerReturnPath(input), "/jarvis", String(input));
  }
  assert.equal(safeOwnerReturnPath("/jarvis/../jarvis/recordings?view=recent#frame"), "/jarvis/recordings?view=recent#frame");
});
