package app.goriq.remote.lite

import android.app.*
import android.content.Intent
import android.content.res.Configuration
import android.graphics.Point
import android.os.*
import android.view.WindowManager
import org.webrtc.PeerConnection
import java.util.concurrent.Executors
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

class NativeIceConfig(val servers: List<PeerConnection.IceServer> = emptyList(), val relayOnly: Boolean = false,
    val credentialDeadlineElapsed: Long? = null)
data class SharingState(val sessionId: String?, val message: String, val frames: Long = 0)

/** One locally confirmed screen-sharing service; never restarted by boot or sticky intents. */
open class RemoteSessionService : Service() {
    companion object {
        const val ACTION_START = "app.goriq.remote.lite.SHARE"
        const val ACTION_STOP = "app.goriq.remote.lite.STOP_SHARE"
        private const val CHANNEL = "remote_lite_screen_share"
        private val stateLock = Any()
        private var owner: RemoteSessionService? = null
        @Volatile var state = SharingState(null, "画面共有は停止中です。")
            private set
    }
    private val started = AtomicBoolean()
    private val stopping = AtomicBoolean()
    private val cleanupStarted = AtomicBoolean()
    private val inputGate = InputDispatchGate()
    @Volatile private var activeLease: CaptureLease? = null
    private val worker = Executors.newSingleThreadScheduledExecutor()
    private val statusWorker = Executors.newSingleThreadScheduledExecutor()
    private val watchdog = Executors.newSingleThreadScheduledExecutor()
    private val outgoing = LinkedBlockingQueue<RtcSignal>(64)
    @Volatile private var peer: NativeRtcPeer? = null
    @Volatile private var endSession: (() -> Boolean)? = null
    private var sessionId: String? = null

    protected open fun iceConfiguration(access: DeviceSessionAccess, session: String): NativeIceConfig {
        val started = SystemClock.elapsedRealtime()
        val ice = access.ice(session)
        val deadline = ice.monotonicDeadline(started, SystemClock.elapsedRealtime())
        return NativeIceConfig(ice.iceServers.map { server ->
            PeerConnection.IceServer.builder(server.urls).setUsername(server.username)
                .setPassword(server.credential).createIceServer()
        }, credentialDeadlineElapsed = if (ice.mode == "direct-only") null else deadline)
    }

    override fun onBind(intent: Intent?) = null

