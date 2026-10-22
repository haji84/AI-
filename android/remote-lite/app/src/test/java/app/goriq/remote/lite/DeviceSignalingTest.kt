package app.goriq.remote.lite

import org.junit.Assert.*
import org.junit.Test

class DeviceSignalingTest {
    private val session = "123e4567-e89b-42d3-a456-426614174001"
    private val challengeId = "123e4567-e89b-42d3-a456-426614174002"
    private val candidate = RtcSignal.Candidate("candidate:1 1 UDP 1 127.0.0.1 5000 typ host", "0", 0)
    private val messages = mutableListOf<String>()
    private val cursors = object : SignalCursorStore {
        val saved = mutableMapOf<String, Long>()
        override fun read(session: String) = saved[session] ?: 0L
        override fun write(session: String, cursor: Long) { saved[session] = cursor }
    }
    private val identity = object : EnrollmentIdentity {
        override fun deviceId() = "device-one"
        override fun publicKeyPem() = "not used"
        override fun fingerprint() = "b".repeat(64)
        override fun sign(message: String): String { messages.add(message); return "signed" }
    }
    private open inner class Exchange : DeviceSignalExchange {
        val acknowledgements = mutableListOf<Long>()
        override fun signalChallenge(id: String, session: String, operation: String, payloadHash: String) =
            DeviceSessionChallenge(challengeId, "a".repeat(48), 1_900_000_000_000)
        override fun sendSignal(id: String, session: String, proof: DeviceSessionProof, signal: RtcSignal) =
            SignalQueued(session, true)
        override fun receiveSignals(id: String, session: String, proof: DeviceSessionProof, ack: Long): SignalBatch {
            acknowledgements.add(ack)
            return SignalBatch(ack + 1, listOf(candidate))
        }
    }

    @Test fun canonicalJsonMatchesTheNodeCoordinatorIncludingEscapesAndNulls() {
        assertEquals("""{"type":"offer","sdp":"v=0\r\ns=\"screen/one\"\n"}""",
            RtcSignal.Sdp("offer", "v=0\r\ns=\"screen/one\"\n").canonicalJson())
        assertEquals("""{"type":"candidate","candidate":"candidate:x","sdpMid":null,"sdpMLineIndex":null}""",
            RtcSignal.Candidate("candidate:x", null, null).canonicalJson())
        assertEquals("""{"type":"answer","sdp":"v=0\u0000\ud800"}""",
            RtcSignal.Sdp("answer", "v=0" + 0.toChar() + 0xd800.toChar()).canonicalJson())
    }

    @Test fun malformedOrOversizedSignalsAreRejected() {
        for (type in listOf("candidate", "rollback", "OFFER")) {
            assertThrows(IllegalArgumentException::class.java) { RtcSignal.Sdp(type, "v=0").canonicalJson() }
        }
        assertThrows(IllegalArgumentException::class.java) { RtcSignal.Sdp("offer", "not SDP").canonicalJson() }
        assertThrows(IllegalArgumentException::class.java) { RtcSignal.Sdp("offer", "v=0" + "x".repeat(65_536)).canonicalJson() }
        assertThrows(IllegalArgumentException::class.java) { RtcSignal.Candidate("", "0", 0).canonicalJson() }
        assertThrows(IllegalArgumentException::class.java) { RtcSignal.Candidate("x", "0", 101).canonicalJson() }
        assertThrows(IllegalArgumentException::class.java) { RtcSignal.Candidate("x", "x".repeat(65), 0).canonicalJson() }
    }

    @Test fun outgoingPayloadHashIsTheExactNodeSha256AndBoundIntoTheProof() {
        val hash = "3876dcbb0fe887d3af1b338d7fb928f0e1ee183a765f2f780630b23c20204643"
        val exchange = object : Exchange() {
            override fun signalChallenge(id: String, session: String, operation: String, payloadHash: String): DeviceSessionChallenge {
                assertEquals("signal-send", operation)
                assertEquals(hash, payloadHash)
                return super.signalChallenge(id, session, operation, payloadHash)
            }
            override fun sendSignal(id: String, session: String, proof: DeviceSessionProof, signal: RtcSignal): SignalQueued {
                assertEquals(hash, proof.payloadHash)
                assertEquals("signal-send", proof.operation)
                assertEquals(candidate, signal)
                return super.sendSignal(id, session, proof, signal)
            }
        }
        DeviceSignaling(identity, exchange, session, cursors).send(candidate)
        assertEquals("GORIQ_REMOTE_DEVICE_AUTH_V1\ndevice-one\nsignal-send\n$session\n$challengeId\n${"a".repeat(48)}\n$hash", messages.single())
    }

