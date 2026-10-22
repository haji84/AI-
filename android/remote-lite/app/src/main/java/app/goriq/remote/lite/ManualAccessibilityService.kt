package app.goriq.remote.lite

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.annotation.TargetApi
import android.app.KeyguardManager
import android.graphics.Bitmap
import android.graphics.Path
import android.graphics.Point
import android.graphics.Rect
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.view.Display
import android.view.WindowManager
import android.view.accessibility.AccessibilityEvent
import java.io.ByteArrayOutputStream
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

data class CapturedFrame(val jpeg: ByteArray, val width: Int, val height: Int, val capturedAtMs: Long)

/** Manual-only Android OS boundary. Only Android's bind permission can start this service. */
class ManualAccessibilityService : AccessibilityService() {
    private val captureExecutor = Executors.newSingleThreadExecutor { task ->
        Thread(task, "remote-lite-capture").apply { isDaemon = true }
    }
    @Volatile private var lastFrame: FrameGeometry? = null
    private val windowProofLock = Any()
    private var lastWindowProof = Long.MIN_VALUE

    companion object {
        @Volatile private var current: ManualAccessibilityService? = null
        fun connected(): Boolean = current != null
        fun capture(): CapturedFrame = (current ?: error("Accessibility unavailable")).captureScreen()
        fun apply(action: ManualAction): Boolean =
            (current ?: error("Accessibility unavailable")).applyManual(action)
        fun applyRemote(action: ManualAction, width: Int, height: Int, rotation: Int,
            gate: InputDispatchGate, admitted: () -> Boolean): Boolean =
            (current ?: error("Accessibility unavailable"))
                .applyRemoteChecked(action, width, height, rotation, gate, admitted)
    }

    private fun diagnostic(event: String) {
        if (resources.getBoolean(app.goriq.remote.lite.R.bool.remote_test_diagnostics))
            android.util.Log.w("RemoteLiteLifecycle", event)
        else if (applicationInfo.flags and android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE != 0)
            android.util.Log.i("RemoteLiteLifecycle",
                "$event pid=${android.os.Process.myPid()} instance=${System.identityHashCode(this)} elapsed=${SystemClock.elapsedRealtime()}")
    }

    override fun onServiceConnected() {
        super.onServiceConnected()
        current = this
        diagnostic("connected")
    }
    override fun onAccessibilityEvent(event: AccessibilityEvent?) { /* No event collection. */ }
    override fun onInterrupt() {
        // Feedback interruption is not an unbind; keep the system-bound service available.
        lastFrame = null
    }
    override fun onUnbind(intent: android.content.Intent?): Boolean {
        diagnostic("unbind")
        if (current === this) current = null
        lastFrame = null
        return super.onUnbind(intent)
    }
    override fun onDestroy() {
        diagnostic("destroy")
        if (current === this) current = null
        lastFrame = null
        captureExecutor.shutdownNow()
        super.onDestroy()
    }

    private fun requireWorkerThread() {
        check(Looper.myLooper() != Looper.getMainLooper()) { "Run screen and input calls off the UI thread" }
    }

    private fun requireActiveUnlocked() {
        check(current === this) { "Accessibility disconnected" }
        check(getSystemService(KeyguardManager::class.java)?.isDeviceLocked == false) { "Device locked" }
        check(getSystemService(KeyguardManager::class.java)?.isKeyguardLocked == false &&
            getSystemService(android.os.PowerManager::class.java)?.isInteractive == true) { "Device locked or screen off" }
    }

    private data class DisplayState(val width: Int, val height: Int, val rotation: Int)

    @Suppress("DEPRECATION")
    private fun displayState(): DisplayState {
        val display = (getSystemService(WINDOW_SERVICE) as WindowManager).defaultDisplay
        val size = Point()
        display.getRealSize(size)
        check(size.x > 0 && size.y > 0) { "Display unavailable" }
        return DisplayState(size.x, size.y, display.rotation)
    }

