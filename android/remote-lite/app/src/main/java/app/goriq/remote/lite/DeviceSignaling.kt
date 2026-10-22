package app.goriq.remote.lite

import java.security.MessageDigest

sealed class RtcSignal {
    data class Sdp(val type: String, val sdp: String) : RtcSignal()
    data class Candidate(val candidate: String, val sdpMid: String?, val sdpMLineIndex: Int?) : RtcSignal()
    /** Field order and string escaping match JSON.stringify(parseWebRtcSignal(...)). */
    fun canonicalJson(): String = when (this) {
        is Sdp -> {
            require(type in setOf("offer", "answer") && sdp.length in 1..65_536 && sdp.startsWith("v=0")) {
                "Invalid SDP"
            }
            "{\"type\":" + quote(type) + ",\"sdp\":" + quote(sdp) + "}"
        }
        is Candidate -> {
            require(candidate.length in 1..4096 && (sdpMid == null || sdpMid.length <= 64) &&
                (sdpMLineIndex == null || sdpMLineIndex in 0..100)) { "Invalid ICE candidate" }
            "{\"type\":\"candidate\",\"candidate\":" + quote(candidate) + ",\"sdpMid\":" +
                (sdpMid?.let { quote(it) } ?: "null") + ",\"sdpMLineIndex\":" + sdpMLineIndex + "}"
        }
    }

    private fun quote(value: String): String = buildString {
        append('"')
        var index = 0
        while (index < value.length) {
            val char = value[index++]
            when (char) {
                '"' -> append("\\\"")
                '\\' -> append("\\\\")
                '\b' -> append("\\b")
                '\t' -> append("\\t")
                '\n' -> append("\\n")
                '\u000c' -> append("\\f")
                '\r' -> append("\\r")
                else -> when {
                    char.code < 32 -> append("\\u" + char.code.toString(16).padStart(4, '0'))
                    char.isHighSurrogate() && index < value.length && value[index].isLowSurrogate() -> {
                        append(char)
                        append(value[index++])
                    }
                    char.isSurrogate() -> append("\\u" + char.code.toString(16).padStart(4, '0'))
                    else -> append(char)
                }
            }
        }
        append('"')
    }
}

data class SignalBatch(val cursor: Long, val signals: List<RtcSignal>)
data class SignalQueued(val sessionId: String, val queued: Boolean)

interface DeviceSignalExchange {
    fun signalChallenge(id: String, session: String, operation: String, payloadHash: String): DeviceSessionChallenge
    fun sendSignal(id: String, session: String, proof: DeviceSessionProof, signal: RtcSignal): SignalQueued
    fun receiveSignals(id: String, session: String, proof: DeviceSessionProof, ack: Long): SignalBatch
}

interface SignalCursorStore {
    fun read(session: String): Long
    fun write(session: String, cursor: Long)
}

class DeviceSignaling(private val identity: EnrollmentIdentity, private val exchange: DeviceSignalExchange,
    private val session: String, private val cursorStore: SignalCursorStore,
    private val elapsedMs: () -> Long = { System.nanoTime() / 1_000_000 }) {
    private val id = identity.deviceId()
    private var acknowledged = cursorStore.read(session)
    private var pendingCursor: Long? = null

    init {
        require(Regex("[A-Za-z0-9._:-]{1,128}").matches(session) &&
            Regex("[A-Za-z0-9._:-]{1,128}").matches(id)) { "Invalid signaling identity" }
        require(acknowledged in 0..9_007_199_254_740_991L) { "Invalid saved signaling cursor" }
    }

    @Synchronized fun send(signal: RtcSignal) {
        val json = signal.canonicalJson()
        val hash = MessageDigest.getInstance("SHA-256").digest(json.toByteArray(Charsets.UTF_8))
            .joinToString("") { (it.toInt() and 0xff).toString(16).padStart(2, '0') }
        val result = exchange.sendSignal(id, session, proof("signal-send", hash), signal)
        require(result.queued && result.sessionId == session) { "Signaling delivery was not confirmed" }
    }

    @Synchronized fun receive(): SignalBatch {
        val batch = exchange.receiveSignals(id, session, proof("signal-receive"), acknowledged)
        require(batch.cursor in acknowledged..(acknowledged + 1) && batch.signals.size <= 1 &&
            (batch.signals.size == 1) == (batch.cursor == acknowledged + 1)) { "Invalid signaling batch" }
        batch.signals.forEach { it.canonicalJson() }
        pendingCursor = batch.cursor
        return batch
    }

    /** Invoke only after the native peer has successfully applied this batch. */
    @Synchronized fun acknowledge(cursor: Long) {
        require(pendingCursor == cursor) { "Cannot acknowledge an unapplied signaling batch" }
        cursorStore.write(session, cursor)
        acknowledged = cursor
        pendingCursor = null
    }

    private fun proof(operation: String, payloadHash: String = ""): DeviceSessionProof {
        check(identity.deviceId() == id) { "Device identity changed" }
        val started = elapsedMs()
        val challenge = exchange.signalChallenge(id, session, operation, payloadHash)
        require(challenge.expiresAt in 1..9_007_199_254_740_991L &&
            elapsedMs() - started in 0L until 60_000L) { "Signaling challenge expired" }
        val message = DeviceProofMessage.session(id, operation, session, challenge.challengeId,
            challenge.challenge, payloadHash)
        val signature = identity.sign(message)
        require(elapsedMs() - started in 0L until 60_000L) { "Signaling proof expired" }
        return DeviceSessionProof(id, operation, session, challenge.challengeId, payloadHash, signature)
    }
}
