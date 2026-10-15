import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath, URL } from "node:url";
import test from "node:test";
import process from "node:process";

const script = fileURLToPath(new URL("../scripts/ai09-network-recovery.sh", import.meta.url));
const gitBash = "C:\\Program Files\\Git\\bin\\bash.exe";
const bash = process.platform === "win32" && existsSync(gitBash) ? gitBash : "bash";
const shellScript = script.replaceAll("\\", "/");
const bashProbe = spawnSync(bash, ["--version"], { encoding: "utf8", timeout: 15000 });
assert.equal(bashProbe.status, 0, "BASH_REQUIRED: " + (bashProbe.error?.message ?? bashProbe.stderr));
function pure(command, args = []) {
  return spawnSync(bash, ["--noprofile", "--norc", "-c", 'source "$1"; shift; ' + command + ' "$@"', "fixture", shellScript, ...args], {
    encoding: "utf8", timeout: 15000, env: { ...process.env, BASH_ENV: "", ENV: "", LC_ALL: "C" },
  });
}
const identity = ["0", "848484", "/mnt/recover.sh", "/mnt", "vfat", "AI09SEED", "CA77-6E6C", "703b5247-01", "/dev/sdb1", "/dev/sda1", "02ea2f0d324543a1ab2973e73c97421d", "00:15:5d:dc:2c:00"];
const oldHash = "ad37eaf039455b7f058d4da73c3fd008752787db45e952d343551d6f8b437fc9";
test("network recovery source exists and parses without running its native body", () => {
  assert.ok(existsSync(script), "NETWORK_RECOVERY_SOURCE_MISSING");
  const result = spawnSync(bash, ["--noprofile", "--norc", "-n", shellScript], { encoding: "utf8", timeout: 15000 });
  assert.equal(result.status, 0, result.stderr);
  const sourced = pure("printf", ["FUNCTIONS_ONLY"]);
  assert.equal(sourced.status, 0, sourced.stderr);
  assert.equal(sourced.stdout, "FUNCTIONS_ONLY");
});
test("exact guest and seed identity passes while every changed identity refuses", () => {
  assert.equal(pure("ai09_validate_identity", identity).status, 0);
  for (let index = 0; index < identity.length; index++) {
    const changed = [...identity]; changed[index] = "wrong";
    assert.notEqual(pure("ai09_validate_identity", changed).status, 0, "identity field " + index + " accepted");
  }
  const osDisk = [...identity]; osDisk[8] = osDisk[9];
  assert.notEqual(pure("ai09_validate_identity", osDisk).status, 0);
});
test("preflight requires only eth0 and lo and exact preserved file metadata/hash", () => {
  assert.equal(pure("ai09_validate_interfaces", ["/sys/class/net/eth0", "/sys/class/net/lo"]).status, 0);
  assert.notEqual(pure("ai09_validate_interfaces", ["/sys/class/net/eth0", "/sys/class/net/lo", "/sys/class/net/eth1"]).status, 0);
  assert.notEqual(pure("ai09_validate_interfaces", ["/sys/class/net/lo"]).status, 0);
  const metadata = ["0:0:644:95:1", oldHash];
  assert.equal(pure("ai09_validate_original", metadata).status, 0);
  for (const bad of ["1000:0:644:95:1", "0:0:666:95:1", "0:0:644:96:1", "0:0:644:95:2"]) {
    assert.notEqual(pure("ai09_validate_original", [bad, oldHash]).status, 0);
  }
  assert.notEqual(pure("ai09_validate_original", [metadata[0], "0".repeat(64)]).status, 0);
});
test("DHCP acceptance requires one usable address on the exact host subnet", () => {
  for (const good of ["172.29.80.2/20", "172.29.87.0/20", "172.29.95.254/20"]) {
    assert.equal(pure("ai09_validate_ipv4", [good]).status, 0, good);
  }
  for (const bad of ["", "172.29.80.0/20", "172.29.80.1/20", "172.29.95.255/20", "172.29.79.254/20", "172.29.96.2/20", "10.0.0.1/20", "172.29.90.2/24", "172.29.90.999/20", "172.29.090.2/20", "172.29.90.2/20\n172.29.90.3/20", "172.29.90.2/20; id"]) {
    assert.notEqual(pure("ai09_validate_ipv4", [bad]).status, 0, bad);
  }
});
test("configuration has an exact NIC match and disables DHCP side effects", () => {
  const result = pure("ai09_render_network");
  assert.equal(result.status, 0, result.stderr);
  const expected = "[Match]\nName=eth0\nMACAddress=00:15:5d:dc:2c:00\n\n[Network]\nDHCP=ipv4\nIPv6AcceptRA=no\nLinkLocalAddressing=no\n\n[DHCPv4]\nUseDNS=no\nUseRoutes=no\nUseNTP=no\nUseHostname=no\nSendHostname=no\n";
  assert.equal(result.stdout, expected);
  assert.doesNotMatch(result.stdout, /Gateway=|DNS=([^\n]*yes)|Name=\*/);
});
test("success requires networkd selecting the new fixed file", () => {
  assert.equal(pure("ai09_validate_selected_network", ["  Network File: /run/systemd/network/09-ai09-bootstrap.network\n  State: routable (configured)\n"]).status, 0);
  for (const bad of ["  Network File: n/a", "  Network File: /run/systemd/network/10-ai09.network", "  Network File: /etc/systemd/network/09-ai09-bootstrap.network", ""]) {
    assert.notEqual(pure("ai09_validate_selected_network", [bad]).status, 0);
  }
});
test("receipt retains actual nonzero exit and never promotes an incomplete DHCP run", () => {
  const success = pure("ai09_format_result", ["0", "VERIFIED", "1", "172.29.88.2/20", "2026-10-16T00:00:00Z"]);
  assert.equal(success.status, 0, success.stderr);
  assert.match(success.stdout, /STATUS=DHCP_IPV4_VERIFIED\nEXIT_CODE=0\n/);
  assert.match(success.stdout, /RUN_ID=network-recovery-20261016-v1\n/);
  assert.match(success.stdout, /SEED_RUN_ID=02ea2f0d324543a1ab2973e73c97421d\n/);
  for (const code of ["18", "19", "124", "153"]) {
    const result = pure("ai09_format_result", [code, "WAIT_DHCP", "1", "", "2026-10-16T00:00:00Z"]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, new RegExp("STATUS=FAILED\\nEXIT_CODE=" + code + "\\n"));
    assert.doesNotMatch(result.stdout, /DHCP_IPV4_VERIFIED/);
  }
  assert.notEqual(pure("ai09_format_result", ["0", "WAIT_DHCP", "1", "", "2026-10-16T00:00:00Z"]).status, 0);
});
test("native entry has no network or receipt write before preflight and does not overwrite old evidence", () => {
  const source = readFileSync(script, "utf8");
  const main = source.slice(source.indexOf("ai09_main()"));
  assert.ok(main.indexOf("ai09_preflight") < main.indexOf("exec 3>"), "receipt opened before identities");
  assert.match(main, /set -o noclobber/);
  assert.match(main, /ulimit -f 1024/);
  assert.match(source, /timeout -k 1s 44s \/bin\/bash \/mnt\/recover\.sh --wait-dhcp/);
  assert.match(source, /timeout -k 1s 9s networkctl reload/);
  assert.match(source, /timeout -k 1s 9s networkctl reconfigure eth0/);
  assert.doesNotMatch(source, /(?:>|tee\s+)(?:\s*)\/(?:mnt\/(?:bridge\.sh|seed\.id|ai09-(?:stdout|stderr|result)\.txt)|run\/systemd\/network\/10-ai09\.network)/);
  assert.doesNotMatch(source, /\b(?:apt|curl|wget|rm|mv|eval)\b|systemctl\s+(?:start|stop|restart|enable)|chmod\s+[^\n]*10-ai09/);
  assert.match(source, /if \[\[ "\$\{BASH_SOURCE\[0\]\}" == "\$0" \]\]/);
});

