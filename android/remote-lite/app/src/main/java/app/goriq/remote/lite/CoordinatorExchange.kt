package app.goriq.remote.lite

import org.json.JSONObject

class CoordinatorRefusal(val code: String) : IllegalStateException("Coordinator refused request")

/** The same JSON contract is used by normal setup and the Android VM diagnostics. */
class CoordinatorExchange(private val transport: HttpsJsonTransport) :
    EnrollmentExchange, DeviceSessionExchange {
    private fun post(path: String, payload: JSONObject): JSONObject? {
        val reply = transport.post(path, payload.toString())
        val response = JSONObject(reply.body)
        if (reply.status != 200 || !response.getBoolean("ok")) {
            val code = response.optString("code").takeIf { Regex("[A-Z_]{1,64}").matches(it) }
                ?: "REQUEST_REFUSED"
            throw CoordinatorRefusal(code)
        }
        check(response.has("result")) { "Missing coordinator result" }
        if (response.isNull("result")) return null
        return response.getJSONObject("result")
    }

    override fun propose(code: String, deviceId: String, publicKeyPem: String): EnrollmentChallenge {
        val result = post("/v1/device/propose", JSONObject().put("inviteCode", code)
            .put("deviceId", deviceId).put("publicKeyPem", publicKeyPem)) ?: error("Missing proposal")
        return EnrollmentChallenge(result.getString("requestId"), result.getString("challenge"),
            result.getString("fingerprint"), result.getLong("expiresAt"))
    }

    override fun prove(requestId: String, signature: String): EnrollmentReceipt {
        val result = post("/v1/device/prove", JSONObject().put("requestId", requestId)
            .put("signature", signature)) ?: error("Missing receipt")
        return EnrollmentReceipt(result.getString("requestId"), result.getString("deviceId"),
            result.getString("fingerprint"), result.getString("status"))
    }

    private fun discovery(path: String, id: String, proof: DiscoveryProof): DeviceSessionView? =
        post(path, JSONObject().put("deviceId", id).put("proof", JSONObject()
            .put("deviceId", proof.deviceId).put("issuedAt", proof.issuedAt)
            .put("nonce", proof.nonce).put("signature", proof.signature)))?.let(::view)

    override fun pending(id: String, proof: DiscoveryProof) = discovery("/v1/device/pending", id, proof)
    override fun active(id: String, proof: DiscoveryProof) = discovery("/v1/device/active", id, proof)

    override fun challenge(id: String, operation: String, session: String): DeviceSessionChallenge {
        val result = post("/v1/device/challenge", JSONObject().put("deviceId", id)
            .put("operation", operation).put("sessionId", session)) ?: error("Missing challenge")
        return DeviceSessionChallenge(result.getString("challengeId"), result.getString("challenge"),
            result.getLong("expiresAt"))
    }

    override fun accept(session: String, id: String, proof: DeviceSessionProof) =
        sessionPost("/v1/device/accept", session, id, proof)
    override fun status(session: String, id: String, proof: DeviceSessionProof) =
        sessionPost("/v1/device/status", session, id, proof)

    private fun sessionPost(path: String, session: String, id: String, proof: DeviceSessionProof) =
        view(post(path, JSONObject().put("sessionId", session).put("deviceId", id)
            .put("proof", JSONObject().put("deviceId", proof.deviceId).put("operation", proof.operation)
                .put("sessionId", proof.sessionId).put("challengeId", proof.challengeId)
                .put("payloadHash", proof.payloadHash).put("signature", proof.signature)))
            ?: error("Missing session"))

    private fun view(result: JSONObject) = DeviceSessionView(result.getString("sessionId"),
        result.getString("deviceId"), result.getString("status"), result.getLong("expiresAt"))
}
