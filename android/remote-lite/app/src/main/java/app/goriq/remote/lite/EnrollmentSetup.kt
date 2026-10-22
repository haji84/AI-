package app.goriq.remote.lite

data class SavedEnrollment(val origin: String, val phase: String, val deviceId: String,
    val fingerprint: String, val requestId: String? = null)

interface EnrollmentStateStore {
    fun read(): SavedEnrollment?
    fun write(value: SavedEnrollment)
}

class EnrollmentSetup(private val identity: EnrollmentIdentity,
    private val store: EnrollmentStateStore,
    private val exchange: (RemoteEndpoint) -> EnrollmentExchange) {
    companion object { private val enrollmentLock = Any() }

    fun submit(link: EnrollmentLink): SavedEnrollment {
        val begun = synchronized(enrollmentLock) {
            check(store.read() == null) { "An enrollment already exists; do not repeat an uncertain request" }
            SavedEnrollment(link.endpoint.origin, "requesting", identity.deviceId(),
                identity.fingerprint()).also { store.write(it) }
        }
        // Keep requesting on a lost reply: automatic resend could consume another invite.
        val receipt = DeviceEnrollment(identity, exchange(link.endpoint)).request(link.inviteCode)
        return synchronized(enrollmentLock) {
            val current = checkNotNull(store.read()) { "Enrollment state disappeared" }
            check(current.origin == begun.origin && current.deviceId == receipt.deviceId &&
                current.fingerprint == receipt.fingerprint) { "Enrollment identity changed" }
            current.copy(phase = if (current.phase == "approved") "approved" else receipt.status,
                requestId = receipt.requestId).also { store.write(it) }
        }
    }
}
