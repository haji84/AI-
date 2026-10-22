package app.goriq.remote.lite

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.annotation.TargetApi
import android.app.KeyguardManager
import android.graphics.Bitmap
import android.graphics.Path
import android.os.Build
import android.view.Display
import android.view.accessibility.AccessibilityEvent
import java.io.ByteArrayOutputStream
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

data class CapturedFrame(val jpeg: ByteArray, val width: Int, val height: Int, val capturedAtMs: Long)

/** Manual-only Android OS boundary. The service is not exported and opens no listener. */
class ManualAccessibilityService : AccessibilityService() {
    companion object {
        @Volatile private var current: ManualAccessibilityService? = null
        fun connected(): Boolean = current != null
        fun capture(): CapturedFrame = (current ?: error("Accessibility unavailable")).captureScreen()
        fun apply(action: ManualAction): Boolean =
            (current ?: error("Accessibility unavailable")).applyManual(action)
    }

    override fun onServiceConnected() {
        super.onServiceConnected()
        current = this
    }
    override fun onAccessibilityEvent(event: AccessibilityEvent?) { /* No event collection. */ }
    override fun onInterrupt() { current = null }
    override fun onDestroy() {
        if (current === this) current = null
        super.onDestroy()
    }

    private fun requireUnlocked() {
        check(getSystemService(KeyguardManager::class.java)?.isDeviceLocked == false) { "Device locked" }
    }

    @TargetApi(30)
    private fun captureScreen(): CapturedFrame {
        check(Build.VERSION.SDK_INT >= 30) { "Screenshot requires Android 11 or newer" }
        requireUnlocked()
        val done = CountDownLatch(1)
        var frame: CapturedFrame? = null
        var failure = "Screenshot unavailable"
        takeScreenshot(Display.DEFAULT_DISPLAY, mainExecutor, object : TakeScreenshotCallback {
            override fun onSuccess(result: ScreenshotResult) {
                try {
                    result.hardwareBuffer.use { buffer ->
                        val hardware = Bitmap.wrapHardwareBuffer(buffer, result.colorSpace)
                            ?: error("No screenshot bitmap")
                        val bitmap = hardware.copy(Bitmap.Config.ARGB_8888, false)
                        hardware.recycle()
                        requireNotNull(bitmap)
                        try {
                            val output = ByteArrayOutputStream()
                            check(bitmap.compress(Bitmap.CompressFormat.JPEG, 60, output))
                            val jpeg = output.toByteArray()
                            check(jpeg.size in 1..650_000) { "Screenshot too large" }
                            frame = CapturedFrame(jpeg, bitmap.width, bitmap.height, System.currentTimeMillis())
                        } finally { bitmap.recycle() }
                    }
                } catch (error: Exception) { failure = error.message ?: failure }
                finally { done.countDown() }
            }
            override fun onFailure(errorCode: Int) {
                failure = "Screenshot denied ($errorCode)"
                done.countDown()
            }
        })
        check(done.await(3, TimeUnit.SECONDS)) { "Screenshot timed out" }
        return frame ?: error(failure)
    }

    private fun applyManual(action: ManualAction): Boolean {
        requireUnlocked()
        return when (action) {
            ManualAction.Back -> performGlobalAction(GLOBAL_ACTION_BACK)
            ManualAction.Home -> performGlobalAction(GLOBAL_ACTION_HOME)
            ManualAction.Recents -> performGlobalAction(GLOBAL_ACTION_RECENTS)
            is ManualAction.Tap -> gesture(action.x, action.y, action.x, action.y, 80)
            is ManualAction.Swipe -> gesture(action.x1, action.y1, action.x2, action.y2, action.durationMs)
        }
    }

    private fun gesture(x1: Double, y1: Double, x2: Double, y2: Double, duration: Long): Boolean {
        val metrics = resources.displayMetrics
        val path = Path().apply {
            moveTo((metrics.widthPixels * x1).toFloat(), (metrics.heightPixels * y1).toFloat())
            lineTo((metrics.widthPixels * x2).toFloat(), (metrics.heightPixels * y2).toFloat())
        }
        val done = CountDownLatch(1)
        var applied = false
        val accepted = dispatchGesture(GestureDescription.Builder()
            .addStroke(GestureDescription.StrokeDescription(path, 0, duration)).build(),
            object : GestureResultCallback() {
                override fun onCompleted(gestureDescription: GestureDescription?) {
                    applied = true
                    done.countDown()
                }
                override fun onCancelled(gestureDescription: GestureDescription?) { done.countDown() }
            }, null)
        if (!accepted) return false
        return done.await(6, TimeUnit.SECONDS) && applied
    }
}
