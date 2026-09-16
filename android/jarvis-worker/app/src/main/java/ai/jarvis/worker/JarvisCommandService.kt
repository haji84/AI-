package ai.jarvis.worker

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import java.util.concurrent.atomic.AtomicBoolean

class JarvisCommandService : Service() {
    private val running = AtomicBoolean(false)
    private var workerThread: Thread? = null

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
        startForeground(NOTIFICATION_ID, buildNotification("JARVIS接続を維持しています"))
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (running.compareAndSet(false, true)) {
            workerThread = Thread({ pollingLoop() }, "jarvis-command-poller").apply { start() }
        }
        return START_STICKY
    }

    override fun onDestroy() {
        running.set(false)
        workerThread?.interrupt()
        workerThread = null
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    private fun pollingLoop() {
        val client = BrokerClient(applicationContext)
        if (client.brokerUrl.isBlank()) {
            stopSelf()
            return
        }

        var lastHeartbeatAt = 0L
        var lastTaskPollAt = 0L
        while (running.get()) {
            try {
                val now = System.currentTimeMillis()
                if (now - lastHeartbeatAt >= HEARTBEAT_INTERVAL_MS) {
                    client.heartbeat()
                    lastHeartbeatAt = now
                }

                // Older Brokers do not have remote routes; ordinary tasks still work.
                try { client.pollRemote() } catch (error: BrokerHttpException) { if (error.statusCode != 404) throw error }
                if (now - lastTaskPollAt >= 3_000) repeat(MAX_TASKS_PER_TICK) {
                    lastTaskPollAt = now
                    val response = client.nextTask()
                    val task = response.optJSONObject("task") ?: return@repeat
                    TaskExecutor(applicationContext).execute(task)
                }
            } catch (_: InterruptedException) {
                break
            } catch (_: Throwable) {
                // Keep the foreground service alive across temporary network/Broker failures.
            }

            try {
                Thread.sleep(POLL_INTERVAL_MS)
            } catch (_: InterruptedException) {
                break
            }
        }
    }

    private fun createNotificationChannel() {
        val manager = getSystemService(NotificationManager::class.java)
        val channel = NotificationChannel(
            CHANNEL_ID,
            "JARVIS 常時接続",
            NotificationManager.IMPORTANCE_LOW,
        ).apply {
            description = "JARVIS Commanderからの命令を受信します"
            setShowBadge(false)
        }
        manager.createNotificationChannel(channel)
    }

    private fun buildNotification(text: String): Notification = NotificationCompat.Builder(this, CHANNEL_ID)
        .setSmallIcon(android.R.drawable.stat_notify_sync_noanim)
        .setContentTitle("JARVIS Worker")
        .setContentText(text)
        .setOngoing(true)
        .setOnlyAlertOnce(true)
        .setPriority(NotificationCompat.PRIORITY_LOW)
        .build()

    companion object {
        private const val CHANNEL_ID = "jarvis-command-channel"
        private const val NOTIFICATION_ID = 4101
        private const val POLL_INTERVAL_MS = 750L
        private const val HEARTBEAT_INTERVAL_MS = 15_000L
        private const val MAX_TASKS_PER_TICK = 5

        fun start(context: Context) {
            val client = BrokerClient(context.applicationContext)
            if (client.brokerUrl.isBlank()) return
            ContextCompat.startForegroundService(
                context.applicationContext,
                Intent(context.applicationContext, JarvisCommandService::class.java),
            )
        }
    }
}
