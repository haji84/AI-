import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { URL } from "node:url";

const runtime = readFileSync(new URL("../apps/ios-owner/Sources/OwnerCredentialRuntime.swift", import.meta.url), "utf8");
const ui = readFileSync(new URL("../apps/ios-owner/Sources/JarvisIOSOwnerApp.swift", import.meta.url), "utf8");

function method(name) {
  const start = runtime.indexOf(`func ${name}`);
  assert.ok(start >= 0, `${name} must exist`);
  const next = runtime.indexOf("\n    func ", start + 6);
  return runtime.slice(start, next < 0 ? runtime.length : next);
}

test("issued recovery code and expiry exist only as volatile runtime state", () => {
  assert.match(runtime, /@Published private\(set\) var recoveryCode: String\?/);
  assert.match(runtime, /@Published private\(set\) var recoveryExpiresAt: Date\?/);
  const issue = method("issueRecoveryCode()");
  assert.doesNotMatch(issue, /Keychain|UserDefaults|FileManager|UIPasteboard/);
  assert.doesNotMatch(runtime, /recoveryCodeAccount|owner-recovery-code/);
});

test("recovery issuance performs trusted proof before the issue request", () => {
  const issue = method("issueRecoveryCode()");
  assert.ok(issue.indexOf("verifyTrustedDeviceProof()") < issue.indexOf('path: "/api/owner-login/trusted/recovery/issue"'));
  assert.match(issue, /statusCode == 200/);
  assert.match(issue, /expiry\.timeIntervalSinceNow <= 300/);
  assert.match(issue, /recoveryCode = code/);
  assert.match(issue, /recoveryExpiresAt =/);
});

