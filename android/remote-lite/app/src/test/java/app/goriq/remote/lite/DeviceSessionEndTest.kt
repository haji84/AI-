package app.goriq.remote.lite

import org.junit.Assert.*
import org.junit.Test

class DeviceSessionEndTest {
    private var reply = DeviceSessionClosed("session", "closed")
    private var failure = false
    private val messages = ArrayList<String>()
    private val identity = object : EnrollmentIdentity {
        override fun deviceId() = "device"
        override fun publicKeyPem() = "unused"
        override fun fingerprint() = "c".repeat(64)
        override fun sign(message: String): String { messages.add(message); return "signature" }
    }
    private val exchange = object : DeviceSessionExchange {
        override fun pending(id: String, proof: DiscoveryProof): DeviceSessionView? = null
        override fun active(id: String, proof: DiscoveryProof): DeviceSessionView? = null
        override fun challenge(id: String, operation: String, session: String): DeviceSessionChallenge {
            assertEquals("session-end", operation)
            if (failure) error("network unavailable")
            return DeviceSessionChallenge("123e4567-e89b-42d3-a456-426614174002", "b".repeat(48), 1_000)
        }
        override fun accept(session: String, id: String, proof: DeviceSessionProof): DeviceSessionView = error("unused")
        override fun status(session: String, id: String, proof: DeviceSessionProof): DeviceSessionView = error("unused")
        override fun end(session: String, id: String, proof: DeviceSessionProof): DeviceSessionClosed {
            assertEquals("session", session); assertEquals("device", id)
            assertEquals("session-end", proof.operation); assertEquals("signature", proof.signature)
            return reply
        }
    }
    @Test fun localStopSignsAndConfirmsOnlyItsOwnSessionClosure() {
        assertTrue(DeviceSessionAccess(identity, exchange).end("session"))
        assertTrue(messages.single().startsWith("GORIQ_REMOTE_DEVICE_AUTH_V1\ndevice\nsession-end\nsession\n"))
    }
    @Test fun foreignOrActiveReceiptAndNetworkFailureCannotConfirmClosure() {
        val access = DeviceSessionAccess(identity, exchange)
        reply = DeviceSessionClosed("other", "closed"); assertFalse(access.end("session"))
        reply = DeviceSessionClosed("session", "active"); assertFalse(access.end("session"))
        failure = true; assertFalse(access.end("session"))
    }
}
