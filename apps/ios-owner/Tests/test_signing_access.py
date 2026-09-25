from pathlib import Path
import re
import unittest

SOURCE = Path(__file__).resolve().parents[1] / "Sources" / "OwnerCredentialRuntime.swift"
VIEW = SOURCE.parent / "JarvisIOSOwnerApp.swift"

class SecureEnclaveSigningAccessTests(unittest.TestCase):
    def test_enrollment_keys_allow_private_signing_with_user_presence(self):
        source = SOURCE.read_text()
        for method in ("enroll(code:", "enrollWithGoogle()"):
            with self.subTest(method=method):
                start = source.index("func " + method)
                end = source.index("func ", start + 5)
                body = source[start:end]
                self.assertRegex(
                    body,
                    r"SecAccessControlCreateWithFlags\([^\n]+\.userPresence[^\n]*\.privateKeyUsage",
                    "Secure Enclave signing requires both user presence and privateKeyUsage",
                )

    def test_repair_reenrolls_and_proves_new_key_before_revoking_old_device(self):
        source = SOURCE.read_text()
        self.assertIn("func repairWithGoogle()", source)
        start = source.index("func repairWithGoogle()")
        end = source.index("func ", start + 5)
        body = source[start:end]
        self.assertLess(body.index("enrollWithGoogle()"), body.index("verifyTrustedDeviceProof()"))
        self.assertLess(body.index("verifyTrustedDeviceProof()"), body.index("revokeTrustedDeviceId("))
        self.assertIn("oldDeviceId", body)
        self.assertIn("Button(\"Googleで端末鍵を再登録\")", VIEW.read_text())

if __name__ == "__main__":
    unittest.main()
