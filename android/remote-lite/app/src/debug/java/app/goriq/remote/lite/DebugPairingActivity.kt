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
    private var activeSessionId: String? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val status = TextView(this).apply { text = "端末の登録診断は未実行です" }
        val button = Button(this).apply { text = "ローカル登録を診断する" }
        val sessionButton = Button(this).apply { text = "セッションを診断する" }
        val checkButton = Button(this).apply { text = "状態を再確認する" }
        val sessionStatus = TextView(this).apply { text = "セッション診断は未実行です" }
        val content = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(32, 32, 32, 32)
            addView(button)
            addView(status)
            addView(sessionButton)
            addView(checkButton)
            addView(sessionStatus)
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
                        LoopbackCoordinatorExchange(port)).request(inviteCode)
                    "所有者の承認待ち 申請ID: ${receipt.requestId} 指紋: ${receipt.fingerprint}"
                }
                runOnUiThread {
                    status.text = result.getOrElse { "登録できません: ${it.message ?: "不明なエラー"}" }
                    button.isEnabled = true
                }
            }.start()
        }
        sessionButton.setOnClickListener {
            sessionButton.isEnabled = false
            sessionStatus.text = "セッションを確認しています…"
            Thread {
                val result = runCatching {
                    val access = DeviceSessionAccess(LocalIdentity(this),
                        LoopbackCoordinatorExchange(intent.getIntExtra("port", -1)))
                    val pending = checkNotNull(access.discoverPending()) { "保留セッションなし" }
                    val active = access.accept(pending)
                    check(access.verifyActive(active.sessionId).allowed) { "署名付き状態照会を拒否" }
                    activeSessionId = active.sessionId
                    "セッション有効 ID: ${active.sessionId}"
                }
                runOnUiThread {
                    sessionStatus.text = result.getOrElse { "セッション拒否: ${it.message ?: "不明なエラー"}" }
                    sessionButton.isEnabled = true
                }
            }.start()
        }
        checkButton.setOnClickListener {
            checkButton.isEnabled = false
            sessionStatus.text = "再照会しています…"
            Thread {
                val result = runCatching {
                    val session = checkNotNull(activeSessionId) { "有効セッションなし" }
                    val access = DeviceSessionAccess(LocalIdentity(this),
                        LoopbackCoordinatorExchange(intent.getIntExtra("port", -1)))
                    access.requireActiveThen(session) { "セッションは有効" }
                }
                runOnUiThread {
                    sessionStatus.text = result.getOrElse { "失効後は操作拒否" }
                    checkButton.isEnabled = true
                }
            }.start()
        }
    }
}

/** Uses HTTP only because ADB reverse reaches a loopback-only test server. */
private class LoopbackCoordinatorExchange(private val port: Int) :
    EnrollmentExchange, DeviceSessionExchange {
    init { require(port in 1..65535) { "Invalid loopback port" } }

    private fun post(path: String, payload: JSONObject): JSONObject? {
        val connection = URL("http://127.0.0.1:$port$path").openConnection() as HttpURLConnection
        try {
            connection.requestMethod = "POST"
            connection.instanceFollowRedirects = false
            connection.connectTimeout = 5_000
            connection.readTimeout = 5_000
            connection.setRequestProperty("Content-Type", "application/json")
            connection.doOutput = true
            val body = payload.toString().toByteArray(Charsets.UTF_8)
            require(body.size <= 4096) { "Coordinator request too large" }
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
            check(response.getBoolean("ok")) { "Coordinator rejected request" }
            return response.optJSONObject("result")
        } finally {
            connection.disconnect()
        }
    }

    override fun propose(code: String, deviceId: String, publicKeyPem: String): EnrollmentChallenge {
        val result = post("/v1/device/propose", JSONObject()
            .put("inviteCode", code).put("deviceId", deviceId).put("publicKeyPem", publicKeyPem))
            ?: error("Missing proposal")
        return EnrollmentChallenge(result.getString("requestId"), result.getString("challenge"),
            result.getString("fingerprint"), result.getLong("expiresAt"))
    }

    override fun prove(requestId: String, signature: String): EnrollmentReceipt {
        val result = post("/v1/device/prove", JSONObject()
            .put("requestId", requestId).put("signature", signature))
            ?: error("Missing proof receipt")
        return EnrollmentReceipt(result.getString("requestId"), result.getString("deviceId"),
            result.getString("fingerprint"), result.getString("status"))
    }

    override fun pending(id: String, proof: DiscoveryProof): DeviceSessionView? =
        post("/v1/device/pending", JSONObject().put("deviceId", id).put("proof", JSONObject()
            .put("deviceId", proof.deviceId).put("issuedAt", proof.issuedAt)
            .put("nonce", proof.nonce).put("signature", proof.signature)))?.let(::view)

    override fun challenge(id: String, operation: String, session: String): DeviceSessionChallenge {
        val result = post("/v1/device/challenge", JSONObject().put("deviceId", id)
            .put("operation", operation).put("sessionId", session)) ?: error("Missing challenge")
        return DeviceSessionChallenge(result.getString("challengeId"),
            result.getString("challenge"), result.getLong("expiresAt"))
    }

    override fun accept(session: String, id: String, proof: DeviceSessionProof): DeviceSessionView =
        view(post("/v1/device/accept", JSONObject().put("sessionId", session)
            .put("deviceId", id).put("proof", proofJson(proof))) ?: error("Missing acceptance"))

    override fun status(session: String, id: String, proof: DeviceSessionProof): DeviceSessionView =
        view(post("/v1/device/status", JSONObject().put("sessionId", session)
            .put("deviceId", id).put("proof", proofJson(proof))) ?: error("Missing status"))

    private fun proofJson(proof: DeviceSessionProof) = JSONObject()
        .put("deviceId", proof.deviceId).put("operation", proof.operation)
        .put("sessionId", proof.sessionId).put("challengeId", proof.challengeId)
        .put("payloadHash", proof.payloadHash).put("signature", proof.signature)

    private fun view(result: JSONObject) = DeviceSessionView(result.getString("sessionId"),
        result.getString("deviceId"), result.getString("status"), result.getLong("expiresAt"))
}
