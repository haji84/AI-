"""Read-only APK content/signature evidence. Never signs, installs, or approves release."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import zipfile


ROOT = Path(__file__).resolve().parents[3]
PACKAGE = "app.goriq.remote.lite"
PERMISSIONS = {"android.permission." + name for name in (
    "INTERNET", "ACCESS_NETWORK_STATE", "FOREGROUND_SERVICE",
    "FOREGROUND_SERVICE_MEDIA_PROJECTION", "POST_NOTIFICATIONS")}
COMPONENTS = {("activity", PACKAGE + "." + name) for name in (
    "MainActivity", "EnrollmentActivity", "RemoteSessionActivity", "LicenseActivity")}
COMPONENTS |= {("service", PACKAGE + ".RemoteSessionService"),
               ("service", PACKAGE + ".ManualAccessibilityService")}
NOTICES = {
    "assets/notices/REMOTE_LITE_LICENSE.txt": ROOT / "LICENSE-REMOTE-LITE.txt",
    "assets/notices/WEBRTC.md": ROOT / "android/remote-lite/app/src/main/assets/notices/WEBRTC.md",
    "assets/notices/WEBRTC_SDK_LICENSE.txt": ROOT / "android/remote-lite/app/src/main/assets/notices/WEBRTC_SDK_LICENSE.txt",
}
VM_MARKERS = re.compile(r"remote_lite_vm_ca|VmRemoteSessionService|public-vm-fixture-only|DebugPairingActivity|SecureTestActivity", re.I)
V1_ENTRY = re.compile(r"META-INF/([A-Z0-9_-]{1,8})\.(SF|RSA|DSA|EC)\Z")


class VerificationError(ValueError):
    pass


def require(condition, message):
    if not condition:
        raise VerificationError(message)


def sha256(path):
    with Path(path).open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def digest_argument(value, label, length=64):
    require(isinstance(value, str) and re.fullmatch(r"[0-9a-fA-F]{" + str(length) + r"}", value),
            f"{label} must contain exactly {length} hexadecimal characters")
    return value.lower()


def archive_payload(path):
    """Hash uncompressed contents without extraction; retain every non-signature entry."""
    require(path.is_file() and 0 < path.stat().st_size <= 512 * 1024 * 1024, "APK size outside verification bounds")
    entries = {}
    with zipfile.ZipFile(path) as archive:
        infos = archive.infolist()
        require(0 < len(infos) <= 20000, "APK ZIP entry count outside verification bounds")
        require(sum(item.file_size for item in infos) <= 1024 * 1024 * 1024, "APK expanded payload too large")
        with path.open("rb") as stream:
            stream.seek(max(0, archive.start_dir - 16))
            signing_block = stream.read(16) == b"APK Sig Block 42"
        for item in infos:
            name = item.filename
            require(name == item.orig_filename and name and "\\" not in name and ":" not in name
                    and all(part not in ("", ".", "..") for part in name.rstrip("/").split("/")),
                    "noncanonical APK ZIP path")
            require(name not in entries, "duplicate APK ZIP path")
            require(not stat.S_ISLNK(item.external_attr >> 16) and not item.flag_bits & 1,
                    "APK ZIP symlink or encrypted entry is not allowed")
            require(item.compress_type in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED), "unsupported APK ZIP compression")
            require(item.file_size <= 512 * 1024 * 1024, "APK ZIP entry too large")
            with archive.open(item) as stream:
                digest = hashlib.file_digest(stream, "sha256").hexdigest()
            entries[name] = (item.file_size, digest, item.compress_type)
    return entries, signing_block


def signing_metadata(entries):
    names = {name for name in entries if name == "META-INF/MANIFEST.MF" or V1_ENTRY.fullmatch(name)}
    if not names:
        return set()
    # One certificate is allowed. Do not exempt all META-INF files or arbitrary .SF files.
    sf = [name for name in names if name.endswith(".SF")]
    require(len(sf) == 1 and "META-INF/MANIFEST.MF" in names, "incomplete v1 signing metadata")
    base = sf[0][:-3]
    blocks = {base + suffix for suffix in (".RSA", ".DSA", ".EC")}
    require(len(names) == 3 and len(names & blocks) == 1, "unexpected v1 signing metadata")
    return names


def xmltree_elements(text):
    """Read aapt's element/attribute structure instead of matching a global name line."""
    elements, stack = [], []
    for line in text.splitlines():
        element = re.match(r"^(\s*)E: ([\w-]+)(?: |$)", line)
        if element:
            indent, name = len(element[1]), element[2]
            while stack and stack[-1]["indent"] >= indent:
                stack.pop()
            item = dict(indent=indent, name=name, attributes={}, parent=stack[-1]["name"] if stack else None)
            stack.append(item)
            elements.append(item)
        attribute = re.match(r"^\s*A: ([\w:]+)(?:\([^)]*\))?=(.*)$", line)
        if attribute:
            require(bool(stack), "aapt attribute has no element")
            require(attribute[1] not in stack[-1]["attributes"], "duplicate manifest attribute")
            stack[-1]["attributes"][attribute[1]] = attribute[2]
    return elements


