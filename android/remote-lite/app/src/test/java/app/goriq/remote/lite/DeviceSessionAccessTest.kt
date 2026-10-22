package app.goriq.remote.lite

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class DeviceSessionAccessTest {
    private val deviceId = "123e4567-e89b-42d3-a456-426614174000"
    private val sessionId = "123e4567-e89b-42d3-a456-426614174001"
    private val challengeId = "123e4567-e89b-42d3-a456-426614174002"
    private val nonce = "a".repeat(48)
    private val challenge = "b".repeat(48)
    private val issuedAt = 1_720_000_000_000L

    private class Identity(private val id: String) : EnrollmentIdentity {
        val messages = mutableListOf<String>()
        override fun deviceId() = id
        override fun publicKeyPem() = "unused"
        override fun fingerprint() = "c".repeat(64)
        override fun sign(message: String): String {
            messages.add(message)
            return "signed-${messages.size}"
        }
    }

    @Test fun signedDiscoveryAcceptanceAndStatusUseTheSameRegisteredIdentity() {
        val identity = Identity(deviceId)
        val exchange = object : DeviceSessionExchange {
            override fun pending(id: String, proof: DiscoveryProof): DeviceSessionView? {
                assertEquals(deviceId, id)
                assertEquals(issuedAt, proof.issuedAt)
                assertEquals(nonce, proof.nonce)
                assertEquals("signed-1", proof.signature)
                return DeviceSessionView(sessionId, deviceId, "pending", issuedAt + 60_000)
            }
            override fun challenge(id: String, operation: String, session: String): DeviceSessionChallenge {
                assertEquals(deviceId, id)
                assertEquals(sessionId, session)
                assertTrue(operation == "session-accept" || operation == "session-status")
                return DeviceSessionChallenge(challengeId, challenge, issuedAt + 60_000)
            }
            override fun accept(session: String, id: String, proof: DeviceSessionProof): DeviceSessionView {
                assertEquals("session-accept", proof.operation)
                assertEquals("signed-2", proof.signature)
                return DeviceSessionView(session, id, "active", issuedAt + 600_000)
            }
            override fun status(session: String, id: String, proof: DeviceSessionProof): DeviceSessionView {
                assertEquals("session-status", proof.operation)
                assertEquals("signed-3", proof.signature)
                return DeviceSessionView(session, id, "active", issuedAt + 600_000)
            }
        }
        val access = DeviceSessionAccess(identity, exchange, { issuedAt }, { nonce }, { 0L })
        val pending = access.discoverPending()
        assertEquals(sessionId, pending?.sessionId)
        assertEquals("GORIQ_REMOTE_DEVICE_DISCOVER_V1\n$deviceId\n$issuedAt\n$nonce", identity.messages[0])
        assertEquals("active", access.accept(requireNotNull(pending)).status)
        assertEquals("GORIQ_REMOTE_DEVICE_AUTH_V1\n$deviceId\nsession-accept\n$sessionId\n$challengeId\n$challenge\n", identity.messages[1])
        assertTrue(access.verifyActive(sessionId).allowed)
        assertEquals("GORIQ_REMOTE_DEVICE_AUTH_V1\n$deviceId\nsession-status\n$sessionId\n$challengeId\n$challenge\n", identity.messages[2])
    }

    @Test fun revocationOrMismatchedStatusCannotRunManualOperation() {
        val identity = Identity(deviceId)
        var revoked = false
        var operations = 0
        val exchange = object : DeviceSessionExchange {
            override fun pending(id: String, proof: DiscoveryProof): DeviceSessionView? = null
            override fun challenge(id: String, operation: String, session: String): DeviceSessionChallenge {
                if (revoked) error("DEVICE_REVOKED")
                return DeviceSessionChallenge(challengeId, challenge, issuedAt + 60_000)
            }
            override fun accept(session: String, id: String, proof: DeviceSessionProof): DeviceSessionView =
                error("not used")
            override fun status(session: String, id: String, proof: DeviceSessionProof) =
                DeviceSessionView(session, "other-device", "active", issuedAt + 600_000)
        }
        val access = DeviceSessionAccess(identity, exchange, { issuedAt }, { nonce }, { 0L })
        assertFalse(access.verifyActive(sessionId).allowed)
        assertThrows(IllegalStateException::class.java) {
            access.requireActiveThen(sessionId) { operations++ }
        }
        revoked = true
        assertFalse(access.verifyActive(sessionId).allowed)
        assertThrows(IllegalStateException::class.java) {
            access.requireActiveThen(sessionId) { operations++ }
        }
        assertEquals(0, operations)
    }
}