    @Suppress("DEPRECATION")
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            requestStop("local-stop")
            return START_NOT_STICKY
        }
        if (intent?.action != ACTION_START || !started.compareAndSet(false, true)) return START_NOT_STICKY
        val session = intent.getStringExtra("session")
        val projection = intent.getParcelableExtra<Intent>("projection")
        if (session == null || !Regex("[A-Za-z0-9._:-]{1,128}").matches(session) ||
            projection == null || intent.getIntExtra("result", 0) != Activity.RESULT_OK) {
            requestStop("invalid-local-consent")
            return START_NOT_STICKY
        }
        sessionId = session
        synchronized(stateLock) {
            if (owner != null && owner !== this) { stopSelf(); return START_NOT_STICKY }
            owner = this
            state = SharingState(session, "共有を準備しています…")
        }
        val notifications = getSystemService(NotificationManager::class.java)
        notifications.createNotificationChannel(NotificationChannel(CHANNEL, "手動遠隔の画面共有", NotificationManager.IMPORTANCE_LOW))
        val stop = PendingIntent.getService(this, 1, Intent(this, javaClass).setAction(ACTION_STOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val show = PendingIntent.getActivity(this, 2, Intent(this, RemoteSessionActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val notification = Notification.Builder(this, CHANNEL)
            .setSmallIcon(android.R.drawable.ic_menu_view).setContentTitle("GORIQ Remote 画面共有中")
            .setContentText("自分の端末への手動操作を許可しています。停止できます。")
            .setOngoing(true).setContentIntent(show)
            .addAction(Notification.Action.Builder(null, "共有を停止", stop).build()).build()
        try { startForeground(1831, notification) }
        catch (_: Exception) { requestStop("foreground-permission-refused"); return START_NOT_STICKY }
        worker.execute {
            try {
                val saved = checkNotNull(EnrollmentSettings(this).read())
                val identity = LocalIdentity(this)
                check(identity.deviceId() == saved.deviceId && identity.fingerprint() == saved.fingerprint)
                val exchange = CoordinatorExchange(HttpsJsonTransport(RemoteEndpoint.parse(saved.origin)))
                val access = DeviceSessionAccess(identity, exchange,
                    failureDiagnostic = { diagnostic("authorization-check-failed:" + it) })
                endSession = { access.end(session) }
                val active = access.discoverActive()
                if (active == null) {
                    val pending = checkNotNull(access.discoverPending())
                    check(pending.sessionId == session)
                    access.accept(pending)
                } else check(active.sessionId == session)
                // Slow relay provisioning precedes, and never extends, the live authorization lease.
                val ice = iceConfiguration(access, session)
                check(!stopping.get())
                val checkStarted = SystemClock.elapsedRealtime()
                check(access.verifyActive(session).allowed && SystemClock.elapsedRealtime() - checkStarted < 3_000)
                // Discovery/acceptance can take several round trips. Arm only after fresh final authorization.
                val lease = CaptureLease(SystemClock::elapsedRealtime,
                    hardDeadlineElapsed = ice.credentialDeadlineElapsed ?: Long.MAX_VALUE).also { activeLease = it }
                check(!stopping.get() && lease.renew())
                statusWorker.scheduleWithFixedDelay({
                    if (stopping.get()) return@scheduleWithFixedDelay
                    if (!access.verifyActive(session).allowed) requestStop("session-not-active")
                    else if (!lease.renew()) {
                        diagnostic("authorization-lease-renewal-expired")
                        requestStop("session-not-active")
                    }
                }, 500, 750, TimeUnit.MILLISECONDS)
                watchdog.scheduleAtFixedRate({
                    val keyguard = getSystemService(KeyguardManager::class.java)
                    if (keyguard.isDeviceLocked || keyguard.isKeyguardLocked ||
                        !getSystemService(PowerManager::class.java).isInteractive) requestStop("device-locked")
                    if (!lease.allowed()) requestStop("status-deadline")
                    if (ice.credentialDeadlineElapsed?.let { SystemClock.elapsedRealtime() >= it } == true)
                        requestStop("relay-credentials-expired")
                }, 250, 250, TimeUnit.MILLISECONDS)
                val cursorStore = SignalCursorSettings(this)
                check(cursorStore.read(session) == 0L) { "A new session is required after media termination" }
                val signaling = DeviceSignaling(identity, exchange, session, cursorStore)
                val display = (getSystemService(WINDOW_SERVICE) as WindowManager).defaultDisplay
                val size = Point()
                display.getRealSize(size)
                val rotation = display.rotation
                val connection = NativeRtcPeer(this, lease,
                    { signal -> check(!stopping.get() && outgoing.offer(signal)) { "Signaling queue full" } },
                    { action, received ->
                        check(!stopping.get() && lease.allowed())
                        diagnostic("manual-pre-status")
                        val applied = access.requireActiveThen(session) {
                            diagnostic("manual-pre-status-confirmed:age-ms=" + (SystemClock.elapsedRealtime() - received))
                            check(!stopping.get() && lease.allowed() &&
                                SystemClock.elapsedRealtime() - received < 1_000)
                            ManualAccessibilityService.applyRemote(action, size.x, size.y, rotation, inputGate) {
                                !stopping.get() && lease.allowed() &&
                                    SystemClock.elapsedRealtime() - received in 0L until 1_000L
                            }
                        }
                        diagnostic("manual-os-result:" + applied)
                        val confirmed = applied && !stopping.get() && access.verifyActive(session).allowed && lease.allowed()
                        diagnostic("manual-post-status:" + confirmed)
                        confirmed
                    },
                    { event -> publish("接続状態: " + event) },
                    ::requestStop).also { peer = it }
                diagnostic("capture-preparing")
                connection.start(projection, size.x, size.y, ice.servers, ice.relayOnly)
                diagnostic("capture-started")
                publish("画面共有を開始しました。接続元の映像と操作結果を確認してください。")
                worker.scheduleWithFixedDelay({
                    if (stopping.get()) return@scheduleWithFixedDelay
                    try {
                        check(lease.allowed())
                        repeat(8) { outgoing.poll()?.let(signaling::send) }
                        val batch = signaling.receive()
                        batch.signals.forEach(connection::apply)
                        signaling.acknowledge(batch.cursor)
                        publish()
                    } catch (_: Exception) { requestStop("signaling-ended") }
                }, 0, 250, TimeUnit.MILLISECONDS)
            } catch (failure: Throwable) {
                android.util.Log.e("RemoteLiteNative", "Capture start refused: " + failure.javaClass.simpleName)
                requestStop("capture-start-refused")
            }
        }
        return START_NOT_STICKY
    }

    override fun onConfigurationChanged(newConfig: Configuration) {
        super.onConfigurationChanged(newConfig)
        requestStop("display-changed")
    }

    private fun requestStop(reason: String) {
        activeLease?.close()
        peer?.stopPublishing()
        inputGate.close()
        if (!stopping.compareAndSet(false, true)) return
        diagnostic("stop:" + reason)
        diagnostic("stop-captured-frames:" + (peer?.capturedFrames() ?: 0))
        val message = when (reason) {
            "local-stop" -> "共有を停止しました。"
            "display-changed" -> "画面の大きさが変わったため停止しました。再接続と画面共有の許可が必要です。"
            "screen-permission-ended" -> "OSの画面共有が終了したため停止しました。"
            "device-locked" -> "端末がロックされたため停止しました。解除後に画面共有の許可が必要です。"
            "peer-disconnected", "control-channel-ended" -> "接続が切れたため画面共有と操作を停止しました。"
            "session-not-active", "status-deadline" -> "接続の承認を確認できないため画面共有と操作を停止しました。"
            "relay-credentials-expired" -> "中継の有効期限に達したため停止しました。接続元で新しい接続を作成してください。"
            "manual-input-not-confirmed", "invalid-manual-input" -> "入力結果を確認できないため停止しました。操作権限と端末状態を確認してください。"
            else -> "画面共有を開始または継続できません。承認・画面共有許可・通信を確認してください。"
        }
        synchronized(stateLock) {
            if (owner === this) state = SharingState(sessionId, "停止処理中です…", peer?.capturedFrames() ?: 0)
        }
        cleanup(message)
    }

    private fun publish(message: String? = null) = synchronized(stateLock) {
        if (owner === this && !stopping.get())
            state = SharingState(sessionId, message ?: state.message, peer?.capturedFrames() ?: 0)
    }

    private fun cleanup(message: String) {
        if (!cleanupStarted.compareAndSet(false, true)) return
        activeLease?.close()
        peer?.stopPublishing()
        inputGate.close()
        stopping.set(true)
        worker.shutdownNow()
        statusWorker.shutdownNow()
        watchdog.shutdownNow()
        Thread {
            val stopped = runCatching { worker.awaitTermination(12, TimeUnit.SECONDS) }.getOrDefault(false)
            // Read after worker termination: startup may have created the peer while stop was requested.
            val released = peer?.close() != false
            val confirmed = stopped && released
            // Local publication/input are already closed. Network cleanup cannot keep them running.
            val sessionEnded = runCatching { endSession?.invoke() == true }.getOrDefault(false)
            synchronized(stateLock) {
                if (owner === this) {
                    state = SharingState(sessionId, if (confirmed) message + if (sessionEnded) "" else
                        "\n接続要求の終了は未確認です。所有者が接続を終了し、新しい要求で接続してください。" else
                        "停止処理の完了を確認できません。OSの画面共有表示を確認し、アプリを終了してください。",
                        peer?.capturedFrames() ?: 0)
                    if (confirmed) owner = null
                }
            }
            Handler(Looper.getMainLooper()).post {
                // Keep a visible warning if native capture cleanup could not be confirmed.
                stopForeground(if (confirmed) STOP_FOREGROUND_REMOVE else STOP_FOREGROUND_DETACH)
                stopSelf()
            }
        }.start()
    }

    private fun diagnostic(event: String) {
        if (resources.getBoolean(app.goriq.remote.lite.R.bool.remote_test_diagnostics))
            android.util.Log.w("RemoteLiteNative", event)
        else if (applicationInfo.flags and android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE != 0)
            android.util.Log.i("RemoteLiteNative", event)
    }

    override fun onDestroy() {
        cleanup("サービスが終了したため共有を停止しました。")
        super.onDestroy()
    }
}
