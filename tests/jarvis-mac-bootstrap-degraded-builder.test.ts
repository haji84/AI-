import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Mac Bootstrap treats missing Code Builder as degraded optional capability", async () => {
  const source = await readFile(new URL("../.github/workflows/jarvis-mac-bootstrap.yml", import.meta.url), "utf8");
  assert.match(source, /GORIQ Mac Code Builder degraded/);
  assert.doesNotMatch(source, /echo 'GORIQ Mac Code Builder status is missing\.' >&2\n\s*exit 9/);
  assert.doesNotMatch(
    source,
    /node -e '[^']*code-builder[^']*\?'[^\n]*"\$BUILDER_STATUS"\n\s*else/,
    "Code Builder health must not be the bootstrap exit gate",
  );
  assert.match(source, /\[\[ -s "\$STATUS" \]\]/);
});
