package app.goriq.remote.lite

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.view.Surface
import org.webrtc.CapturerObserver
import org.webrtc.SurfaceTextureHelper
import org.webrtc.ThreadUtils

/** One OS-approved projection/display, owned by the existing foreground session.
 * All display/surface state lives on the texture handler. Refresh detaches the
 * existing output briefly, then reconnects it at identical
 * geometry. Only SurfaceTexture's real on-frame callback publishes an image.
 * https://developer.android.com/reference/android/hardware/display/VirtualDisplay#setSurface(android.view.Surface)
 */
internal class AuthorizedScreenCapture(private val context: Context,
    private val consent: Intent, private val callback: MediaProjection.Callback,
    private val helper: SurfaceTextureHelper, private val observer: CapturerObserver,
    private val authorized: () -> Boolean, private val failed: () -> Unit) {
    private var projection: MediaProjection? = null
    private var display: VirtualDisplay? = null
    private var surface: Surface? = null
    private var used = false
    private var stopped = false
    private var active = false
    private var notified = false
    private val restoreSurface = Runnable {
        if (active && authorized()) {
            try { checkNotNull(display).surface = checkNotNull(surface) }
            catch (_: Exception) { failed() }
        }
    }

    fun start(width: Int, height: Int) {
        ThreadUtils.invokeAtFrontUninterruptibly(helper.handler) {
            check(!used && !stopped && authorized())
            used = true // A consent result must never create a second projection/display.
            helper.setTextureSize(width, height)
            val manager = context.getSystemService(MediaProjectionManager::class.java)
            val granted = checkNotNull(manager.getMediaProjection(Activity.RESULT_OK, consent))
                .also { projection = it }
            granted.registerCallback(callback, helper.handler)
            val output = Surface(helper.surfaceTexture).also { surface = it }
            display = checkNotNull(granted.createVirtualDisplay("remote-lite-screen", width, height, 400,
                DisplayManager.VIRTUAL_DISPLAY_FLAG_PUBLIC or DisplayManager.VIRTUAL_DISPLAY_FLAG_PRESENTATION,
                output, null, helper.handler))
            check(authorized())
            active = true
            notified = true
            observer.onCapturerStarted(true)
            helper.startListening { frame ->
                if (active && authorized()) observer.onFrameCaptured(frame)
            }
        }
    }

    fun refresh() {
        ThreadUtils.invokeAtFrontUninterruptibly(helper.handler) {
            if (!active || !authorized()) return@invokeAtFrontUninterruptibly
            helper.handler.removeCallbacks(restoreSurface)
            checkNotNull(display).surface = null
            // Separate compositor traversals: setting null and restoring within
            // one traversal can be coalesced into an unchanged surface.
            check(helper.handler.postDelayed(restoreSurface, 50))
        }
    }

    fun stop() {
        ThreadUtils.invokeAtFrontUninterruptibly(helper.handler) {
            if (stopped) return@invokeAtFrontUninterruptibly
            stopped = true
            active = false
            helper.handler.removeCallbacks(restoreSurface)
            var first: Throwable? = null
            fun release(action: () -> Unit) {
                try { action() } catch (failure: Throwable) { if (first == null) first = failure }
            }
            release { helper.stopListening() }
            if (notified) release { observer.onCapturerStopped() }
            release { display?.release() }
            display = null
            release { surface?.release() }
            surface = null
            release { projection?.unregisterCallback(callback) }
            release { projection?.stop() }
            projection = null
            first?.let { throw it }
        }
    }
}
