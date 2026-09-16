package ai.jarvis.worker

class RemoteWakeFailure(val code: String, message: String) : IllegalStateException(message)

/** Pure bounded gate; injected clocks make expiry and power races testable. */
object RemoteWakeGate {
    fun awaitReady(expiresAt: Long, wall: () -> Long, elapsed: () -> Long,
                   interactive: () -> Boolean, locked: () -> Boolean, busy: () -> Boolean,
                   captureAllowed: () -> Boolean, wake: (Long) -> Unit, pause: (Long) -> Unit): Boolean {
        fun checkGuards() {
            if (wall() >= expiresAt) throw RemoteWakeFailure("COMMAND_EXPIRED", "操作の有効期限が切れました")
            if (busy()) throw RemoteWakeFailure("DEVICE_BUSY", "端末が作業中です")
            if (!captureAllowed()) throw RemoteWakeFailure("CAPTURE_CONSENT_REQUIRED", "端末で画面共有を許可してください")
            if (locked()) throw RemoteWakeFailure("UNLOCK_REQUIRED", "端末の画面ロックを解除してください")
        }
        checkGuards()
        if (interactive()) return false
        val budget = minOf(2_000L, expiresAt - wall())
        if (budget <= 0) throw RemoteWakeFailure("COMMAND_EXPIRED", "操作の有効期限が切れました")
        val stopAt = elapsed() + budget
        wake(minOf(8_000L, expiresAt - wall()))
        while (true) {
            checkGuards()
            if (elapsed() >= stopAt) throw RemoteWakeFailure("WAKE_TIMEOUT", "画面を起こせませんでした。端末の電源ボタンを押してください")
            if (interactive()) return true
            pause(minOf(50L, stopAt - elapsed()))
        }
    }
}