def manifest_policy(badging, permissions, manifest, resources, version_code, version_name):
    packages = re.findall(r"^package: name='([^']+)' versionCode='([^']+)' versionName='([^']*)'", badging, re.M)
    require(packages == [(PACKAGE, str(version_code), version_name)], "APK package/version does not match approved candidate")
    declared = []
    for line in permissions.splitlines():
        if not line.strip() or line.startswith("package:"):
            continue
        match = re.fullmatch(r"uses-permission: name='([^']+)'", line.strip())
        require(match is not None, "unexpected or conditional APK permission declaration")
        declared.append(match[1])
    require(len(declared) == len(PERMISSIONS) and set(declared) == PERMISSIONS, "APK permissions do not match release policy")
    require(not VM_MARKERS.search(manifest + "\n" + resources), "release contains VM/debug resources or components")
    elements = xmltree_elements(manifest)
    require(sum(item["name"] == "manifest" for item in elements) == 1, "missing/ambiguous manifest")
    applications = [item for item in elements if item["name"] == "application"]
    require(len(applications) == 1 and applications[0]["parent"] == "manifest", "missing/ambiguous application")
    attrs = applications[0]["attributes"]
    false = "(type 0x12)0x0"
    require(attrs.get("android:usesCleartextTraffic") == false, "release must explicitly reject cleartext traffic")
    require(attrs.get("android:allowBackup") == false, "release must explicitly disable backup")
    for attribute in ("android:debuggable", "android:testOnly"):
        require(attrs.get(attribute, false) == false, "release has debug/test application flags")
    require("android:networkSecurityConfig" not in attrs, "release contains a network trust override")
    actual = []
    for item in elements:
        require(item["name"] != "instrumentation", "release contains test instrumentation")
        if item["name"] in ("activity", "activity-alias", "service", "receiver", "provider"):
            require(item["parent"] == "application", "invalid component parent")
            name = re.match(r'^"([^"\\]+)"(?: \(Raw: "[^"\\]+"\))?$', item["attributes"].get("android:name", ""))
            require(name is not None, "missing/invalid component name")
            normalized = PACKAGE + name[1] if name[1].startswith(".") else name[1]
            actual.append((item["name"], normalized))
    require(len(actual) == len(COMPONENTS) and set(actual) == COMPONENTS, "release component set does not match normal APK")


def signature_policy(output, expected, require_v1=False, payload=None):
    require(re.findall(r"^Number of signers: (\d+)\s*$", output, re.M) == ["1"], "exactly one APK signer is required")
    fingerprints = re.findall(r"^Signer #(\d+) certificate SHA-256 digest: ([0-9a-fA-F]+)\s*$", output, re.M)
    require(fingerprints == [("1", expected)] or [(index, digest.lower()) for index, digest in fingerprints] == [("1", expected)],
            "APK signer certificate SHA256 does not match expected signer")
    if require_v1:
        require(re.search(r"^Verified using v1 scheme \(JAR signing\): true\s*$", output, re.M),
                "excluded v1 metadata must have a verified v1 signature")
    else:
        require(re.search(r"^Verified using v[23](?:\.1)? scheme \([^\n]+\): true\s*$", output, re.M),
                "APK has no verified v2/v3 signature")
    require(not re.search(r"certificate DN:.*CN=Android Debug(?:,|$)", output, re.I | re.M), "Android debug signing identity is not a release candidate")
    warnings = [line for line in output.splitlines() if line.startswith("WARNING:")]
    for warning in warnings:
        match = re.fullmatch(r"WARNING: (META-INF/[^\r\n]+) not protected by signature\. Unauthorized modifications to this JAR entry "
                             r"will not be detected\. Delete or move the entry outside of META-INF/\.", warning)
        require(require_v1 and match is not None and match[1] in (payload or {}), "unexpected APK signature warning")
    return warnings


def sdk_runner(build_tools):
    directory = Path(build_tools).resolve(strict=True)
    require(directory.is_dir(), "build-tools must be an installed Android Build Tools directory")

    def run(tool, arguments):
        suffix = (".bat" if tool == "apksigner" else ".exe") if os.name == "nt" else ""
        executable = directory / (tool + suffix)
        require(executable.is_file(), f"required Android tool missing: {tool}")
        try:
            result = subprocess.run([str(executable), *map(str, arguments)], capture_output=True,
                                    text=True, encoding="utf-8", errors="strict", timeout=120, check=False)
        except (OSError, subprocess.TimeoutExpired, UnicodeError) as error:
            raise VerificationError(f"{tool} could not complete: {type(error).__name__}") from error
        require(result.returncode == 0, f"{tool} failed (exit {result.returncode}): {result.stderr[-2000:].strip()}")
        return result.stdout

    return run


