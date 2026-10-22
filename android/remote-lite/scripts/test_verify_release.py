"""Policy tests use ZIP fixtures; real Android tools are exercised separately in CI."""
import hashlib
import importlib.util
from pathlib import Path
import tempfile
import unittest
import warnings
import zipfile


SCRIPT = Path(__file__).with_name("verify_release.py")
ROOT = SCRIPT.parents[3]
SIGNER = "ab" * 32
BADGING = "package: name='app.goriq.remote.lite' versionCode='1' versionName='0.1.0-dev' platformBuildVersionName='17'\n"
PERMISSIONS = "\n".join("uses-permission: name='android.permission." + name + "'" for name in (
    "INTERNET", "ACCESS_NETWORK_STATE", "FOREGROUND_SERVICE",
    "FOREGROUND_SERVICE_MEDIA_PROJECTION", "POST_NOTIFICATIONS"))
MANIFEST = '''N: android=http://schemas.android.com/apk/res/android
  E: manifest (line=2)
    A: package="app.goriq.remote.lite" (Raw: "app.goriq.remote.lite")
    E: application (line=8)
      A: android:allowBackup(0x01010280)=(type 0x12)0x0
      A: android:usesCleartextTraffic(0x010104ec)=(type 0x12)0x0
      E: activity (line=13)
        A: android:name(0x01010003)="app.goriq.remote.lite.MainActivity" (Raw: "app.goriq.remote.lite.MainActivity")
      E: activity (line=19)
        A: android:name(0x01010003)="app.goriq.remote.lite.EnrollmentActivity" (Raw: "app.goriq.remote.lite.EnrollmentActivity")
      E: activity (line=27)
        A: android:name(0x01010003)="app.goriq.remote.lite.RemoteSessionActivity" (Raw: "app.goriq.remote.lite.RemoteSessionActivity")
      E: activity (line=28)
        A: android:name(0x01010003)="app.goriq.remote.lite.LicenseActivity" (Raw: "app.goriq.remote.lite.LicenseActivity")
      E: service (line=29)
        A: android:name(0x01010003)="app.goriq.remote.lite.RemoteSessionService" (Raw: "app.goriq.remote.lite.RemoteSessionService")
      E: service (line=31)
        A: android:name(0x01010003)="app.goriq.remote.lite.ManualAccessibilityService" (Raw: "app.goriq.remote.lite.ManualAccessibilityService")
'''
SIGNATURE = f'''Verifies
Verified using v1 scheme (JAR signing): false
Verified using v2 scheme (APK Signature Scheme v2): true
Verified using v3 scheme (APK Signature Scheme v3): true
Number of signers: 1
Signer #1 certificate DN: CN=Remote Lite CI fixture ONLY
Signer #1 certificate SHA-256 digest: {SIGNER}
'''
# Actual public test certificate output from Build Tools 37.0.0/apksigner 0.9,
# CI run 39872893061. No keystore or private key is retained in this fixture.
SDK37_SIGNER = "881157ff714a2eac32b678cd589eef682c89a4b223ab80e0fa69bded664128bd"
SDK37_SIGNATURE = '''Verifies
Verified using v1 scheme (JAR signing): false
Verified using v2 scheme (APK Signature Scheme v2): false
Verified using v3 scheme (APK Signature Scheme v3): true
Verified using v3.1 scheme (APK Signature Scheme v3.1): false
Verified using v3.2 scheme (APK Signature Scheme v3.2): false
Verified using v4 scheme (APK Signature Scheme v4): false
Verified for SourceStamp: false
Number of signers: 1
V3.0 Signer: certificate DN: CN=Remote Lite CI fixture ONLY
V3.0 Signer: certificate SHA-256 digest: 881157ff714a2eac32b678cd589eef682c89a4b223ab80e0fa69bded664128bd
V3.0 Signer: certificate SHA-1 digest: 3508c5626e27d916689493246b22e18a388e03d7
V3.0 Signer: certificate MD5 digest: a1693118cf60f36d31057acdd6e3e6d9
V3.0 Signer: key algorithm: RSA
V3.0 Signer: key size (bits): 2048
V3.0 Signer: public key SHA-256 digest: c97f623da07ed0bb8372df7bb9605117c9620eb9b1c1af7684c5478cdc530f68
V3.0 Signer: public key SHA-1 digest: d8a5342e6c98cbee80bda5a005b40a96e666045a
V3.0 Signer: public key MD5 digest: 40382066f701fb1e455cf68db059db67
'''


