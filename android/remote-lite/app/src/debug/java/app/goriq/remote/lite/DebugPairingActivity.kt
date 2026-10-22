package app.goriq.remote.lite

import android.app.Activity
import android.os.Bundle
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import java.io.ByteArrayOutputStream
import java.net.HttpURLConnection
import java.net.URL
import org.json.JSONObject

/** Debug-only integration path for the Android VM and a loopback Node coordinator. */
class DebugPairingActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val status = TextView(this).apply { text = "端末の登録診断は未実行です" }
        val button = Button(this).apply { text = "ローカル登録を診断する" }
        val content = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(32, 32, 32, 32)
            addView(button)
            addView(status)
        }
        setContentView(content)
        button.setOnClickListener {
            button.isEnabled = false
            status.text = "登録を確認しています…"
            Thread {
                val result = runCatching {
                    val port = intent.getIntExtra("port", -1)
                    val inviteCode = intent.getStringExtra("inviteCode") ?: ""
                    val receipt = DeviceEnrollment(LocalIdentity(this),
                        LoopbackEnrollmentExchange(port)).request(inviteCode)
                    "所有者の承認待ち 申請ID: ${receipt.requestId} 指紋: ${receipt.fingerprint}"
                }
                runOnUiThread {
                    status.text = result.getOrElse { "登録できません: ${it.message ?: "不明なエラー"}" }
                    button.isEnabled = true
                }
            }.start()
        }
    }
}

/** Uses HTTP only because ADB reverse reaches a loopback-only test server. */
private class LoopbackEnrollmentExchange(private val port: Int) : EnrollmentExchange {
    init { require(port in 1..65535) { "Invalid loopback port" } }

    private fun post(path: String, payload: JSONObject): JSONObject {
        val connection = URL("http://127.0.0.1:$port$path").openConnection() as HttpURLConnection
        try {
            connection.requestMethod = "POST"
            connection.instanceFollowRedirects = false
            connection.connectTimeout = 5_000
            connection.readTimeout = 5_000
            connection.setRequestProperty("Content-Type", "application/json")
            connection.doOutput = true
            val body = payload.toString().toByteArray(Charsets.UTF_8)
            require(body.size <= 4096) { "Enrollment request too large" }
            connection.outputStream.use { it.write(body) }
            check(connection.responseCode == 200) { "Coordinator rejected $path (${connection.responseCode})" }
            check(connection.contentType?.startsWith("application/json") == true) {
                "Invalid coordinator content type"
            }
            val bounded = ByteArrayOutputStream()
            connection.inputStream.use { input ->
                val buffer = ByteArray(4096)
                while (true) {
                    val count = input.read(buffer)
                    if (count < 0) break
                    check(bounded.size() + count <= 16_384) { "Coordinator response too large" }
                    bounded.write(buffer, 0, count)
                }
            }
            val response = JSONObject(bounded.toString(Charsets.UTF_8.name()))
            check(response.getBoolean("ok")) { "Coordinator rejected enrollment" }
            return response.getJSONObject("result")
        } finally {
            connection.disconnect()
        }
    }

    override fun propose(code: String, deviceId: String, publicKeyPem: String): EnrollmentChallenge {
        val result = post("/v1/device/propose", JSONObject()
            .put("inviteCode", code).put("deviceId", deviceId).put("publicKeyPem", publicKeyPem))
        return EnrollmentChallenge(result.getString("requestId"), result.getString("challenge"),
            result.getString("fingerprint"), result.getLong("expiresAt"))
    }

    override fun prove(requestId: String, signature: String): EnrollmentReceipt {
        val result = post("/v1/device/prove", JSONObject()
            .put("requestId", requestId).put("signature", signature))
        return EnrollmentReceipt(result.getString("requestId"), result.getString("deviceId"),
            result.getString("fingerprint"), result.getString("status"))
    }
}