test("a failed address read cannot be accepted as an empty interface", () => {
  assert.equal(pure("ip() { return 0; }; ai09_require_no_global_ipv4").status, 0);
  assert.equal(pure("ip() { return 7; }; ai09_require_no_global_ipv4").status, 23);
  assert.equal(pure("ip() { printf '%s\\n' '2: eth0 inet 172.29.88.2/20'; }; ai09_require_no_global_ipv4").status, 23);
});

test("EXIT trap records actual failures and never treats a failed flush as success", () => {
  const common = "date() { printf '%s\\n' 2026-10-16T00:00:00Z; }; exec 3>&1; config_created=1; ipv4=''; phase=WAIT_DHCP; trap ai09_finish EXIT; ";
  for (const code of [18, 124, 153]) {
    const result = pure(common + "timeout() { return 0; }; exit " + code);
    assert.equal(result.status, code, result.stderr);
    assert.match(result.stdout, new RegExp("STATUS=FAILED\\nEXIT_CODE=" + code + "\\n"));
  }
  const success = pure(common + "timeout() { return 0; }; phase=VERIFIED; ipv4=172.29.88.2/20; exit 0");
  assert.equal(success.status, 0, success.stderr);
  assert.match(success.stdout, /STATUS=DHCP_IPV4_VERIFIED\nEXIT_CODE=0\n/);
  const flushBeforeReceipt = pure(common + "timeout() { return 1; }; exit 18");
  assert.equal(flushBeforeReceipt.status, 74);
  assert.match(flushBeforeReceipt.stdout, /STATUS=FAILED\nEXIT_CODE=74\n/);
  const flushAfterReceipt = pure(common + "count=0; timeout() { count=$((count+1)); [[ $count == 1 ]]; }; phase=VERIFIED; ipv4=172.29.88.2/20; exit 0");
  assert.equal(flushAfterReceipt.status, 74);
  assert.match(flushAfterReceipt.stderr, /RECOVERY_RECEIPT_FLUSH_FAILED/);
  assert.match(flushAfterReceipt.stdout, /EXIT_CODE=0\n/, "collector must reject console/receipt exit mismatch");
});

test("a failed route read cannot verify absence of a default route", () => {
  assert.equal(pure("ip() { return 0; }; ai09_require_no_default_route").status, 0);
  assert.equal(pure("ip() { return 7; }; ai09_require_no_default_route").status, 25);
  assert.equal(pure("ip() { printf '%s\\n' 'default via 172.29.80.1 dev eth0'; }; ai09_require_no_default_route").status, 25);
});
