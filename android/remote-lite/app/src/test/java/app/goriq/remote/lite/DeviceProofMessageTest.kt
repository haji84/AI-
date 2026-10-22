package app.goriq.remote.lite

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class DeviceProofMessageTest {
    private val device = "123e4567-e89b-42d3-a456-426614174000"
    private val request = "123e4567-e89b-42d3-a456-426614174001"
    private val fingerprint = "a".repeat(64)
    private val challenge = "b".repeat(48)

    @Test fun enrollmentMatchesCoordinatorCanonicalMessage() {
        assertEquals("GORIQ_REMOTE_DEVICE_ENROLL_V1\n$request\n$device\n$fingerprint\n$challenge",
            DeviceProofMessage.enrollment(request, device, fingerprint, challenge))
    }

    @Test fun sessionStatusMatchesCoordinatorCanonicalMessage() {
        assertEquals("GORIQ_REMOTE_DEVICE_AUTH_V1\n$device\nsession-status\nsession-1\n$request\n$challenge\n",
            DeviceProofMessage.session(device, "session-status", "session-1", request, challenge))
    }

    @Test fun signalSendBindsTheExactPayloadHash() {
        val hash = "c".repeat(64)
        assertEquals("GORIQ_REMOTE_DEVICE_AUTH_V1\n$device\nsignal-send\nsession-1\n$request\n$challenge\n$hash",
            DeviceProofMessage.session(device, "signal-send", "session-1", request, challenge, hash))
    }

    @Test fun discoveryMatchesCoordinatorCanonicalMessage() {
        assertEquals("GORIQ_REMOTE_DEVICE_DISCOVER_V1\n$device\n1720000000000\n$challenge",
            DeviceProofMessage.discovery(device, 1720000000000, challenge))
    }

    @Test fun untrustedFieldsCannotInjectSignedLines() {
        assertThrows(IllegalArgumentException::class.java) {
            DeviceProofMessage.enrollment(request, "$device\nattacker", fingerprint, challenge)
        }
        assertThrows(IllegalArgumentException::class.java) {
            DeviceProofMessage.session(device, "shell", "session-1", request, challenge)
        }
        assertThrows(IllegalArgumentException::class.java) {
            DeviceProofMessage.session(device, "signal-send", "session-1", request, challenge)
        }
        assertThrows(IllegalArgumentException::class.java) {
            DeviceProofMessage.session(device, "session-status", "session-1", request, challenge, "c".repeat(64))
        }
        assertThrows(IllegalArgumentException::class.java) {
            DeviceProofMessage.discovery(device, -1, challenge)
        }
    }
}
