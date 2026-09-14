package ai.jarvis.worker

import android.app.KeyguardManager
import android.app.admin.DevicePolicyManager
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.BatteryManager
import android.os.Build
import android.os.PowerManager
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.time.Instant
import java.util.UUID

class BrokerClient(private val context: Context) {
    private val prefs = context.getSharedPreferences("jarvis_config", Context.MODE_PRIVATE)
    private val identity = DeviceIdentity(context)

    var brokerUrl: String
        get() = prefs.getString("broker_url", "") ?: ""
        set(value) = prefs.edit().putString("broker_url", value.trimEnd('/')).apply()

    fun enroll(token: String): JSONObject = enrollWithCredential("token", token)
    fun enrollGrant(grant: String): JSONObject = enrollWithCredential("grant", grant)

    private fun enrollWithCredential(name: String, value: String): JSONObject {
        val body = JSONObject()
            .put(name, value)
            .put("node", deviceDescriptor())
            .put("identity", JSONObject()
                .put("algorithm", "ecdsa-p256-sha256")
                .put("publicKeyPem", identity.publicKeyPem()))
            .toString()
            .toByteArray(Charsets.UTF_8)
        return request("POST", "/api/jarvis/enroll", body, signed = false)
    }

    fun heartbeat(): JSONObject {
        val battery = context.getSystemService(BatteryManager::class.java)
        val dpm = context.getSystemService(DevicePolicyManager::class.java)
        val keyguard = context.getSystemService(KeyguardManager::class.java)
        val power = context.getSystemService(PowerManager::class.java)
        val admin = JarvisDeviceAdminReceiver.component(context)
        val runtime = WorkerRuntimeState.snapshot()
        val pkg = context.packageManager.getPackageInfo(context.packageName, 0)
        val body = JSONObject()
            .put("status", if (runtime.optBoolean("working")) "working" else "ready")
            .put("capabilities", capabilities())
            .put("telemetry", JSONObject()
                .put("batteryPercent", battery?.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY) ?: JSONObject.NULL)
                .put("charging", charging())
                .put("network", networkState())
                .put("screenInteractive", power?.isInteractive == true)
                .put("currentPackage", JarvisAccessibilityService.currentPackageName())
                .put("workerVersion", pkg.versionName ?: "unknown")
                .put("workerVersionCode", if (Build.VERSION.SDK_INT >= 28) pkg.longVersionCode else pkg.versionCode.toLong())
                .put("deviceOwner", dpm?.isDeviceOwnerApp(context.packageName) == true)
                .put("adminActive", dpm?.isAdminActive(admin) == true)
                .put("accessibilityEnabled", JarvisAccessibilityService.connected())
                .put("locked", keyguard?.isDeviceLocked == true)
                .put("runtime", runtime)
                .put("checkedAt", Instant.now().toString()))
            .toString()
            .toByteArray(Charsets.UTF_8)
        return request("POST", "/api/jarvis/worker/heartbeat", body, signed = true)
    }

    private fun charging(): Boolean {
        val intent = context.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED)) ?: return false
        return when (intent.getIntExtra(BatteryManager.EXTRA_STATUS, -1)) {
            BatteryManager.BATTERY_STATUS_CHARGING, BatteryManager.BATTERY_STATUS_FULL -> true
            else -> false
        }
    }

    private fun networkState(): JSONObject {
        val cm = context.getSystemService(ConnectivityManager::class.java)
            ?: return JSONObject().put("connected", false).put("transport", "unknown")
        val network = cm.activeNetwork ?: return JSONObject().put("connected", false).put("transport", "none")
        val caps = cm.getNetworkCapabilities(network)
            ?: return JSONObject().put("connected", false).put("transport", "unknown")
        val transport = when {
            caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) -> "wifi"
            caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) -> "cellular"
            caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) -> "ethernet"
            caps.hasTransport(NetworkCapabilities.TRANSPORT_VPN) -> "vpn"
            else -> "other"
        }
        return JSONObject()
            .put("connected", caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET))
            .put("validated", caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED))
            .put("transport", transport)
    }

    fun nextTask(): JSONObject = request("POST", "/api/jarvis/worker/next", "{}".toByteArray(), signed = true)

    fun taskResult(taskId: String, ok: Boolean, detail: JSONObject): JSONObject {
        val body = JSONObject()
            .put("taskId", taskId)
            .put("ok", ok)
            .put("detail", detail)
            .toString()
            .toByteArray(Charsets.UTF_8)
        return request("POST", "/api/jarvis/worker/result", body, signed = true)
    }

    private fun capabilities(): JSONArray {
        val dpm = context.getSystemService(DevicePolicyManager::class.java)
        val admin = JarvisDeviceAdminReceiver.component(context)
        val values = mutableListOf(
            "browser", "open-url", "open-app", "launch-settings", "wake-device",
            "device-status", "show-notification", "background-worker", "self-update", "workflow-recipe"
        )
        if (JarvisAccessibilityService.connected()) values += listOf(
            "ui-automation", "sheet-cell-navigation", "visible-url-open", "screen-verification"
        )
        if (dpm?.isAdminActive(admin) == true) values += "lock-device"
        if (dpm?.isDeviceOwnerApp(context.packageName) == true) values += listOf("device-owner", "reboot")
        return JSONArray(values)
    }

    private fun deviceDescriptor(): JSONObject {
        val dpm = context.getSystemService(DevicePolicyManager::class.java)
        val enrollment = if (dpm?.isDeviceOwnerApp(context.packageName) == true) "full" else "quick"
        return JSONObject()
            .put("id", identity.nodeId)
            .put("label", "${Build.MANUFACTURER} ${Build.MODEL}")
            .put("kind", "android")
            .put("status", "ready")
            .put("capabilities", capabilities())
            .put("policy", JSONObject()
                .put("allowPaidServices", false)
                .put("allowDestructiveActions", false)
                .put("allowExternalPublication", false)
                .put("allowRemoteControl", JarvisAccessibilityService.connected())
                .put("requireHumanForLockedDevice", true))
            .put("telemetry", JSONObject().put("checkedAt", Instant.now().toString()))
            .put("enrollment", enrollment)
            .put("lastSeenAt", Instant.now().toString())
    }

    private fun request(method: String, path: String, body: ByteArray, signed: Boolean): JSONObject {
        require(brokerUrl.startsWith("https://") || brokerUrl.startsWith("http://192.168.") || brokerUrl.startsWith("http://10.") || brokerUrl.startsWith("http://172.")) {
            "Broker must use HTTPS, except private-LAN development addresses"
        }
        val connection = URL("$brokerUrl$path").openConnection() as HttpURLConnection
        connection.requestMethod = method
        connection.connectTimeout = 10_000
        connection.readTimeout = 20_000
        connection.doOutput = true
        connection.setRequestProperty("Content-Type", "application/json")

        if (signed) {
            val timestamp = Instant.now().toString()
            val nonce = UUID.randomUUID().toString()
            val bodySha = identity.bodySha256(body)
            val canonical = listOf(identity.nodeId, timestamp, nonce, method.uppercase(), path, bodySha).joinToString("\n")
            connection.setRequestProperty("X-Jarvis-Node-Id", identity.nodeId)
            connection.setRequestProperty("X-Jarvis-Timestamp", timestamp)
            connection.setRequestProperty("X-Jarvis-Nonce", nonce)
            connection.setRequestProperty("X-Jarvis-Body-Sha256", bodySha)
            connection.setRequestProperty("X-Jarvis-Signature", identity.signCanonical(canonical))
        }

        connection.outputStream.use { it.write(body) }
        val code = connection.responseCode
        val stream = if (code in 200..299) connection.inputStream else connection.errorStream
        val text = stream?.bufferedReader()?.use { it.readText() }.orEmpty()
        if (code !in 200..299) throw IllegalStateException("JARVIS broker HTTP $code: $text")
        return if (text.isBlank()) JSONObject() else JSONObject(text)
    }
}
