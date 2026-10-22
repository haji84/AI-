package app.goriq.remote.lite

/** Exact UTF-8 messages accepted by the separate Remote Lite pairing authority. */
object DeviceProofMessage {
    private val idPattern = Regex("[A-Za-z0-9._:-]{1,128}")
    private val requestPattern = Regex("[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")
    private val noncePattern = Regex("[0-9a-f]{48}")
    private val fingerprintPattern = Regex("[0-9a-f]{64}")
    private val operations = setOf("session-accept", "session-status", "signal-send",
        "signal-receive", "session-end", "reconnect")

    private fun id(value: String): String {
        require(idPattern.matches(value)) { "Invalid device or session ID" }
        return value
    }

    private fun request(value: String): String {
        require(requestPattern.matches(value)) { "Invalid request or challenge ID" }
        return value
    }

    private fun checkedNonce(value: String): String {
        require(noncePattern.matches(value)) { "Invalid nonce" }
        return value
    }

    fun enrollment(requestId: String, deviceId: String, fingerprint: String,
        challenge: String): String {
        require(fingerprintPattern.matches(fingerprint)) { "Invalid key fingerprint" }
        return listOf("GORIQ_REMOTE_DEVICE_ENROLL_V1", request(requestId), id(deviceId),
            fingerprint, checkedNonce(challenge)).joinToString("\n")
    }

    fun session(deviceId: String, operation: String, sessionId: String, challengeId: String,
        challenge: String, payloadHash: String = ""): String {
        require(operation in operations) { "Unsupported device operation" }
        require(if (operation == "signal-send") fingerprintPattern.matches(payloadHash)
            else payloadHash.isEmpty()) { "Invalid signal binding" }
        return listOf("GORIQ_REMOTE_DEVICE_AUTH_V1", id(deviceId), operation, id(sessionId),
            request(challengeId), checkedNonce(challenge), payloadHash).joinToString("\n")
    }

    fun discovery(deviceId: String, issuedAt: Long, nonce: String): String {
        require(issuedAt in 1..9_007_199_254_740_991L) { "Invalid discovery time" }
        return listOf("GORIQ_REMOTE_DEVICE_DISCOVER_V1", id(deviceId), issuedAt.toString(),
            checkedNonce(nonce)).joinToString("\n")
    }
}
