package ai.jarvis.worker

import android.app.*
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.PixelFormat
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.media.ImageReader
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.os.*
import android.util.DisplayMetrics
import android.view.WindowManager
import androidx.core.app.NotificationCompat
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/** API26–29 only. Consent is never persisted or replayed on boot. */
class LegacyScreenService : Service() {
    private var projection: MediaProjection? = null
    private var display: VirtualDisplay? = null
    private var reader: ImageReader? = null
    private var thread: HandlerThread? = null
    private var handler: Handler? = null
    private var width = 0
    private var height = 0
    @Volatile private var pending: Capture? = null
    private class Capture(val deadline: Long) {
        val done = CountDownLatch(1)
        @Volatile var result: JSONObject? = null
    }
    companion object {
        @Volatile private var current: LegacyScreenService? = null
        fun available(): Boolean = current != null
        fun capture(): JSONObject = (current ?: error("画面共有を許可してください")).captureFrame()
    }
    override fun onBind(intent: Intent?) = null
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == "stop" || Build.VERSION.SDK_INT !in 26..29 || intent == null) {
            stopSelf(); return START_NOT_STICKY
        }
        if (projection != null) return START_NOT_STICKY
        val manager = getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(NotificationChannel("jarvis-screen", "JARVIS画面共有", NotificationManager.IMPORTANCE_LOW))
        val stop = PendingIntent.getService(this, 859, Intent(this, LegacyScreenService::class.java).setAction("stop"), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val notification = NotificationCompat.Builder(this, "jarvis-screen")
            .setSmallIcon(android.R.drawable.ic_menu_view).setContentTitle("JARVIS画面共有中")
            .setContentText("所有者が画面を確認できます。停止すると遠隔操作も停止します")
            .setOngoing(true).addAction(android.R.drawable.ic_menu_close_clear_cancel, "共有を停止", stop).build()
        if (Build.VERSION.SDK_INT >= 29) startForeground(859, notification, android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION)
        else startForeground(859, notification)
        try {
            @Suppress("DEPRECATION") val data = intent.getParcelableExtra<Intent>("consent") ?: error("Missing consent")
            require(intent.getIntExtra("result", 0) == Activity.RESULT_OK)
            thread = HandlerThread("jarvis-screen").also { it.start() }
            handler = Handler(thread!!.looper)
            val metrics = DisplayMetrics()
            @Suppress("DEPRECATION")
            getSystemService(WindowManager::class.java).defaultDisplay.getRealMetrics(metrics)
            width = metrics.widthPixels; height = metrics.heightPixels
            require(width > 0 && height > 0 && width.toLong() * height <= 8_000_000)
            projection = getSystemService(MediaProjectionManager::class.java).getMediaProjection(Activity.RESULT_OK, data)
            projection!!.registerCallback(object : MediaProjection.Callback() {
                override fun onStop() { current = null; stopSelf() }
            }, Handler(Looper.getMainLooper()))
            // An idle reader may never receive another frame from a static screen.
            // Attach a new drawing surface for each owner capture request instead.
            display = projection!!.createVirtualDisplay("JARVIS owner view", width, height, metrics.densityDpi,
                DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR, null, null, handler)
            current = this
        } catch (_: Exception) { current = null; stopSelf() }
        return START_NOT_STICKY
    }
    // Capture handler only. A fresh BufferQueue requests the current composition;
    // pixels queued for an earlier request can never satisfy this request.
    private fun requestFrame(request: Capture) {
        display?.surface = null
        reader?.setOnImageAvailableListener(null, null)
        reader?.close()
        reader = null
        val nextReader = ImageReader.newInstance(width, height, PixelFormat.RGBA_8888, 2)
        reader = nextReader
        pending = request
        nextReader.setOnImageAvailableListener({ source ->
                if (reader !== source || pending !== request || current !== this) return@setOnImageAvailableListener
                val image = source.acquireLatestImage() ?: return@setOnImageAvailableListener
                image.use {
                    if (SystemClock.elapsedRealtime() > request.deadline || current !== this ||
                        getSystemService(KeyguardManager::class.java).isDeviceLocked) return@use
                    try {
                        val plane = image.planes[0]
                        val paddedWidth = plane.rowStride / plane.pixelStride
                        val padded = Bitmap.createBitmap(paddedWidth, height, Bitmap.Config.ARGB_8888)
                        try {
                            padded.copyPixelsFromBuffer(plane.buffer)
                            val bitmap = Bitmap.createBitmap(padded, 0, 0, width, height)
                            try {
                                val stream = ByteArrayOutputStream()
                                bitmap.compress(Bitmap.CompressFormat.JPEG, 55, stream)
                                val bytes = stream.toByteArray()
                                require(bytes.size <= 650_000)
                                request.result = JSONObject().put("ok", true).put("mimeType", "image/jpeg")
                                    .put("nativeWidth", width).put("nativeHeight", height)
                                    .put("capturedAt", java.time.Instant.now().toString())
                                    .put("imageBase64", android.util.Base64.encodeToString(bytes, android.util.Base64.NO_WRAP))
                            } finally { if (bitmap !== padded) bitmap.recycle() }
                        } finally { padded.recycle() }
                    } catch (_: Exception) { /* Fail visibly; never serve a previous frame. */ }
                    finally { if (pending === request) pending = null; request.done.countDown() }
                }
            }, handler)
        checkNotNull(display).surface = nextReader.surface
    }
    @Synchronized private fun captureFrame(): JSONObject {
        require(current === this)
        // A changed orientation requires renewed consent; never return misaligned coordinates.
        val metrics = DisplayMetrics()
        @Suppress("DEPRECATION")
        getSystemService(WindowManager::class.java).defaultDisplay.getRealMetrics(metrics)
        if (metrics.widthPixels != width || metrics.heightPixels != height) {
            current = null; stopSelf(); error("画面の向きが変わりました。画面共有を再開してください")
        }
        val request = Capture(SystemClock.elapsedRealtime() + 2_500)
        // Serialize surface replacement with image delivery on the capture handler.
        check(handler?.post {
            if (current === this && SystemClock.elapsedRealtime() < request.deadline) {
                try { requestFrame(request) }
                catch (_: Exception) {
                    if (pending === request) pending = null
                    request.done.countDown()
                }
            } else request.done.countDown()
        } == true)
        try {
            check(request.done.await(2500, TimeUnit.MILLISECONDS)) { "Screen capture timed out" }
            check(current === this && !getSystemService(KeyguardManager::class.java).isDeviceLocked)
            return request.result ?: error("Screen capture unavailable")
        } finally { if (pending === request) pending = null }
    }
    override fun onDestroy() {
        if (current === this) current = null
        pending?.done?.countDown(); pending = null
        reader?.setOnImageAvailableListener(null, null)
        display?.release(); display = null
        projection?.stop(); projection = null
        reader?.close(); reader = null
        thread?.quitSafely(); thread = null
        super.onDestroy()
    }
}
