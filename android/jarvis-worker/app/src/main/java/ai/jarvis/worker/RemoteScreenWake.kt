package ai.jarvis.worker

import android.app.KeyguardManager
import android.content.Context
import android.os.Build
import android.os.PowerManager
import android.os.SystemClock

object RemoteScreenWake {
    @Suppress("DEPRECATION")
    fun <T> run(context: Context, expiresAt: Long, operation: (Boolean) -> T): T {
        val power = context.getSystemService(PowerManager::class.java) ?: error("PowerManager unavailable")
        val keyguard = context.getSystemService(KeyguardManager::class.java) ?: error("Keyguard unavailable")
        var lease: PowerManager.WakeLock? = null
        try {
            SwipeWakeActivity.dismissIfAllowed(context, expiresAt)
            val woke = RemoteWakeGate.awaitReady(expiresAt, System::currentTimeMillis, SystemClock::elapsedRealtime,
                { power.isInteractive }, { keyguard.isDeviceLocked || keyguard.isKeyguardLocked },
                { WorkerRuntimeState.snapshot().optBoolean("working") },
                { Build.VERSION.SDK_INT >= 30 || LegacyScreenService.available() },
                { duration ->
                    try {
                        lease = power.newWakeLock(PowerManager.SCREEN_DIM_WAKE_LOCK or PowerManager.ACQUIRE_CAUSES_WAKEUP, "jarvis:remote-command")
                        lease!!.acquire(duration.coerceAtLeast(1))
                    } catch (_: SecurityException) {
                        throw RemoteWakeFailure("WAKE_NOT_ALLOWED", "OSが画面の自動点灯を許可していません。端末の電源ボタンを押してください")
                    }
                }, { Thread.sleep(it) })
            // Recheck after wake: never send a queued tap to a newly appeared lock screen.
            checkReady(context, expiresAt)
            return operation(woke)
        } finally {
            lease?.let { if (it.isHeld) it.release() }
        }
    }

    fun checkReady(context: Context, expiresAt: Long) {
        val keyguard = context.getSystemService(KeyguardManager::class.java)
        if (System.currentTimeMillis() >= expiresAt) throw RemoteWakeFailure("COMMAND_EXPIRED", "操作の有効期限が切れました")
        if (keyguard == null || keyguard.isDeviceLocked || keyguard.isKeyguardLocked)
            throw RemoteWakeFailure("UNLOCK_REQUIRED", "端末の画面ロックを解除してください")
        if (context.getSystemService(PowerManager::class.java)?.isInteractive != true)
            throw RemoteWakeFailure("SCREEN_OFF", "画面が消灯しました。操作を中止しました")
        if (WorkerRuntimeState.snapshot().optBoolean("working")) throw RemoteWakeFailure("DEVICE_BUSY", "端末が作業中です")
        if (Build.VERSION.SDK_INT < 30 && !LegacyScreenService.available())
            throw RemoteWakeFailure("CAPTURE_CONSENT_REQUIRED", "端末で画面共有を許可してください")
    }
}