class ReleaseVerificationTest(unittest.TestCase):
    def setUp(self):
        self.assertTrue(SCRIPT.is_file(), "read-only signed APK verifier is not implemented")
        spec = importlib.util.spec_from_file_location("verify_release", SCRIPT)
        self.verifier = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.verifier)
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.directory = Path(self.temp.name)
        self.unsigned = self.directory / "approved.apk"
        self.signed = self.directory / "signed.apk"
        self.payload = {"AndroidManifest.xml": b"fixture-binary-manifest",
                        "classes.dex": b"original dex", "resources.arsc": b"original resources",
                        "META-INF/com/android/build/gradle/app-metadata.properties": b"original metadata"}
        for name, source in {
            "REMOTE_LITE_LICENSE.txt": ROOT / "LICENSE-REMOTE-LITE.txt",
            "WEBRTC.md": ROOT / "android/remote-lite/app/src/main/assets/notices/WEBRTC.md",
            "WEBRTC_SDK_LICENSE.txt": ROOT / "android/remote-lite/app/src/main/assets/notices/WEBRTC_SDK_LICENSE.txt",
        }.items():
            self.payload["assets/notices/" + name] = source.read_bytes()
        self.write_zip(self.unsigned, self.payload)
        self.write_zip(self.signed, self.payload)
        self.badging, self.permissions, self.manifest, self.resources = BADGING, PERMISSIONS, MANIFEST, "safe resources"
        self.signature = SIGNATURE
        self.v1_signature = SIGNATURE.replace("scheme (JAR signing): false", "scheme (JAR signing): true")
        self.tool_failure = None
        self.options = dict(unsigned=self.unsigned, signed=self.signed,
                            unsigned_sha256=hashlib.sha256(self.unsigned.read_bytes()).hexdigest(),
                            signer_sha256=SIGNER, version_code=1, version_name="0.1.0-dev",
                            previous_version_code=0, source_commit="12" * 20,
                            build_tools=self.directory, test_only_key=True)

    def write_zip(self, path, payload):
        with zipfile.ZipFile(path, "w") as archive:
            for name, data in payload.items():
                archive.writestr(name, data)

    def run_tool(self, tool, arguments):
        # SDK executables are unavailable locally. Match their documented commands;
        # CI uses these same public verifier paths with actual aapt/apksigner/zipalign.
        if tool == self.tool_failure:
            raise self.verifier.VerificationError(f"{tool} failed")
        if tool == "aapt":
            if arguments[:2] == ["dump", "badging"]:
                return self.badging
            if arguments[:2] == ["dump", "permissions"]:
                return self.permissions
            if arguments[:2] == ["dump", "xmltree"]:
                return self.manifest
            if arguments[:3] == ["dump", "--values", "resources"]:
                return self.resources
        if tool == "apksigner" and arguments[:3] == ["verify", "--verbose", "--print-certs"]:
            return self.v1_signature if "--max-sdk-version" in arguments else self.signature
        if tool == "zipalign" and arguments[:5] == ["-c", "-P", "16", "-v", "4"]:
            return "Verification successful"
        raise AssertionError(f"unexpected SDK operation: {tool} {arguments}")

    def verify(self, **overrides):
        return self.verifier.verify_release(**(self.options | overrides), run_tool=self.run_tool)

    def test_same_payload_returns_limited_receipt_without_changing_apks(self):
        before = [path.read_bytes() for path in (self.unsigned, self.signed)]
        receipt = self.verify()
        self.assertEqual(receipt["status"], "PASS")
        self.assertEqual(receipt["signerCertificateSha256"], SIGNER)
        self.assertEqual(receipt["unsignedSha256"], self.options["unsigned_sha256"])
        self.assertFalse(receipt["distributable"])
        self.assertEqual(receipt["physicalAcceptance"], "NOT_RUN")
        self.assertEqual(receipt["signingKeyPurpose"], "CI_TEST_ONLY")
        self.assertEqual(before, [path.read_bytes() for path in (self.unsigned, self.signed)])

    def test_coherent_v1_signature_metadata_is_the_only_zip_exception(self):
        self.write_zip(self.signed, self.payload | {"META-INF/MANIFEST.MF": b"manifest",
            "META-INF/CERT.SF": b"digest", "META-INF/CERT.RSA": b"signature"})
        self.assertEqual(self.verify()["status"], "PASS")

    def test_signature_named_files_cannot_hide_payload_without_a_verified_v1_signature(self):
        self.v1_signature = SIGNATURE
        self.write_zip(self.signed, self.payload | {"META-INF/MANIFEST.MF": b"extra payload",
            "META-INF/CERT.SF": b"extra payload", "META-INF/CERT.RSA": b"extra payload"})
        with self.assertRaisesRegex(self.verifier.VerificationError, "v1"):
            self.verify()

    def test_v1_metadata_warning_is_retained_only_for_already_compared_payload(self):
        warning = ("WARNING: META-INF/com/android/build/gradle/app-metadata.properties not protected by signature. "
                   "Unauthorized modifications to this JAR entry will not be detected. Delete or move the entry outside of META-INF/.")
        self.v1_signature += warning + "\n"
        self.write_zip(self.signed, self.payload | {"META-INF/MANIFEST.MF": b"manifest",
            "META-INF/CERT.SF": b"digest", "META-INF/CERT.RSA": b"signature"})
        self.assertEqual(self.verify().get("v1Warnings"), [warning])
        for invalid in (warning.replace("app-metadata.properties", "not-in-approved-apk"),
                        "WARNING: unknown signature issue"):
            self.v1_signature = self.v1_signature.split("WARNING:")[0] + invalid + "\n"
            with self.subTest(warning=invalid), self.assertRaisesRegex(self.verifier.VerificationError, "warning"):
                self.verify()

    def test_changed_dex_resource_or_other_meta_inf_entry_is_rejected(self):
        for name in ("classes.dex", "resources.arsc", "META-INF/com/android/build/gradle/app-metadata.properties"):
            with self.subTest(name=name):
                self.write_zip(self.signed, self.payload | {name: b"changed"})
                with self.assertRaisesRegex(self.verifier.VerificationError, "payload"):
                    self.verify()

    def test_extra_or_missing_payload_and_unpaired_signing_metadata_are_rejected(self):
        for payload in (self.payload | {"META-INF/EVIL.SF": b"not a signature set"},
                        self.payload | {"new.dex": b"extra code"},
                        {k: v for k, v in self.payload.items() if k != "classes.dex"}):
            with self.subTest(names=tuple(payload)):
                self.write_zip(self.signed, payload)
                with self.assertRaises(self.verifier.VerificationError):
                    self.verify()

    def test_duplicate_and_noncanonical_zip_paths_are_rejected(self):
        for name in ("classes.dex", "../classes.dex", "/classes.dex", "a/../classes.dex", "a\\classes.dex", "a//b", "C:/a"):
            with self.subTest(name=name):
                self.write_zip(self.signed, self.payload)
                with warnings.catch_warnings():
                    warnings.simplefilter("ignore", UserWarning)
                    with zipfile.ZipFile(self.signed, "a") as archive:
                        archive.writestr(name, b"extra")
                with self.assertRaises(self.verifier.VerificationError):
                    self.verify()

    def test_reference_hash_is_required_even_for_matching_apks(self):
        with self.assertRaisesRegex(self.verifier.VerificationError, "unsigned SHA256"):
            self.verify(unsigned_sha256="0" * 64)

    def test_required_notices_are_compared_to_trusted_repository_copies(self):
        changed = self.payload | {"assets/notices/REMOTE_LITE_LICENSE.txt": b"replaced notice"}
        self.write_zip(self.unsigned, changed)
        self.write_zip(self.signed, changed)
        with self.assertRaisesRegex(self.verifier.VerificationError, "notice"):
            self.verify(unsigned_sha256=hashlib.sha256(self.unsigned.read_bytes()).hexdigest())

    def test_wrong_package_version_or_nonincreasing_update_is_rejected(self):
        for badging in (BADGING.replace("app.goriq.remote.lite", "app.goriq.remote.lite.physicaltest"),
                        BADGING.replace("versionCode='1'", "versionCode='0'"),
                        BADGING.replace("0.1.0-dev", "older-name")):
            with self.subTest(badging=badging):
                self.badging = badging
                with self.assertRaises(self.verifier.VerificationError):
                    self.verify()
        self.badging = BADGING
        with self.assertRaisesRegex(self.verifier.VerificationError, "versionCode"):
            self.verify(previous_version_code=1)

    def test_permissions_must_match_exactly(self):
        for permissions in (PERMISSIONS + "\nuses-permission: name='android.permission.CAMERA'",
                            PERMISSIONS.replace("ACCESS_NETWORK_STATE", "ACCESS_WIFI_STATE"),
                            PERMISSIONS.replace("INTERNET'", "INTERNET' maxSdkVersion='28'")):
            with self.subTest(permissions=permissions):
                self.permissions = permissions
                with self.assertRaisesRegex(self.verifier.VerificationError, "permission"):
                    self.verify()

    def test_debug_test_components_and_trust_overrides_are_rejected(self):
        for manifest in (MANIFEST.replace("MainActivity", "DebugPairingActivity"),
                         MANIFEST + '      E: receiver (line=50)\n        A: android:name(0x01010003)="unexpected.Receiver"\n',
                         MANIFEST.replace("E: application (line=8)", "E: application (line=8)\n      A: android:debuggable(0x0101000f)=(type 0x12)0xffffffff"),
                         MANIFEST.replace("E: application (line=8)", "E: application (line=8)\n      A: android:testOnly(0x01010272)=(type 0x12)0xffffffff"),
                         MANIFEST.replace("E: application (line=8)", "E: application (line=8)\n      A: android:networkSecurityConfig(0x01010527)=@0x7f080000"),
                         MANIFEST.replace("android:usesCleartextTraffic(0x010104ec)=(type 0x12)0x0", "android:usesCleartextTraffic(0x010104ec)=(type 0x12)0xffffffff")):
            with self.subTest(manifest=manifest):
                self.manifest = manifest
                with self.assertRaises(self.verifier.VerificationError):
                    self.verify()

    def test_vm_resources_and_ca_are_rejected(self):
        self.resources = "public-vm-fixture-only"
        with self.assertRaises(self.verifier.VerificationError):
            self.verify()
        self.resources = "safe"
        changed = self.payload | {"res/raw/remote_lite_vm_ca.der": b"CA"}
        self.write_zip(self.unsigned, changed)
        self.write_zip(self.signed, changed)
        with self.assertRaises(self.verifier.VerificationError):
            self.verify(unsigned_sha256=hashlib.sha256(self.unsigned.read_bytes()).hexdigest())

    def test_wrong_multiple_missing_or_debug_signer_is_rejected(self):
        for signature in (SIGNATURE.replace(SIGNER, "cd" * 32),
                          SIGNATURE.replace("Number of signers: 1", "Number of signers: 2"),
                          SIGNATURE.replace(": true", ": false"), "DOES NOT VERIFY",
                          SIGNATURE.replace("CN=Remote Lite CI fixture ONLY", "CN=Android Debug,O=Android,C=US")):
            with self.subTest(signature=signature):
                self.signature = signature
                with self.assertRaises(self.verifier.VerificationError):
                    self.verify()

    def test_sdk37_verified_v3_signer_matches_independent_certificate(self):
        self.signature = SDK37_SIGNATURE
        receipt = self.verify(signer_sha256=SDK37_SIGNER)
        self.assertEqual(receipt["signerCertificateSha256"], SDK37_SIGNER)

    def test_sdk37_wrong_duplicate_unknown_or_unverified_signer_is_rejected(self):
        fingerprint = "V3.0 Signer: certificate SHA-256 digest: " + SDK37_SIGNER + "\n"
        for signature in (SDK37_SIGNATURE.replace(SDK37_SIGNER, "cd" * 32),
                          SDK37_SIGNATURE + fingerprint,
                          SDK37_SIGNATURE + fingerprint.replace("V3.0 Signer:", "Signer #1"),
                          SDK37_SIGNATURE + fingerprint.replace("V3.0 Signer:", "Unknown signer"),
                          SDK37_SIGNATURE.replace("V3.0 Signer:", "V3.1 Signer:"),
                          SDK37_SIGNATURE.replace("v3 scheme (APK Signature Scheme v3): true", "v3 scheme (APK Signature Scheme v3): false"),
                          SDK37_SIGNATURE.replace("Number of signers: 1", "Number of signers: 2")):
            with self.subTest(signature=signature):
                self.signature = signature
                with self.assertRaises(self.verifier.VerificationError):
                    self.verify(signer_sha256=SDK37_SIGNER)

    def test_signature_or_alignment_tool_failure_never_produces_a_receipt(self):
        for tool in ("aapt", "apksigner", "zipalign"):
            with self.subTest(tool=tool):
                self.tool_failure = tool
                with self.assertRaisesRegex(self.verifier.VerificationError, "failed"):
                    self.verify()


if __name__ == "__main__":
    unittest.main()