def verify_release(*, unsigned, signed, unsigned_sha256, signer_sha256, version_code, version_name,
                   previous_version_code, source_commit, build_tools, test_only_key=False, run_tool=None):
    unsigned, signed = Path(unsigned).resolve(strict=True), Path(signed).resolve(strict=True)
    require(unsigned != signed, "unsigned and signed APK paths must be distinct")
    unsigned_sha256 = digest_argument(unsigned_sha256, "unsigned SHA256")
    signer_sha256 = digest_argument(signer_sha256, "signer SHA256")
    source_commit = digest_argument(source_commit, "source commit", 40)
    require(0 <= previous_version_code < version_code <= 2100000000, "versionCode must increase beyond the last accepted version (0 for first release)")
    require(bool(re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._+-]{0,99}", version_name)), "invalid expected version name")
    require(sha256(unsigned) == unsigned_sha256, "unsigned SHA256 does not match independently approved candidate")
    signed_sha256 = sha256(signed)
    reference, unsigned_block = archive_payload(unsigned)
    candidate, _ = archive_payload(signed)
    require(not unsigned_block and not signing_metadata(reference), "reference APK must be unsigned")
    ignored = signing_metadata(candidate)
    payload = {name: value for name, value in candidate.items() if name not in ignored}
    require(payload == reference, "signed APK payload differs from approved unsigned APK")
    require(not any(VM_MARKERS.search(name) for name in payload), "release payload contains VM/debug fixture")
    for name, source in NOTICES.items():
        require(name in payload and payload[name][0] > 0 and payload[name][1] == sha256(source),
                f"missing or changed release notice: {name}")
    run = run_tool if run_tool is not None else sdk_runner(build_tools)
    manifest_policy(run("aapt", ["dump", "badging", str(signed)]),
                    run("aapt", ["dump", "permissions", str(signed)]),
                    run("aapt", ["dump", "xmltree", str(signed), "AndroidManifest.xml"]),
                    run("aapt", ["dump", "--values", "resources", str(signed)]), version_code, version_name)
    signature_policy(run("apksigner", ["verify", "--verbose", "--print-certs", "-Werr", str(signed)]), signer_sha256)
    v1_warnings = []
    if ignored:
        # At minSdk 28 apksigner can skip v1 in favor of v3. Explicitly verify its
        # metadata with the v1-only API range; this does not claim API23 app support.
        # Android v1 ignores other META-INF files. Only its exact warning for files
        # already byte-compared above is allowed and retained; all others fail.
        v1_warnings = signature_policy(run("apksigner", ["verify", "--verbose", "--print-certs",
                                                        "--min-sdk-version", "23", "--max-sdk-version", "23", str(signed)]),
                                       signer_sha256, require_v1=True, payload=payload)
    for apk in (unsigned, signed):
        run("zipalign", ["-c", "-P", "16", "-v", "4", str(apk)])
    require(sha256(unsigned) == unsigned_sha256 and sha256(signed) == signed_sha256, "APK changed during verification")
    return dict(schemaVersion=1, status="PASS", verifiedAt=datetime.now(timezone.utc).isoformat(),
                scope="APK_CONTENT_AND_SIGNATURE_ONLY", distributable=False, physicalAcceptance="NOT_RUN",
                releaseAcceptance="PENDING", signingKeyPurpose="CI_TEST_ONLY" if test_only_key else "EXPECTED_SIGNER_ONLY",
                assertedSourceCommit=source_commit, provenance="Source commit is caller-supplied; match unsigned hash to independently approved CI evidence.",
                package=PACKAGE, versionCode=version_code, versionName=version_name, previousVersionCode=previous_version_code,
                unsignedSha256=unsigned_sha256, signedSha256=signed_sha256, signerCertificateSha256=signer_sha256,
                payloadEntriesCompared=len(payload), excludedSigningEntries=sorted(ignored),
                permissions=sorted(PERMISSIONS), notices=sorted(NOTICES), alignment="zipalign -c -P 16 -v 4",
                v1MetadataVerified=bool(ignored), v1Warnings=v1_warnings,
                signature="apksigner verify --verbose --print-certs -Werr", buildToolsDirectory=str(Path(build_tools).resolve()))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("unsigned", "signed", "unsigned-sha256", "signer-sha256", "version-name", "source-commit", "build-tools"):
        parser.add_argument("--" + name, required=True)
    parser.add_argument("--version-code", type=int, required=True)
    parser.add_argument("--previous-version-code", type=int, required=True, help="Last accepted release; 0 for first release")
    parser.add_argument("--test-only-key", action="store_true", help="Label CI ephemeral-key evidence; never a release authorization")
    arguments = parser.parse_args()
    try:
        receipt = verify_release(**vars(arguments))
    except (VerificationError, OSError, zipfile.BadZipFile, RuntimeError) as error:
        print(f"FAIL: {error}", file=sys.stderr)
        return 1
    print(json.dumps(receipt, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
