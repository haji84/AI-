package app.goriq.remote.lite

import android.content.Context
import android.content.Intent
import android.app.KeyguardManager
import android.os.PowerManager
import android.media.projection.MediaProjection
import android.os.SystemClock
import org.json.JSONObject
import org.webrtc.*
import java.nio.ByteBuffer
import java.nio.charset.CodingErrorAction
import java.util.ArrayDeque
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.CompletableFuture
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong

/** Native answerer. Its caller owns OS consent, signed signaling, status and foreground lifecycle. */
class NativeRtcPeer(private val context: Context, private val lease: CaptureLease,
    private val sendSignal: (RtcSignal) -> Unit,
    private val applyInput: (ManualAction, Long) -> Boolean,
    private val onState: (String) -> Unit, private val requestStop: (String) -> Unit) {
    private val closed = AtomicBoolean()
    @Volatile private var cleanupConfirmed = true
    private var egl: EglBase? = null
    private var factory: PeerConnectionFactory? = null
    private var pc: PeerConnection? = null
    private var source: VideoSource? = null
    private var track: VideoTrack? = null
    private var texture: SurfaceTextureHelper? = null
    private var capture: ScreenCapturerAndroid? = null
    @Volatile private var channel: DataChannel? = null
    private var receivedOffer = false
    private var remoteSet = false
    private val candidates = ArrayList<RtcSignal.Candidate>()
    private val frames = AtomicLong()
    private var receivedSequence = 0L
    private val inputTimes = ArrayDeque<Long>()
    private val inputLock = Any()
    private val channelLock = Any()
    private val inputs = ThreadPoolExecutor(1, 1, 0, TimeUnit.MILLISECONDS, ArrayBlockingQueue(16))

    @Synchronized fun start(projectionData: Intent, width: Int, height: Int,
        iceServers: List<PeerConnection.IceServer> = emptyList(), relayOnly: Boolean = false) {
        check(!closed.get() && pc == null && lease.allowed()) { "No current media authorization" }
        require(width > 1 && height > 1 && iceServers.size <= 8)
        try {
            PeerConnectionFactory.initialize(PeerConnectionFactory.InitializationOptions
                .builder(context.applicationContext).setEnableInternalTracer(false).createInitializationOptions())
            Logging.enableLogToDebugOutput(Logging.Severity.LS_NONE)
            val gl = EglBase.create().also { egl = it }
            val peerFactory = PeerConnectionFactory.builder()
                .setVideoEncoderFactory(DefaultVideoEncoderFactory(gl.eglBaseContext, true, true))
                .setVideoDecoderFactory(DefaultVideoDecoderFactory(gl.eglBaseContext))
                .createPeerConnectionFactory().also { factory = it }
            val videoSource = peerFactory.createVideoSource(true).also { source = it }
            val scale = minOf(1.0, 720.0 / maxOf(width, height))
            videoSource.adaptOutputFormat((width * scale).toInt(), (height * scale).toInt(), 15)
            val videoTrack = peerFactory.createVideoTrack("remote-lite-screen", videoSource).also { track = it }
            val config = PeerConnection.RTCConfiguration(iceServers).apply {
                bundlePolicy = PeerConnection.BundlePolicy.MAXBUNDLE
                sdpSemantics = PeerConnection.SdpSemantics.UNIFIED_PLAN
                if (relayOnly) iceTransportsType = PeerConnection.IceTransportsType.RELAY
            }
            val connection = checkNotNull(peerFactory.createPeerConnection(config, observer)).also { pc = it }
            checkNotNull(connection.addTrack(videoTrack, listOf("remote-lite-screen")))
            val helper = checkNotNull(SurfaceTextureHelper.create("remote-lite-screen", gl.eglBaseContext))
                .also { texture = it }
            val capturer = ScreenCapturerAndroid(projectionData, object : MediaProjection.Callback() {
                override fun onStop() { fail("screen-permission-ended") }
                override fun onCapturedContentResize(newWidth: Int, newHeight: Int) {
                    if (newWidth != width || newHeight != height) fail("display-changed")
                }
            }).also { capture = it }
            val delegate = videoSource.capturerObserver
            capturer.initialize(helper, context.applicationContext, object : CapturerObserver {
                override fun onCapturerStarted(success: Boolean) {
                    delegate.onCapturerStarted(success)
                    if (!success) fail("screen-capture-failed")
                }
                override fun onCapturerStopped() { delegate.onCapturerStopped() }
                override fun onFrameCaptured(frame: VideoFrame) {
                    val keyguard = context.getSystemService(KeyguardManager::class.java)
                    if (keyguard.isDeviceLocked || keyguard.isKeyguardLocked ||
                        !context.getSystemService(PowerManager::class.java).isInteractive) {
                        fail("device-locked"); return
                    }
                    // This is on the publishing boundary, independently of any network callback.
                    if (!closed.get() && lease.allowed()) {
                        delegate.onFrameCaptured(frame)
                        frames.incrementAndGet()
                    }
                }
            })
            check(!closed.get() && lease.allowed()) { "Authorization ended while preparing capture" }
            capturer.startCapture(width, height, 15)
        } catch (failure: Throwable) {
            lease.close()
            close()
            throw failure
        }
    }

    /** Run on the single signaling worker, never a WebRTC callback or Android UI thread. */
    @Synchronized fun apply(signal: RtcSignal) {
        check(!closed.get() && lease.allowed()) { "Media session ended" }
        signal.canonicalJson()
        val connection = checkNotNull(pc)
        when (signal) {
            is RtcSignal.Sdp -> {
                require(signal.type == "offer" && !receivedOffer) { "Unexpected SDP" }
                receivedOffer = true
                waitSet { connection.setRemoteDescription(it, SessionDescription(SessionDescription.Type.OFFER, signal.sdp)) }
                check(!closed.get() && lease.allowed())
                remoteSet = true
                candidates.forEach(::addCandidate)
                candidates.clear()
                val answer = CompletableFuture<SessionDescription>()
                connection.createAnswer(object : SdpObserver {
                    override fun onCreateSuccess(sdp: SessionDescription?) { answer.complete(checkNotNull(sdp)) }
                    override fun onCreateFailure(error: String?) { answer.completeExceptionally(IllegalStateException("Answer refused")) }
                    override fun onSetSuccess() {}
                    override fun onSetFailure(error: String?) {}
                }, MediaConstraints())
                val description = answer.get(3, TimeUnit.SECONDS)
                check(!closed.get() && lease.allowed())
                waitSet { connection.setLocalDescription(it, description) }
                sendSignal(RtcSignal.Sdp("answer", description.description))
            }
            is RtcSignal.Candidate -> {
                if (remoteSet) addCandidate(signal) else {
                    check(candidates.size < 64) { "Too many pending ICE candidates" }
                    candidates.add(signal)
                }
            }
        }
        check(!closed.get() && lease.allowed()) { "Media session ended during signaling" }
    }

    private fun waitSet(operation: (SdpObserver) -> Unit) {
        val done = CompletableFuture<Unit>()
        operation(object : SdpObserver {
            override fun onSetSuccess() { done.complete(Unit) }
            override fun onSetFailure(error: String?) { done.completeExceptionally(IllegalStateException("SDP refused")) }
            override fun onCreateSuccess(sdp: SessionDescription?) {}
            override fun onCreateFailure(error: String?) {}
        })
        done.get(3, TimeUnit.SECONDS)
    }

    private fun addCandidate(signal: RtcSignal.Candidate) {
        check(!closed.get() && lease.allowed())
        require(signal.sdpMid != null || signal.sdpMLineIndex != null)
        check(checkNotNull(pc).addIceCandidate(IceCandidate(signal.sdpMid,
            signal.sdpMLineIndex ?: 0, signal.candidate))) { "ICE candidate refused" }
    }

    private val observer = object : PeerConnection.Observer {
        override fun onSignalingChange(state: PeerConnection.SignalingState?) {}
        override fun onIceConnectionChange(state: PeerConnection.IceConnectionState?) {
            if (state in setOf(PeerConnection.IceConnectionState.FAILED, PeerConnection.IceConnectionState.CLOSED,
                    PeerConnection.IceConnectionState.DISCONNECTED)) fail("peer-disconnected")
        }
        override fun onConnectionChange(state: PeerConnection.PeerConnectionState?) {
            if (state == PeerConnection.PeerConnectionState.CONNECTED && !closed.get()) onState("peer-connected")
        }
        override fun onIceConnectionReceivingChange(receiving: Boolean) {}
        override fun onIceGatheringChange(state: PeerConnection.IceGatheringState?) {}
        override fun onIceCandidate(candidate: IceCandidate?) {
            if (closed.get() || candidate == null) return
            try { sendSignal(RtcSignal.Candidate(candidate.sdp, candidate.sdpMid, candidate.sdpMLineIndex)) }
            catch (_: Exception) { fail("signaling-failed") }
        }
        override fun onIceCandidatesRemoved(candidates: Array<out IceCandidate>?) {}
        override fun onAddStream(stream: MediaStream?) { fail("unexpected-incoming-media") }
        override fun onRemoveStream(stream: MediaStream?) {}
        override fun onRenegotiationNeeded() {}
        override fun onDataChannel(incoming: DataChannel?) {
            synchronized(channelLock) { attachChannel(incoming) }
        }
    }

    private fun attachChannel(incoming: DataChannel?) {
            if (closed.get() || incoming == null || incoming.label() != "goriq-manual-v1" || channel != null) {
                incoming?.close()
                fail("unexpected-control-channel")
                return
            }
            channel = incoming
            incoming.registerObserver(object : DataChannel.Observer {
                override fun onBufferedAmountChange(previousAmount: Long) {}
                override fun onStateChange() {
                    if (closed.get()) return
                    // Native callbacks never wait for the cleanup lock while JNI close waits for them.
                    try { inputs.execute {
                      synchronized(channelLock) {
                        if (closed.get()) return@synchronized
                        when (incoming.state()) {
                        DataChannel.State.OPEN -> onState("control-channel-open")
                        DataChannel.State.CLOSING, DataChannel.State.CLOSED -> fail("control-channel-ended")
                        else -> {}
                        }
                      }
                    } } catch (_: java.util.concurrent.RejectedExecutionException) {
                        if (!closed.get()) fail("control-channel-ended")
                    }
                }
                override fun onMessage(buffer: DataChannel.Buffer?) {
                    if (buffer == null || closed.get()) return
                    try {
                        require(!buffer.binary && buffer.data.remaining() in 1..4096)
                        val text = Charsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT)
                            .onUnmappableCharacter(CodingErrorAction.REPORT).decode(buffer.data.asReadOnlyBuffer()).toString()
                        val packet = JSONObject(text)
                        require(packet.keys().asSequence().toSet() == setOf("sequence", "command"))
                        val number = packet.get("sequence")
                        require(number is Number && number.toDouble() == number.toLong().toDouble() &&
                            number.toLong() in 1..9_007_199_254_740_991L)
                        val sequence = number.toLong()
                        val action = manualAction(packet.getJSONObject("command"))
                        val received = SystemClock.elapsedRealtime()
                        synchronized(inputLock) {
                            require(sequence == receivedSequence + 1)
                            while (inputTimes.isNotEmpty() && received - inputTimes.first() >= 1_000) inputTimes.removeFirst()
                            require(inputTimes.size < 30)
                            inputTimes.addLast(received)
                            receivedSequence = sequence
                        }
                        inputs.execute {
                            try {
                                check(!closed.get() && lease.allowed() && SystemClock.elapsedRealtime() - received < 1_000)
                                check(applyInput(action, received))
                                synchronized(channelLock) {
                                    check(!closed.get() && lease.allowed() && incoming.state() == DataChannel.State.OPEN)
                                    val ack = JSONObject().put("type", "manual-applied").put("sequence", sequence).toString()
                                    check(incoming.bufferedAmount() <= 65_536 &&
                                        incoming.send(DataChannel.Buffer(ByteBuffer.wrap(ack.toByteArray(Charsets.UTF_8)), false)))
                                }
                            } catch (_: Exception) { fail("manual-input-not-confirmed") }
                        }
                    } catch (_: Exception) { fail("invalid-manual-input") }
                }
            })
        }

    private fun manualAction(value: JSONObject): ManualAction {
        val keys = value.keys().asSequence().toSet()
        fun number(key: String): Double = (value.get(key) as? Number)?.toDouble() ?: error("Invalid coordinate")
        return when (value.getString("action")) {
            "tap" -> {
                require(keys == setOf("action", "x", "y"))
                ManualAction.parse("tap", number("x"), number("y"))
            }
            "swipe" -> {
                require(keys == setOf("action", "x1", "y1", "x2", "y2", "durationMs"))
                val duration = number("durationMs")
                require(duration.isFinite() && duration == duration.toLong().toDouble())
                ManualAction.parse("swipe", number("x1"), number("y1"), number("x2"), number("y2"), duration.toLong())
            }
            "key" -> {
                require(keys == setOf("action", "key"))
                when (value.getString("key")) {
                    "BACK" -> ManualAction.Back
                    "HOME" -> ManualAction.Home
                    "APP_SWITCH" -> ManualAction.Recents
                    else -> error("Unsupported Android key")
                }
            }
            else -> error("Unsupported Android action")
        }
    }

    fun capturedFrames(): Long = frames.get()

    private fun fail(reason: String) {
        lease.close()
        if (!closed.get()) requestStop(reason)
    }

    /** Call from the dedicated cleanup worker, not a capture/RTC callback thread. */
    fun stopPublishing() {
        lease.close()
    }

    @Synchronized fun close(): Boolean {
        if (!closed.compareAndSet(false, true)) return cleanupConfirmed
        lease.close()
        inputs.shutdownNow()
        fun release(action: () -> Unit) { runCatching(action).onFailure { cleanupConfirmed = false } }
        release { track?.setEnabled(false) }
        synchronized(channelLock) {
            release { channel?.unregisterObserver() }
            release { channel?.close() }
            release { channel?.dispose() }
        }
        release { pc?.close() }
        release { capture?.stopCapture() }
        release { capture?.dispose() }
        release { track?.dispose() }
        release { source?.dispose() }
        release { texture?.dispose() }
        release { pc?.dispose() }
        release { factory?.dispose() }
        release { egl?.release() }
        return cleanupConfirmed
    }
}