    @Test fun aForeignOrUnqueuedReceiptCannotBeReportedAsDelivered() {
        for (receipt in listOf(SignalQueued("another-session", true), SignalQueued(session, false))) {
            val exchange = object : Exchange() {
                override fun sendSignal(id: String, session: String, proof: DeviceSessionProof, signal: RtcSignal) = receipt
            }
            assertThrows(IllegalArgumentException::class.java) { DeviceSignaling(identity, exchange, session, cursors).send(candidate) }
        }
    }

    @Test fun pollingDoesNotAcknowledgeUntilThePeerHasAppliedTheSignal() {
        val exchange = Exchange()
        val signaling = DeviceSignaling(identity, exchange, session, cursors)
        val first = signaling.receive()
        assertEquals(listOf(candidate), first.signals)
        signaling.receive()
        assertEquals(listOf(0L, 0L), exchange.acknowledgements)
        signaling.acknowledge(first.cursor)
        signaling.receive()
        assertEquals(listOf(0L, 0L, 1L), exchange.acknowledgements)
        assertEquals(3, messages.size)
        assertTrue(messages.all { it.endsWith("\n") && it.contains("\nsignal-receive\n") })
    }

    @Test fun invalidCursorOrBatchAndUnreceivedAcknowledgementAreRefused() {
        for (batch in listOf(SignalBatch(-1, emptyList()), SignalBatch(2, listOf(candidate)),
            SignalBatch(1, emptyList()), SignalBatch(0, listOf(candidate)), SignalBatch(1, listOf(candidate, candidate)))) {
            val exchange = object : Exchange() {
                override fun receiveSignals(id: String, session: String, proof: DeviceSessionProof, ack: Long) = batch
            }
            assertThrows(IllegalArgumentException::class.java) { DeviceSignaling(identity, exchange, session, cursors).receive() }
        }
        assertThrows(IllegalArgumentException::class.java) { DeviceSignaling(identity, Exchange(), session, cursors).acknowledge(1) }
    }

    @Test fun aDelayedChallengeCannotSendASignal() {
        var elapsed = 0L
        val exchange = object : Exchange() {
            override fun signalChallenge(id: String, session: String, operation: String, payloadHash: String): DeviceSessionChallenge {
                elapsed = 60_000
                return super.signalChallenge(id, session, operation, payloadHash)
            }
            override fun sendSignal(id: String, session: String, proof: DeviceSessionProof, signal: RtcSignal): SignalQueued =
                error("Must not send after the local proof deadline")
        }
        assertThrows(IllegalArgumentException::class.java) {
            DeviceSignaling(identity, exchange, session, cursors, { elapsed }).send(candidate)
        }
        assertTrue(messages.isEmpty())
    }

    @Test fun aNewSignalingInstanceRestoresTheLastAppliedCursorWithoutSkippingANewSignal() {
        val first = DeviceSignaling(identity, Exchange(), session, cursors)
        val batch = first.receive()
        first.acknowledge(batch.cursor)
        val exchange = object : Exchange() {
            override fun receiveSignals(id: String, session: String, proof: DeviceSessionProof, ack: Long): SignalBatch {
                assertEquals(1L, ack)
                return SignalBatch(1, emptyList())
            }
        }
        assertEquals(SignalBatch(1, emptyList()), DeviceSignaling(identity, exchange, session, cursors).receive())
        assertEquals(0L, cursors.read("another-session"))
    }

    @Test fun failedCursorPersistenceCannotAcknowledgeOrSkipAnUnstoredSignal() {
        val failingStore = object : SignalCursorStore {
            override fun read(session: String) = 0L
            override fun write(session: String, cursor: Long) { error("disk full") }
        }
        val exchange = Exchange()
        val signaling = DeviceSignaling(identity, exchange, session, failingStore)
        val batch = signaling.receive()
        assertThrows(IllegalStateException::class.java) { signaling.acknowledge(batch.cursor) }
        signaling.receive()
        assertEquals(listOf(0L, 0L), exchange.acknowledgements)
    }
}
