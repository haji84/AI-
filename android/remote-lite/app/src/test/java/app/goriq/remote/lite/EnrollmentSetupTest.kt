package app.goriq.remote.lite

import org.junit.Assert.*
import org.junit.Test

class EnrollmentSetupTest {
    private val id = "123e4567-e89b-42d3-a456-426614174000"
    private val request = "123e4567-e89b-42d3-a456-426614174001"
    private val fingerprint = "b".repeat(64)
    private val link = EnrollmentLink.parse("goriqremote://enroll?server=https%3A%2F%2Fremote.example&invite=${"a".repeat(48)}")
    private val identity = object : EnrollmentIdentity {
        override fun deviceId() = id
        override fun publicKeyPem() = "public fixture"
        override fun fingerprint() = fingerprint
        override fun sign(message: String) = "fixture-signature"
    }
    private class Store : EnrollmentStateStore {
        var value: SavedEnrollment? = null
        override fun read() = value
        override fun write(value: SavedEnrollment) { this.value = value }
    }

    @Test fun lostEnrollmentResponseSurvivesRestartAndIsNeverBlindlyResubmitted() {
        val store = Store()
        var attempts = 0
        val exchange = object : EnrollmentExchange {
            override fun propose(code: String, deviceId: String, publicKeyPem: String): EnrollmentChallenge {
                attempts++
                assertEquals("requesting", store.value?.phase)
                error("response lost after request")
            }
            override fun prove(requestId: String, signature: String): EnrollmentReceipt = error("not used")
        }
        runCatching { EnrollmentSetup(identity, store) { exchange }.submit(link) }
        assertEquals("requesting", store.value?.phase)
        assertEquals("https://remote.example", store.value?.origin)
        assertThrows(IllegalStateException::class.java) {
            EnrollmentSetup(identity, store) { exchange }.submit(link)
        }
        assertEquals(1, attempts)
    }

    @Test fun confirmedReceiptIsRetainedWithoutTheInvitation() {
        val store = Store()
        val exchange = object : EnrollmentExchange {
            override fun propose(code: String, deviceId: String, publicKeyPem: String) =
                EnrollmentChallenge(request, "c".repeat(48), fingerprint, 1_900_000_000_000)
            override fun prove(requestId: String, signature: String) =
                EnrollmentReceipt(request, id, fingerprint, "awaiting-owner-approval")
        }
        val result = runCatching { EnrollmentSetup(identity, store) { exchange }.submit(link) }
        assertTrue("A valid receipt must be retained", result.isSuccess)
        assertEquals("awaiting-owner-approval", store.value?.phase)
        assertEquals(request, store.value?.requestId)
        assertEquals(id, store.value?.deviceId)
        assertFalse(store.value.toString().contains("a".repeat(48)))
    }

    @Test fun anIncomingInvitationCannotReplaceAnExistingServer() {
        val store = Store().apply { value = SavedEnrollment("https://original.example", "approved", id, fingerprint) }
        val setup = EnrollmentSetup(identity, store) { error("A replacement must not reach the network") }
        assertThrows(IllegalStateException::class.java) { setup.submit(link) }
        assertEquals("https://original.example", store.value?.origin)
        assertEquals("approved", store.value?.phase)
    }

    @Test fun ownerConfirmedRecoveryKeepsTheIdentityAndPriorReceipt() {
        val old = SavedEnrollment(link.endpoint.origin, "awaiting-owner-approval", id, fingerprint, request)
        val store = Store().apply { value = old }
        val replacement = "123e4567-e89b-42d3-a456-426614174002"
        val exchange = object : EnrollmentExchange {
            override fun propose(code: String, deviceId: String, publicKeyPem: String): EnrollmentChallenge {
                assertEquals(request, store.value?.requestId)
                assertEquals(id, deviceId)
                return EnrollmentChallenge(replacement, "c".repeat(48), fingerprint, 1_900_000_000_000)
            }
            override fun prove(requestId: String, signature: String) =
                EnrollmentReceipt(replacement, id, fingerprint, "awaiting-owner-approval")
        }
        val result = EnrollmentSetup(identity, store) { exchange }.retryAfterOwnerConfirmation(link, old)
        assertEquals(replacement, result.requestId)
        assertEquals(listOf(request), result.previousRequestIds)
        assertEquals(id, result.deviceId)
        assertEquals(fingerprint, result.fingerprint)
    }

    @Test fun recoveryRequiresTheSameUnapprovedStateAndServer() {
        val old = SavedEnrollment("https://original.example", "requesting", id, fingerprint)
        val store = Store().apply { value = old }
        val setup = EnrollmentSetup(identity, store) { error("Must not reach network") }
        assertThrows(IllegalStateException::class.java) { setup.retryAfterOwnerConfirmation(link, old) }
        store.value = old.copy(origin = link.endpoint.origin, phase = "approved")
        assertThrows(IllegalStateException::class.java) {
            setup.retryAfterOwnerConfirmation(link, checkNotNull(store.value))
        }
        store.value = old.copy(origin = link.endpoint.origin)
        assertThrows(IllegalStateException::class.java) {
            setup.retryAfterOwnerConfirmation(link, checkNotNull(store.value).copy(requestId = request))
        }
    }

    @Test fun aLostRecoveryReplyRetainsThePreviousReceiptAndStillNeedsNewConfirmation() {
        val old = SavedEnrollment(link.endpoint.origin, "awaiting-owner-approval", id, fingerprint, request)
        val store = Store().apply { value = old }
        var attempts = 0
        val exchange = object : EnrollmentExchange {
            override fun propose(code: String, deviceId: String, publicKeyPem: String): EnrollmentChallenge {
                attempts++
                error("lost reply")
            }
            override fun prove(requestId: String, signature: String): EnrollmentReceipt = error("not used")
        }
        val setup = EnrollmentSetup(identity, store) { exchange }
        runCatching { setup.retryAfterOwnerConfirmation(link, old) }
        assertEquals("requesting", store.value?.phase)
        assertEquals(request, store.value?.requestId)
        assertThrows(IllegalStateException::class.java) { setup.submit(link) }
        assertEquals(1, attempts)
    }

    @Test fun aSecondActivityCannotRecoverWhileTheFirstRequestIsStillRunning() {
        val store = Store()
        lateinit var exchange: EnrollmentExchange
        exchange = object : EnrollmentExchange {
            override fun propose(code: String, deviceId: String, publicKeyPem: String): EnrollmentChallenge {
                val second = EnrollmentSetup(identity, store) { error("Duplicate network request") }
                assertThrows(IllegalStateException::class.java) {
                    second.retryAfterOwnerConfirmation(link, checkNotNull(store.value))
                }
                return EnrollmentChallenge(request, "c".repeat(48), fingerprint, 1_900_000_000_000)
            }
            override fun prove(requestId: String, signature: String) =
                EnrollmentReceipt(request, id, fingerprint, "awaiting-owner-approval")
        }
        assertEquals(request, EnrollmentSetup(identity, store) { exchange }.submit(link).requestId)
    }

    @Test fun aStaleApprovalCheckCannotOverwriteANewerReceipt() {
        val old = SavedEnrollment(link.endpoint.origin, "requesting", id, fingerprint)
        val store = Store().apply { value = old.copy(phase = "awaiting-owner-approval", requestId = request) }
        val setup = EnrollmentSetup(identity, store) { error("not used") }
        assertThrows(IllegalStateException::class.java) { setup.recordApprovalAfterSignedCheck(old) }
        assertEquals(request, store.value?.requestId)
    }
}
