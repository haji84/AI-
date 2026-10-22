package app.goriq.remote.lite

import org.json.JSONObject

class CoordinatorRefusal(val code: String) : IllegalStateException("Coordinator refused request")

/** The same JSON contract is used by normal setup and the Android VM diagnostics. */
class CoordinatorExchange(private val transport: HttpsJsonTransport) :
    EnrollmentExchange, DeviceSessionExchange, DeviceSignalExchange {
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
    override fun end(session: String, id: String, proof: DeviceSessionProof): DeviceSessionClosed {
        val result = post("/v1/device/end", JSONObject().put("sessionId", session).put("deviceId", id)
            .put("proof", proofJson(proof))) ?: error("Missing session closure")
        return DeviceSessionClosed(result.getString("sessionId"), result.getString("status"))
    }

    override fun signalChallenge(id: String, session: String, operation: String, payloadHash: String): DeviceSessionChallenge {
        val result = post("/v1/device/challenge", JSONObject().put("deviceId", id)
            .put("operation", operation).put("sessionId", session).put("payloadHash", payloadHash))
            ?: error("Missing signaling challenge")
        return DeviceSessionChallenge(result.getString("challengeId"), result.getString("challenge"),
            result.getLong("expiresAt"))
    }

    override fun sendSignal(id: String, session: String, proof: DeviceSessionProof, signal: RtcSignal): SignalQueued {
        val result = post("/v1/device/signal", JSONObject().put("sessionId", session).put("deviceId", id)
            .put("proof", proofJson(proof)).put("signal", JSONObject(signal.canonicalJson())))
            ?: error("Missing signaling receipt")
        return SignalQueued(result.get("sessionId") as? String ?: error("Invalid session ID"),
            result.get("queued") as? Boolean ?: error("Invalid queued status"))
    }

    override fun receiveSignals(id: String, session: String, proof: DeviceSessionProof, ack: Long): SignalBatch {
        val result = post("/v1/device/poll", JSONObject().put("sessionId", session).put("deviceId", id)
            .put("proof", proofJson(proof)).put("ack", ack)) ?: error("Missing signaling batch")
        val array = result.getJSONArray("signals")
        require(array.length() <= 1) { "Signaling batch too large" }
        return SignalBatch(integer(result.get("cursor"), 9_007_199_254_740_991L),
            (0 until array.length()).map { parseSignal(array.getJSONObject(it)) })
    }

    private fun integer(value: Any, maximum: Long): Long {
        require(value is Number && value.toDouble().isFinite() &&
            value.toDouble() == value.toLong().toDouble() && value.toLong() in 0..maximum) {
            "Invalid signaling integer"
        }
        return value.toLong()
    }

    private fun parseSignal(value: JSONObject): RtcSignal {
        val keys = value.keys().asSequence().toSet()
        val type = value.get("type") as? String ?: error("Invalid signaling type")
        val signal = when (type) {
            "offer", "answer" -> {
                require(keys == setOf("type", "sdp")) { "Invalid SDP fields" }
                RtcSignal.Sdp(type, value.get("sdp") as? String ?: error("Invalid SDP"))
            }
            "candidate" -> {
                require(keys == setOf("type", "candidate", "sdpMid", "sdpMLineIndex")) { "Invalid ICE fields" }
                val mid = if (value.isNull("sdpMid")) null else
                    value.get("sdpMid") as? String ?: error("Invalid ICE mid")
                val index = if (value.isNull("sdpMLineIndex")) null else
                    integer(value.get("sdpMLineIndex"), 100).toInt()
                RtcSignal.Candidate(value.get("candidate") as? String ?: error("Invalid ICE candidate"), mid, index)
            }
            else -> error("Unsupported signaling type")
        }
        signal.canonicalJson()
        return signal
    }

    private fun proofJson(proof: DeviceSessionProof) = JSONObject()
        .put("deviceId", proof.deviceId).put("operation", proof.operation)
        .put("sessionId", proof.sessionId).put("challengeId", proof.challengeId)
        .put("payloadHash", proof.payloadHash).put("signature", proof.signature)

    private fun sessionPost(path: String, session: String, id: String, proof: DeviceSessionProof) =
        view(post(path, JSONObject().put("sessionId", session).put("deviceId", id)
            .put("proof", proofJson(proof)))
            ?: error("Missing session"))

    private fun view(result: JSONObject) = DeviceSessionView(result.getString("sessionId"),
        result.getString("deviceId"), result.getString("status"), result.getLong("expiresAt"))
}