    @TargetApi(30)
    private fun captureScreen(): CapturedFrame {
        check(Build.VERSION.SDK_INT >= 30) { "Screenshot requires Android 11 or newer" }
        requireWorkerThread()
        requireActiveUnlocked()
        lastFrame = null
        val before = displayState()
        val done = CountDownLatch(1)
        var frame: CapturedFrame? = null
        var failure = "Screenshot unavailable"
        takeScreenshot(Display.DEFAULT_DISPLAY, captureExecutor, object : TakeScreenshotCallback {
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
        requireActiveUnlocked()
        val captured = frame ?: error(failure)
        check(displayState() == before && captured.width == before.width && captured.height == before.height) {
            "Screenshot does not match current display"
        }
        lastFrame = FrameGeometry(captured.width, captured.height, before.rotation, SystemClock.elapsedRealtime())
        return captured
    }

    private data class InputWindow(val id: Int, val bounds: Rect, val layer: Int, val active: Boolean)

    @TargetApi(33)
    @Suppress("DEPRECATION")
    private fun inputWindows(): List<InputWindow> {
        // This connection's cached window list can lag an activity transition.
        // Both the proof and final dispatch must query current OS geometry.
        check(clearCache()) { "Window cache unavailable" }
        return windows.map { window ->
            try {
                val bounds = Rect()
                window.getBoundsInScreen(bounds)
                InputWindow(window.id, bounds, window.layer, window.isActive)
            } finally { window.recycle() }
        }.sortedByDescending { it.layer }
    }

    @TargetApi(34)
    private fun applyRemoteChecked(action: ManualAction, width: Int, height: Int, rotation: Int,
        gate: InputDispatchGate, admitted: () -> Boolean): Boolean {
        // Display screenshots can redact a secure window without refusing the request.
        check(Build.VERSION.SDK_INT >= 34) { "Safe remote input requires Android 14 or newer" }
        requireWorkerThread()
        requireActiveUnlocked()
        val expected = DisplayState(width, height, rotation)
        check(displayState() == expected) { "Display changed" }
        diagnostic("remote-display-confirmed")
        val proofStarted = SystemClock.elapsedRealtime()
        val frame = FrameGeometry(width, height, rotation, proofStarted)
        val points = when (action) {
            is ManualAction.Tap -> listOf(frame.point(action.x, action.y, width, height, rotation, proofStarted))
            is ManualAction.Swipe -> listOf(frame.point(action.x1, action.y1, width, height, rotation, proofStarted),
                frame.point(action.x2, action.y2, width, height, rotation, proofStarted))
            else -> emptyList()
        }
        fun target(): InputWindow {
            val candidates = inputWindows()
            if (points.isEmpty()) return checkNotNull(candidates.firstOrNull { it.active })
            val selected = points.map { point ->
                checkNotNull(candidates.firstOrNull { it.bounds.contains(point.x.toInt(), point.y.toInt()) }
                    .also { if (it == null) diagnostic("remote-window-refused:no-target:window-count=" + candidates.size) })
            }
            val sameWindow = selected.map { it.id }.distinct().size == 1
            if (!sameWindow) diagnostic("remote-window-refused:cross-window")
            check(sameWindow) { "Gesture crosses windows" }
            val chosen = selected.first()
            if (points.size == 2) {
                val swept = Rect(points.minOf { it.x }.toInt(), points.minOf { it.y }.toInt(),
                    points.maxOf { it.x }.toInt() + 1, points.maxOf { it.y }.toInt() + 1)
                val unobstructed = candidates.none { it.id != chosen.id && it.layer >= chosen.layer && Rect.intersects(it.bounds, swept) }
                if (!unobstructed) diagnostic("remote-window-refused:overlap")
                check(unobstructed) {
                    "Gesture crosses an overlapping window"
                }
            }
            return chosen
        }
        val window = target()
        diagnostic("remote-window-selected")
        val done = CountDownLatch(1)
        var visible = false
        synchronized(windowProofLock) {
            val now = SystemClock.elapsedRealtime()
            // Android rate-limits window screenshots to one per >333ms. Never reuse an old proof.
            if (lastWindowProof != Long.MIN_VALUE && now - lastWindowProof < 350)
                Thread.sleep(350 - (now - lastWindowProof))
            check(admitted()) { "Input authority ended while waiting for window proof" }
            lastWindowProof = SystemClock.elapsedRealtime()
            takeScreenshotOfWindow(window.id, captureExecutor, object : TakeScreenshotCallback {
            override fun onSuccess(result: ScreenshotResult) {
                try { result.hardwareBuffer.close(); visible = true }
                finally { done.countDown() }
            }
            override fun onFailure(errorCode: Int) {
                diagnostic("remote-window-screenshot-refused:" + errorCode)
                done.countDown()
            }
            })
        }
        check(done.await(3, TimeUnit.SECONDS) && visible) { "Input window could not be verified as non-secure" }
        diagnostic("remote-window-screenshot-confirmed")
        lastFrame = frame
        return applyManual(action) { operation ->
            gate.emit {
                requireActiveUnlocked()
                val currentWindow = target()
                check(admitted() && displayState() == expected &&
                    SystemClock.elapsedRealtime() - proofStarted in 0L..1_000L &&
                    currentWindow.id == window.id && currentWindow.bounds == window.bounds) { "Input authority or window changed" }
                diagnostic("remote-os-dispatch")
                operation()
            }
        }
    }

    private fun applyManual(action: ManualAction, emit: ((() -> Boolean) -> Boolean) = { it() }): Boolean {
        requireWorkerThread()
        requireActiveUnlocked()
        val applied = when (action) {
            ManualAction.Back -> emit { performGlobalAction(GLOBAL_ACTION_BACK) }
            ManualAction.Home -> emit { performGlobalAction(GLOBAL_ACTION_HOME) }
            ManualAction.Recents -> emit { performGlobalAction(GLOBAL_ACTION_RECENTS) }
            is ManualAction.Tap -> gesture(action.x, action.y, action.x, action.y, 80, emit)
            is ManualAction.Swipe -> gesture(action.x1, action.y1, action.x2, action.y2, action.durationMs, emit)
        }
        requireActiveUnlocked()
        return applied
    }

    private fun gesture(x1: Double, y1: Double, x2: Double, y2: Double, duration: Long,
        emit: ((() -> Boolean) -> Boolean)): Boolean {
        val state = displayState()
        val frame = lastFrame ?: error("Capture a fresh frame before input")
        val start = frame.point(x1, y1, state.width, state.height, state.rotation, SystemClock.elapsedRealtime())
        val end = frame.point(x2, y2, state.width, state.height, state.rotation, SystemClock.elapsedRealtime())
        val path = Path().apply {
            moveTo(start.x, start.y)
            lineTo(end.x, end.y)
        }
        val done = CountDownLatch(1)
        var applied = false
        val accepted = emit { dispatchGesture(GestureDescription.Builder()
            .addStroke(GestureDescription.StrokeDescription(path, 0, duration)).build(),
            object : GestureResultCallback() {
                override fun onCompleted(gestureDescription: GestureDescription?) {
                    applied = true
                    done.countDown()
                }
                override fun onCancelled(gestureDescription: GestureDescription?) { done.countDown() }
            }, Handler(Looper.getMainLooper())) }
        if (!accepted) return false
        val finished = done.await(6, TimeUnit.SECONDS)
        requireActiveUnlocked()
        check(displayState() == state) { "Display changed during input" }
        return finished && applied
    }
}
