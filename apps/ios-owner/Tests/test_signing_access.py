from pathlib import Path
import re
import unittest

SOURCE = Path(__file__).resolve().parents[1] / "Sources" / "OwnerCredentialRuntime.swift"
VIEW = SOURCE.parent / "JarvisIOSOwnerApp.swift"

class SecureEnclaveSigningAccessTests(unittest.TestCase):
    def test_enrollment_keys_allow_private_signing_with_user_presence(self):
        source = SOURCE.read_text()
        for method in ("enrollWithRecoveryCode(_ code:", "enrollWithGoogle()"):
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

    def test_revocation_requires_server_denial_before_local_deletion(self):
        source = SOURCE.read_text()
        start = source.index("func revokeAndForget()")
        end = source.index("func ", start + 5)
        body = source[start:end]
        self.assertIn("verifyRevokedChallengeIsDenied()", body)
        self.assertLess(body.index("verifyRevokedChallengeIsDenied()"), body.index("forgetLocal()"))

    def test_google_local_delete_requires_device_auth_without_stored_code(self):
        source = SOURCE.read_text()
        start = source.index("func forgetLocalAfterAuthentication()")
        end = source.index("func forgetLocal()", start + 5)
        body = source[start:end]
        self.assertIn(".deviceOwnerAuthentication", body)
        self.assertNotIn("readProtected(account: Self.codeAccount)", body)

    def test_recovery_issue_proves_the_trusted_key_before_requesting_a_code(self):
        source = SOURCE.read_text()
        start = source.index("func issueRecoveryCode()")
        end = source.index("func ", start + 5)
        body = source[start:end]
        self.assertLess(body.index("verifyTrustedDeviceProof()"), body.index('path: "/api/owner-login/trusted/recovery/issue"'))

    def test_background_clear_removes_both_volatile_recovery_fields(self):
        source = SOURCE.read_text()
        start = source.index("func hideRecoveryCode()")
        end = source.index("func ", start + 5)
        body = source[start:end]
        self.assertIn("recoveryCode = nil", body)
        self.assertIn("recoveryExpiresAt = nil", body)
        self.assertIn("owner.hideRecoveryCode()", VIEW.read_text())

    def test_recovery_redemption_proves_new_key_before_publishing_enrolled_state(self):
        source = SOURCE.read_text()
        start = source.index("func enrollWithRecoveryCode(_ code:")
        end = source.index("func ", start + 5)
        body = source[start:end]
        self.assertLess(body.index('path: "/api/owner-login/trusted/recovery/redeem"'), body.index("verifyTrustedDeviceProof()"))
        self.assertLess(body.index("verifyTrustedDeviceProof()"), body.index("isEnrolled = true"))
        self.assertIn("deleteTrustedDeviceMaterialPreservingLegacyCode()", body)

if __name__ == "__main__":
    unittest.main()
