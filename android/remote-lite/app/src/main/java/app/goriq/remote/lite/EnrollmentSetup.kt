package app.goriq.remote.lite

data class SavedEnrollment(val origin: String, val phase: String, val deviceId: String,
    val fingerprint: String, val requestId: String? = null, val previousRequestIds: List<String> = emptyList())

interface EnrollmentStateStore {
    fun read(): SavedEnrollment?
    fun write(value: SavedEnrollment)
}

class EnrollmentSetup(private val identity: EnrollmentIdentity,
    private val store: EnrollmentStateStore,
    private val exchange: (RemoteEndpoint) -> EnrollmentExchange) {
    companion object {
        private val enrollmentLock = Any()
        private val inFlight = mutableSetOf<String>()
    }

    fun submit(link: EnrollmentLink): SavedEnrollment = request(link, null)

    /** Called only after a local dialog confirms the owner checked the old request. */
    fun retryAfterOwnerConfirmation(link: EnrollmentLink, expected: SavedEnrollment): SavedEnrollment =
        request(link, expected)

    private fun request(link: EnrollmentLink, recovery: SavedEnrollment?): SavedEnrollment {
        val begun = synchronized(enrollmentLock) {
            val current = store.read()
            val id = identity.deviceId()
            val fingerprint = identity.fingerprint()
            check(id !in inFlight) { "Enrollment is already in progress" }
            val next = if (recovery == null) {
                check(current == null) { "Do not repeat an uncertain request without owner confirmation" }
                SavedEnrollment(link.endpoint.origin, "requesting", id, fingerprint)
            } else {
                check(current == recovery && recovery.phase != "approved" &&
                    recovery.origin == link.endpoint.origin && recovery.deviceId == id &&
                    recovery.fingerprint == fingerprint) { "Recovery state or identity changed" }
                check(recovery.previousRequestIds.size < 32) { "Request history needs operator review" }
                recovery.copy(phase = "requesting")
            }
            store.write(next)
            inFlight.add(id)
            next
        }
        try {
            // Keep requesting and any old receipt on a lost reply. Never resend automatically.
            val receipt = DeviceEnrollment(identity, exchange(link.endpoint)).request(link.inviteCode)
            return synchronized(enrollmentLock) {
                check(store.read() == begun && begun.deviceId == receipt.deviceId &&
                    begun.fingerprint == receipt.fingerprint) { "Enrollment identity or state changed" }
                val previous = (begun.previousRequestIds + listOfNotNull(begun.requestId))
                    .distinct().filter { it != receipt.requestId }
                begun.copy(phase = receipt.status, requestId = receipt.requestId,
                    previousRequestIds = previous).also { store.write(it) }
            }
        } finally {
            synchronized(enrollmentLock) { inFlight.remove(begun.deviceId) }
        }
    }

    /** The caller must first complete a fresh signed discovery for this exact snapshot. */
    fun recordApprovalAfterSignedCheck(expected: SavedEnrollment): SavedEnrollment =
        synchronized(enrollmentLock) {
            check(expected.deviceId !in inFlight && store.read() == expected) { "Enrollment state changed" }
            expected.copy(phase = "approved").also { store.write(it) }
        }
}
