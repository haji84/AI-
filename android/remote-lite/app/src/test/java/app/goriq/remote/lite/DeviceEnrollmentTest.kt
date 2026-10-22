package app.goriq.remote.lite

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class DeviceEnrollmentTest {
    private val id = "123e4567-e89b-42d3-a456-426614174000"
    private val request = "123e4567-e89b-42d3-a456-426614174001"
    private val fingerprint = "a".repeat(64)
    private val nonce = "b".repeat(48)
    private val invite = "c".repeat(48)
    private val now = 1_720_000_000_000L

    private class FakeIdentity(val id: String, val fingerprint: String) : EnrollmentIdentity {
        var signed: String? = null
        override fun deviceId() = id
        override fun publicKeyPem() = "public-key"
        override fun fingerprint() = fingerprint
        override fun sign(message: String): String { signed = message; return "proof" }
    }

    @Test fun signsOnlyTheMatchingFreshDeviceChallengeAndAwaitsOwnerApproval() {
        val identity = FakeIdentity(id, fingerprint)
        var proved = false
        val exchange = object : EnrollmentExchange {
            override fun propose(code: String, deviceId: String, publicKeyPem: String): EnrollmentChallenge {
                assertEquals(invite, code)
                assertEquals(id, deviceId)
                assertEquals("public-key", publicKeyPem)
                return EnrollmentChallenge(request, nonce, fingerprint, now + 60_000)
            }
            override fun prove(requestId: String, signature: String): EnrollmentReceipt {
                assertEquals(request, requestId)
                assertEquals("proof", signature)
                proved = true
                return EnrollmentReceipt(request, id, fingerprint, "awaiting-owner-approval")
            }
        }
        val receipt = DeviceEnrollment(identity, exchange) { now }.request(invite)
        assertEquals("awaiting-owner-approval", receipt.status)
        assertEquals("GORIQ_REMOTE_DEVICE_ENROLL_V1\n$request\n$id\n$fingerprint\n$nonce", identity.signed)
        assertEquals(true, proved)
    }

    @Test fun fingerprintMismatchRefusesToSignOrProve() {
        val identity = FakeIdentity(id, fingerprint)
        val exchange = object : EnrollmentExchange {
            override fun propose(code: String, deviceId: String, publicKeyPem: String) =
                EnrollmentChallenge(request, nonce, "d".repeat(64), now + 60_000)
            override fun prove(requestId: String, signature: String): EnrollmentReceipt =
                error("proof must not be sent")
        }
        assertThrows(IllegalArgumentException::class.java) {
            DeviceEnrollment(identity, exchange) { now }.request(invite)
        }
        assertEquals(null, identity.signed)
    }

    @Test fun expiredChallengeAndBadInviteNeverReachProof() {
        val identity = FakeIdentity(id, fingerprint)
        var proposals = 0
        val exchange = object : EnrollmentExchange {
            override fun propose(code: String, deviceId: String, publicKeyPem: String): EnrollmentChallenge {
                proposals++
                return EnrollmentChallenge(request, nonce, fingerprint, now)
            }
            override fun prove(requestId: String, signature: String): EnrollmentReceipt =
                error("proof must not be sent")
        }
        assertThrows(IllegalArgumentException::class.java) {
            DeviceEnrollment(identity, exchange) { now }.request("wrong")
        }
        assertEquals(0, proposals)
        assertThrows(IllegalArgumentException::class.java) {
            DeviceEnrollment(identity, exchange) { now }.request(invite)
        }
        assertEquals(1, proposals)
        assertEquals(null, identity.signed)
    }
}
