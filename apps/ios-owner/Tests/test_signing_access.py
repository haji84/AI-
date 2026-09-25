from pathlib import Path
import re
import unittest

SOURCE = Path(__file__).resolve().parents[1] / "Sources" / "OwnerCredentialRuntime.swift"

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

if __name__ == "__main__":
    unittest.main()
