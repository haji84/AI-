import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { URL } from "node:url";

test("zero-touch temp env path works on macOS Bash 3.2 with nounset", async () => {
  const source = await readFile(new URL("../scripts/jarvis-mac-zero-touch.sh", import.meta.url), "utf8");
  assert.doesNotMatch(source, /\$\{BASHPID\}/, "BASHPID is unavailable on the macOS system Bash used by launchd");
  assert.match(source, /local tmp="\$\{ENV_FILE\}\.tmp\.\$\$"/);
});
