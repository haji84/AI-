package ai.jarvis.worker

import android.app.Activity
import android.app.KeyguardManager
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.WindowManager
import java.util.UUID
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/** Non-exported, single-use bridge to Android's non-secure keyguard dismissal API. */
class SwipeWakeActivity : Activity() {
    private var request: Request? = null
    private val handler = Handler(Looper.getMainLooper())
    override fun onCreate(state: Bundle?) {
        super.onCreate(state)
        val candidate = synchronized(SwipeWakeActivity::class.java) {
            pending?.takeIf { it.token == intent.getStringExtra("request") }
        }
        request = candidate
        if (candidate == null || !allowed(this, candidate.expires)) { finish(); return }
        @Suppress("DEPRECATION")
        window.addFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON)
        if (Build.VERSION.SDK_INT >= 27) { setShowWhenLocked(true); setTurnScreenOn(true) }
        handler.postDelayed({ finish() }, (candidate.expires - System.currentTimeMillis()).coerceIn(1, 2500))
        // Recheck immediately before asking the OS. Never show a credential prompt.
        if (!allowed(this, candidate.expires)) { finish(); return }
        getSystemService(KeyguardManager::class.java).requestDismissKeyguard(this,
            object : KeyguardManager.KeyguardDismissCallback() {
                override fun onDismissSucceeded() { finish() }
                override fun onDismissError() { finish() }
                override fun onDismissCancelled() { finish() }
            })
    }
    override fun onDestroy() {
        handler.removeCallbacksAndMessages(null)
        super.onDestroy()
        request?.done?.countDown()
    }
    companion object {
        private data class Request(val token: String, val expires: Long, val done: CountDownLatch = CountDownLatch(1))
        private var pending: Request? = null
        private fun allowed(context: Context, expires: Long): Boolean {
            val k = context.getSystemService(KeyguardManager::class.java) ?: return false
            return SwipeWakePolicy.mayDismiss(k.isKeyguardLocked, k.isKeyguardSecure || k.isDeviceSecure,
                k.isDeviceLocked, WorkerRuntimeState.snapshot().optBoolean("working"),
                Build.VERSION.SDK_INT >= 30 || LegacyScreenService.available(), System.currentTimeMillis(), expires)
        }
        fun dismissIfAllowed(context: Context, expires: Long) {
            if (!allowed(context, expires)) return
            val r = Request(UUID.randomUUID().toString(), minOf(expires, System.currentTimeMillis() + 2500))
            synchronized(SwipeWakeActivity::class.java) {
                if (pending != null) throw RemoteWakeFailure("DEVICE_BUSY", "端末の復帰処理中です")
                pending = r
            }
            try {
                context.startActivity(Intent(context, SwipeWakeActivity::class.java)
                    .putExtra("request", r.token).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_NO_ANIMATION))
                r.done.await((r.expires - System.currentTimeMillis()).coerceAtLeast(1), TimeUnit.MILLISECONDS)
            } finally {
                synchronized(SwipeWakeActivity::class.java) { if (pending === r) pending = null }
            }
        }
    }
}
