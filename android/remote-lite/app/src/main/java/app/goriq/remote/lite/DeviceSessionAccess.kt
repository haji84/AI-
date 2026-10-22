package app.goriq.remote.lite

import java.security.SecureRandom

data class DiscoveryProof(val deviceId: String, val issuedAt: Long, val nonce: String,
    val signature: String)
data class DeviceSessionProof(val deviceId: String, val operation: String,
    val sessionId: String, val challengeId: String, val payloadHash: String,
    val signature: String)
data class DeviceSessionChallenge(val challengeId: String, val challenge: String,
    val expiresAt: Long)
data class DeviceSessionView(val sessionId: String, val deviceId: String,
    val status: String, val expiresAt: Long)
data class DeviceSessionCheck(val allowed: Boolean, val reason: String)
data class DeviceSessionClosed(val sessionId: String, val status: String)

interface DeviceSessionExchange {
    fun pending(id: String, proof: DiscoveryProof): DeviceSessionView?
    fun active(id: String, proof: DiscoveryProof): DeviceSessionView?
    fun challenge(id: String, operation: String, session: String): DeviceSessionChallenge
    fun accept(session: String, id: String, proof: DeviceSessionProof): DeviceSessionView
    fun status(session: String, id: String, proof: DeviceSessionProof): DeviceSessionView
    fun ice(session: String, id: String, proof: DeviceSessionProof): DeviceSessionIce = error("Session ICE unsupported")
    fun end(session: String, id: String, proof: DeviceSessionProof): DeviceSessionClosed = error("Session end unsupported")
}

/** A local key proves each request to the separate coordinator; it is never a viewer token. */
class DeviceSessionAccess(private val identity: EnrollmentIdentity,
    private val exchange: DeviceSessionExchange,
    private val issuedAtMs: () -> Long = System::currentTimeMillis,
    private val nonceHex: () -> String = {
        ByteArray(24).also { SecureRandom().nextBytes(it) }
            .joinToString("") { (it.toInt() and 0xff).toString(16).padStart(2, '0') }
    },
    private val elapsedMs: () -> Long = { System.nanoTime() / 1_000_000 },
    private val failureDiagnostic: (String) -> Unit = {}) {

    private fun discoveryProof(): DiscoveryProof {
        val id = identity.deviceId()
        val issuedAt = issuedAtMs()
        val nonce = nonceHex()
        val signature = identity.sign(DeviceProofMessage.discovery(id, issuedAt, nonce))
        return DiscoveryProof(id, issuedAt, nonce, signature)
    }

    fun discoverPending(): DeviceSessionView? {
        val proof = discoveryProof()
        val view = exchange.pending(proof.deviceId, proof)
        if (view != null) requireView(view, proof.deviceId, view.sessionId, "pending")
        return view
    }

    /** Reconnect after process death only while the coordinator still accepts this key. */
    fun discoverActive(): DeviceSessionView? {
        val proof = discoveryProof()
        val view = exchange.active(proof.deviceId, proof)
        if (view != null) requireView(view, proof.deviceId, view.sessionId, "active")
        return view
    }

    fun accept(pending: DeviceSessionView): DeviceSessionView {
        val id = identity.deviceId()
        requireView(pending, id, pending.sessionId, "pending")
        val view = exchange.accept(pending.sessionId, id,
            proof(id, pending.sessionId, "session-accept"))
        requireView(view, id, pending.sessionId, "active")
        return view
    }

    /** A failed lookup, signature, network request or mismatched reply denies the operation. */
    fun verifyActive(sessionId: String): DeviceSessionCheck = try {
        val id = identity.deviceId()
        val view = exchange.status(sessionId, id, proof(id, sessionId, "session-status"))
        requireView(view, id, sessionId, "active")
        DeviceSessionCheck(true, "active")
    } catch (failure: Exception) {
        // Fixed categories only: never expose a transport exception message,
        // server-supplied free text, device identity, token or signed payload.
        val reason = when (failure) {
            is CoordinatorRefusal -> "coordinator:" + if (failure.code in setOf(
                "DEVICE_NOT_FOUND", "DEVICE_REVOKED", "DEVICE_UNAVAILABLE", "DEVICE_NOT_AUTHORIZED",
                "DEVICE_PROOF_INVALID", "SIGNATURE_INVALID", "CHALLENGE_NOT_FOUND_OR_MISMATCH",
                "CHALLENGE_CAPACITY_REACHED", "CHALLENGE_DEVICE_CAPACITY_REACHED",
                "CHALLENGE_OWNER_CAPACITY_REACHED", "SESSION_NOT_ACTIVE", "SESSION_NOT_FOUND_OR_EXPIRED",
                "RATE_LIMITED", "REGISTRY_STORAGE_UNAVAILABLE", "HTTPS_OR_HOST_REQUIRED",
            )) failure.code else "OTHER"
            is java.net.SocketTimeoutException -> "transport:timeout"
            is javax.net.ssl.SSLException -> "transport:tls"
            is java.io.IOException -> "transport:io"
            else -> "response-or-proof-invalid"
        }
        runCatching { failureDiagnostic(reason) }
        DeviceSessionCheck(false, "session-not-active")
    }

    fun <T> requireActiveThen(sessionId: String, operation: () -> T): T {
        check(verifyActive(sessionId).allowed) { "Remote session is not active" }
        return operation()
    }

    fun ice(sessionId: String): DeviceSessionIce {
        val id = identity.deviceId()
        return exchange.ice(sessionId, id, proof(id, sessionId, "session-ice"))
            .validated(sessionId, id, issuedAtMs())
    }

    fun end(sessionId: String): Boolean = try {
        val id = identity.deviceId()
        val receipt = exchange.end(sessionId, id, proof(id, sessionId, "session-end"))
        receipt.sessionId == sessionId && receipt.status == "closed"
    } catch (_: Exception) { false }

    private fun proof(id: String, sessionId: String, operation: String): DeviceSessionProof {
        val started = elapsedMs()
        val challenge = exchange.challenge(id, operation, sessionId)
        require(challenge.expiresAt in 1..9_007_199_254_740_991L) { "Invalid challenge expiry" }
        require(elapsedMs() - started in 0L until 60_000L) { "Challenge took too long" }
        val message = DeviceProofMessage.session(id, operation, sessionId,
            challenge.challengeId, challenge.challenge)
        val signature = identity.sign(message)
        require(elapsedMs() - started in 0L until 60_000L) { "Proof took too long" }
        return DeviceSessionProof(id, operation, sessionId, challenge.challengeId, "", signature)
    }

    private fun requireView(view: DeviceSessionView, id: String, session: String, status: String) {
        require(view.deviceId == id && view.sessionId == session && view.status == status &&
            view.expiresAt in 1..9_007_199_254_740_991L) {
            "Coordinator session response mismatch"
        }
    }
}
