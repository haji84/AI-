package ai.jarvis.worker

import android.Manifest
import android.app.KeyguardManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.admin.DevicePolicyManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import org.json.JSONObject

class TaskExecutor(private val context: Context) {
    private val client = BrokerClient(context)

    fun execute(task: JSONObject): Boolean {
        val taskId = task.optString("id")
        val type = task.optString("type")
        val payload = task.optJSONObject("payload") ?: JSONObject()
        if (taskId.isBlank() || type.isBlank()) return false

        if (type == "open-url") {
            val url = payload.optString("url")
            if (!url.startsWith("https://")) {
                report(taskId, false, JSONObject().put("error", "HTTPS URL required"))
                return true
            }
            val intent = Intent(context, UrlTaskActivity::class.java)
                .putExtra("task_id", taskId)
                .putExtra("url", url)
                .putExtra("allow_javascript", payload.optBoolean("allowJavaScript", false))
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            return runCatching { context.startActivity(intent); true }
                .getOrElse { report(taskId, false, JSONObject().put("error", it.message)); true }
        }

        val result = runCatching { executeSync(type, payload) }
        result.onSuccess { report(taskId, true, it) }
            .onFailure { report(taskId, false, JSONObject().put("error", it.message ?: it.javaClass.simpleName)) }
        return true
    }

    private fun executeSync(type: String, payload: JSONObject): JSONObject = when (type) {
        "open-app" -> openApp(payload)
        "launch-settings" -> launchSettings(payload)
        "wake-device" -> wakeDevice()
        "device-status" -> deviceStatus()
        "show-notification" -> showNotification(payload)
        "lock-device" -> lockDevice()
        "reboot" -> rebootDevice()
        "ui-sequence" -> uiSequence(payload)
        else -> throw IllegalArgumentException("Unsupported task type: $type")
    }

    private fun openApp(payload: JSONObject): JSONObject {
        val packageName = payload.getString("packageName")
        val launch = context.packageManager.getLaunchIntentForPackage(packageName)
            ?: throw IllegalStateException("App is not installed or has no launcher activity: $packageName")
        launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        context.startActivity(launch)
        return JSONObject().put("opened", true).put("packageName", packageName)
    }

    private fun launchSettings(payload: JSONObject): JSONObject {
        val action = when (payload.optString("screen", "settings")) {
            "accessibility" -> Settings.ACTION_ACCESSIBILITY_SETTINGS
            "wifi" -> Settings.ACTION_WIFI_SETTINGS
            "bluetooth" -> Settings.ACTION_BLUETOOTH_SETTINGS
            "app" -> Settings.ACTION_APPLICATION_DETAILS_SETTINGS
            else -> Settings.ACTION_SETTINGS
        }
        val intent = Intent(action).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        if (action == Settings.ACTION_APPLICATION_DETAILS_SETTINGS) {
            intent.data = android.net.Uri.parse("package:${context.packageName}")
        }
        context.startActivity(intent)
        return JSONObject().put("opened", true).put("screen", payload.optString("screen", "settings"))
    }

    @Suppress("DEPRECATION")
    private fun wakeDevice(): JSONObject {
        val pm = context.getSystemService(PowerManager::class.java)
            ?: throw IllegalStateException("PowerManager unavailable")
        val wakeLock = pm.newWakeLock(
            PowerManager.SCREEN_BRIGHT_WAKE_LOCK or PowerManager.ACQUIRE_CAUSES_WAKEUP,
            "jarvis:remote-wake"
        )
        wakeLock.acquire(3_000)
        return JSONObject().put("wakeRequested", true)
    }

    private fun deviceStatus(): JSONObject {
        val dpm = context.getSystemService(DevicePolicyManager::class.java)
        val keyguard = context.getSystemService(KeyguardManager::class.java)
        val admin = JarvisDeviceAdminReceiver.component(context)
        val pkg = context.packageManager.getPackageInfo(context.packageName, 0)
        return JSONObject()
            .put("packageName", context.packageName)
            .put("versionName", pkg.versionName ?: "unknown")
            .put("versionCode", if (Build.VERSION.SDK_INT >= 28) pkg.longVersionCode else pkg.versionCode.toLong())
            .put("deviceOwner", dpm?.isDeviceOwnerApp(context.packageName) == true)
            .put("adminActive", dpm?.isAdminActive(admin) == true)
            .put("accessibilityEnabled", JarvisAccessibilityService.connected())
            .put("locked", keyguard?.isDeviceLocked == true)
            .put("secure", keyguard?.isDeviceSecure == true)
    }

    private fun showNotification(payload: JSONObject): JSONObject {
        if (Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            throw IllegalStateException("Notification permission is not granted")
        }
        val manager = context.getSystemService(NotificationManager::class.java)
            ?: throw IllegalStateException("NotificationManager unavailable")
        val channelId = "jarvis_remote"
        if (Build.VERSION.SDK_INT >= 26) {
            manager.createNotificationChannel(NotificationChannel(channelId, "JARVIS", NotificationManager.IMPORTANCE_DEFAULT))
        }
        val notification = NotificationCompat.Builder(context, channelId)
            .setSmallIcon(android.R.drawable.stat_notify_more)
            .setContentTitle(payload.optString("title", "JARVIS"))
            .setContentText(payload.optString("message", "JARVISからの通知"))
            .setAutoCancel(true)
            .build()
        manager.notify(payload.optInt("id", 4100), notification)
        return JSONObject().put("shown", true)
    }

    private fun lockDevice(): JSONObject {
        val dpm = context.getSystemService(DevicePolicyManager::class.java)
            ?: throw IllegalStateException("DevicePolicyManager unavailable")
        val admin = JarvisDeviceAdminReceiver.component(context)
        if (!dpm.isAdminActive(admin)) throw IllegalStateException("JARVIS device admin is not active")
        dpm.lockNow()
        return JSONObject().put("locked", true)
    }

    private fun rebootDevice(): JSONObject {
        val dpm = context.getSystemService(DevicePolicyManager::class.java)
            ?: throw IllegalStateException("DevicePolicyManager unavailable")
        if (!dpm.isDeviceOwnerApp(context.packageName)) throw IllegalStateException("Reboot requires Device Owner enrollment")
        dpm.reboot(JarvisDeviceAdminReceiver.component(context))
        return JSONObject().put("rebootRequested", true)
    }

    private fun uiSequence(payload: JSONObject): JSONObject {
        val keyguard = context.getSystemService(KeyguardManager::class.java)
        if (keyguard?.isDeviceLocked == true) throw IllegalStateException("Device is locked; human unlock is required")
        return JarvisAccessibilityService.execute(payload)
    }

    private fun report(taskId: String, ok: Boolean, detail: JSONObject) {
        Thread { runCatching { client.taskResult(taskId, ok, detail) } }.start()
    }
}
