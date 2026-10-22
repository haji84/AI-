package app.goriq.remote.lite

/** The Android key stays in AndroidKeyStore; the exchange receives only its public half. */
interface EnrollmentIdentity {
    fun deviceId(): String
    fun publicKeyPem(): String
    fun fingerprint(): String
    fun sign(message: String): String
}

data class EnrollmentChallenge(val requestId: String, val challenge: String,
    val fingerprint: String, val expiresAt: Long)

data class EnrollmentReceipt(val requestId: String, val deviceId: String,
    val fingerprint: String, val status: String)

/** Transport must validate TLS and bound responses; this class grants no session authority. */
interface EnrollmentExchange {
    fun propose(code: String, deviceId: String, publicKeyPem: String): EnrollmentChallenge
    fun prove(requestId: String, signature: String): EnrollmentReceipt
}

class DeviceEnrollment(private val identity: EnrollmentIdentity,
    private val exchange: EnrollmentExchange, private val now: () -> Long = System::currentTimeMillis) {
    fun request(inviteCode: String): EnrollmentReceipt {
        require(Regex("[0-9a-f]{48}").matches(inviteCode)) { "Invalid invite code" }
        val deviceId = identity.deviceId()
        val fingerprint = identity.fingerprint()
        val challenge = exchange.propose(inviteCode, deviceId, identity.publicKeyPem())
        require(challenge.fingerprint == fingerprint) { "Coordinator key fingerprint mismatch" }
        val currentTime = now()
        require(challenge.expiresAt > currentTime && challenge.expiresAt - currentTime <= 60_000) {
            "Enrollment challenge expired or too long"
        }
        val message = DeviceProofMessage.enrollment(challenge.requestId, deviceId,
            fingerprint, challenge.challenge)
        val receipt = exchange.prove(challenge.requestId, identity.sign(message))
        require(receipt.requestId == challenge.requestId && receipt.deviceId == deviceId &&
            receipt.fingerprint == fingerprint && receipt.status == "awaiting-owner-approval") {
            "Enrollment response is not awaiting owner approval"
        }
        return receipt
    }
}
