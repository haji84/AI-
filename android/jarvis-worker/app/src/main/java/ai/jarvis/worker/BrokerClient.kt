package ai.jarvis.worker

import android.content.Context
import android.os.BatteryManager
import android.os.Build
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

    fun enroll(token: String): JSONObject {
        val body = JSONObject()
            .put("token", token)
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
        val body = JSONObject()
            .put("status", "ready")
            .put("telemetry", JSONObject()
                .put("batteryPercent", battery?.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY) ?: JSONObject.NULL)
                .put("checkedAt", Instant.now().toString()))
            .toString()
            .toByteArray(Charsets.UTF_8)
        return request("POST", "/api/jarvis/worker/heartbeat", body, signed = true)
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

    private fun deviceDescriptor(): JSONObject = JSONObject()
        .put("id", identity.nodeId)
        .put("label", "${Build.MANUFACTURER} ${Build.MODEL}")
        .put("kind", "android")
        .put("status", "ready")
        .put("capabilities", JSONArray(listOf("browser", "open-url", "wake-device", "background-worker")))
        .put("policy", JSONObject()
            .put("allowPaidServices", false)
            .put("allowDestructiveActions", false)
            .put("allowExternalPublication", false)
            .put("allowRemoteControl", false)
            .put("requireHumanForLockedDevice", true))
        .put("telemetry", JSONObject().put("checkedAt", Instant.now().toString()))
        .put("enrollment", "quick")
        .put("lastSeenAt", Instant.now().toString())

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