test("registered Owner actions and protected recovery presentation are explicit", () => {
  for (const label of ["Face IDと端末鍵でログイン", "別端末の復旧コードを表示", "Googleで端末鍵を再登録", "この端末の信頼登録を失効して削除", "このiPhoneの保存情報だけ削除"]) {
    assert.match(ui, new RegExp(label));
  }
  assert.match(ui, /owner\.recoveryCode/);
  assert.match(ui, /TimelineView/);
  assert.match(ui, /privacySensitive\(\)/);
  assert.match(ui, /textSelection\(\.disabled\)/);
  assert.match(ui, /復旧コードを隠す/);
  assert.match(ui, /復旧コードを取り消す/);
  assert.doesNotMatch(ui, /Button\("コピー"/);
});

test("backgrounding and hiding clear both recovery value and countdown with no relaunch restoration", () => {
  const hide = method("hideRecoveryCode()");
  assert.match(hide, /recoveryCode = nil/);
  assert.match(hide, /recoveryExpiresAt = nil/);
  assert.match(hide, /recoveryIssueGeneration \+= 1/);
  assert.match(ui, /phase != \.active \{ owner\.hideRecoveryCode\(\) \}/);
  const initializer = runtime.slice(runtime.indexOf("init()"), runtime.indexOf("func enroll", runtime.indexOf("init()")));
  assert.doesNotMatch(initializer, /recoveryCode|recoveryExpiresAt/);
});

test("a late issue response cannot restore a code after background clearing", () => {
  const issue = method("issueRecoveryCode()");
  assert.match(issue, /let issueGeneration = recoveryIssueGeneration/);
  assert.match(issue, /guard issueGeneration == recoveryIssueGeneration else \{ throw OwnerError\.recoveryUnavailable \}/);
  assert.ok(issue.indexOf("guard issueGeneration == recoveryIssueGeneration") < issue.indexOf("recoveryCode = code"));
});

test("cancellation clears volatile state only after a successful server response", () => {
  const cancel = method("cancelRecoveryCode()");
  assert.match(cancel, /trusted\/recovery\/cancel/);
  assert.ok(cancel.indexOf("statusCode == 200") < cancel.indexOf("hideRecoveryCode()"));
});

test("an unregistered iPhone accepts only the short recovery enrollment code", () => {
  assert.match(ui, /SecureField\("iPhoneに表示された復旧コード"/);
  assert.match(ui, /owner\.enrollWithRecoveryCode\(entered\)/);
  assert.doesNotMatch(ui, /ZBookで確認した本番コード|本番ログインコード|復旧用：本番コードで登録/);
  assert.doesNotMatch(runtime, /func enroll\(code:|revealedCode|hasStoredCode|UIPasteboard|UniformTypeIdentifiers|saveProtected|readProtected/);
});

test("recovery redemption creates a protected local key and sends only public enrollment material", () => {
  const enroll = method("enrollWithRecoveryCode(_ code: String)");
  assert.match(enroll, /SecAccessControlCreateWithFlags[^\n]+\.userPresence[^\n]+\.privateKeyUsage/);
  assert.match(enroll, /SecureEnclave\.P256\.Signing\.PrivateKey/);
  assert.match(enroll, /"code": normalizedCode/);
  assert.match(enroll, /"deviceId": id/);
  assert.match(enroll, /"label": "iPhone Owner"/);
  assert.match(enroll, /"publicKeyJwk": publicJWK/);
  assert.doesNotMatch(enroll, /"privateKey"|key\.dataRepresentation[^\n]*JSONSerialization/);
  assert.match(enroll, /storeTrustedDevice\(\s*keyData: key\.dataRepresentation/);
});

test("recovery redemption proves possession before publishing enrollment success", () => {
  const enroll = method("enrollWithRecoveryCode(_ code: String)");
  assert.ok(enroll.indexOf('path: "/api/owner-login/trusted/recovery/redeem"') < enroll.indexOf("verifyTrustedDeviceProof()"));
  assert.ok(enroll.indexOf("verifyTrustedDeviceProof()") < enroll.indexOf("isEnrolled = true"));
  assert.ok(enroll.indexOf("pendingEnrollmentAccount") < enroll.indexOf("storeTrustedDevice("));
  assert.ok(enroll.indexOf("verifyTrustedDeviceProof()") < enroll.lastIndexOf("Keychain.delete(account: Self.pendingEnrollmentAccount)"));
  assert.match(enroll, /catch[\s\S]*deleteTrustedDeviceMaterialPreservingLegacyCode\(\)[\s\S]*throw error/);
});

test("an interrupted recovery enrollment is discarded instead of trusted on relaunch", () => {
  assert.match(runtime, /pendingEnrollmentAccount = "owner-pending-enrollment"/);
  const initializer = runtime.slice(runtime.indexOf("init()"), runtime.indexOf("func enroll", runtime.indexOf("init()")));
  assert.match(initializer, /Keychain\.read\(account: Self\.pendingEnrollmentAccount\)/);
  assert.match(initializer, /deleteTrustedDeviceMaterialPreservingLegacyCode\(\)/);
  assert.ok(initializer.indexOf("pendingEnrollmentAccount") < initializer.indexOf("isEnrolled = Keychain.read"));
});

test("entered recovery code is validated but never persisted", () => {
  const enroll = method("enrollWithRecoveryCode(_ code: String)");
  assert.match(enroll, /normalizedCode/);
  assert.match(enroll, /\^OR-/);
  assert.doesNotMatch(enroll, /Keychain\.save[^\n]*code|UserDefaults[^\n]*code/);
  assert.ok(enroll.indexOf("isEnrolled = true") > enroll.indexOf("verifyTrustedDeviceProof()"));
});

test("legacy Production code is referenced only by explicit cleanup paths", () => {
  assert.match(runtime, /codeAccount = "owner-production-code"/);
  const initializer = runtime.slice(runtime.indexOf("init()"), runtime.indexOf("func ", runtime.indexOf("init()")));
  assert.doesNotMatch(initializer, /codeAccount/);
  assert.doesNotMatch(method("hideRecoveryCode()"), /codeAccount/);
  assert.match(method("enrollWithGoogle()"), /removeLegacyCode: true/);
  assert.match(method("forgetLocal()"), /Self\.codeAccount/);
  assert.doesNotMatch(method("enrollWithRecoveryCode(_ code: String)"), /removeLegacyCode: true/);
});
