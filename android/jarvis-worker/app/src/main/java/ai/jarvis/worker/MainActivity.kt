package ai.jarvis.worker

import android.content.Intent
import android.os.Bundle
import android.provider.Settings
import android.view.View
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import org.json.JSONObject
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

class MainActivity : AppCompatActivity() {
    private val active = AtomicBoolean(false)
    private lateinit var status: TextView
    private lateinit var brokerField: EditText
    private lateinit var tokenField: EditText
    private lateinit var manualEnrollButton: Button
    private lateinit var advancedButton: Button
    private lateinit var updateButton: Button
    private var latestUpdate: UpdateManager.UpdateInfo? = null
    private var waitingForInstallPermission = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        status = TextView(this).apply { text = "未登録" }
        val guide = TextView(this).apply { text = "管理者から届いたJARVIS登録リンクを1回タップすると、自動で登録されます。" }
        updateButton = Button(this).apply {
            visibility = View.GONE
            setOnClickListener { beginUpdate() }
        }
        brokerField = EditText(this).apply {
            hint = "https://JARVIS broker"
            visibility = View.GONE
        }
        tokenField = EditText(this).apply {
            hint = "Enrollment token"
            visibility = View.GONE
        }
        manualEnrollButton = Button(this).apply {
            text = "手動で登録"
            visibility = View.GONE
            setOnClickListener { enrollToken(brokerField.text.toString(), tokenField.text.toString()) }
        }
        advancedButton = Button(this).apply {
            text = "管理者向け詳細設定"
            setOnClickListener { toggleAdvanced() }
        }
        val settings = Button(this).apply {
            text = "端末設定を開く"
            setOnClickListener { startActivity(Intent(Settings.ACTION_SETTINGS)) }
        }
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(32, 48, 32, 32)
            addView(status)
            addView(guide)
            addView(updateButton)
            addView(advancedButton)
            addView(brokerField)
            addView(tokenField)
            addView(manualEnrollButton)
            addView(settings)
        }
        setContentView(root)

        val enrollmentLink = intent?.data
        if (enrollmentLink != null) handleEnrollmentIntent(intent) else verifyCurrentEnrollment()
        scheduleFallbackWorker()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleEnrollmentIntent(intent)
    }

    override fun onResume() {
        super.onResume()
        active.set(true)
        if (waitingForInstallPermission && UpdateManager(this).canRequestPackageInstalls() && latestUpdate != null) {
            waitingForInstallPermission = false
            installLatestUpdate()
        }
        startActivePollingLoop()
    }

    override fun onPause() {
        active.set(false)
        super.onPause()
    }

    private fun verifyCurrentEnrollment() {
        val client = BrokerClient(this)
        if (client.brokerUrl.isBlank()) {
            status.text = "未登録"
            return
        }
        status.text = "登録状態を確認中"
        Thread {
            runCatching { client.heartbeat() }
                .onSuccess {
                    runOnUiThread { status.text = "登録完了" }
                    checkForUpdate()
                }
                .onFailure { runOnUiThread { status.text = "未登録" } }
        }.start()
    }

    private fun checkForUpdate() {
        val client = BrokerClient(this)
        if (client.brokerUrl.isBlank()) return
        Thread {
            runCatching { UpdateManager(this).checkForUpdate(client.brokerUrl) }
                .onSuccess { info ->
                    latestUpdate = info
                    runOnUiThread {
                        if (info == null) {
                            updateButton.visibility = View.GONE
                        } else {
                            updateButton.text = "JARVISを更新（${info.versionName}）"
                            updateButton.visibility = View.VISIBLE
                        }
                    }
                }
        }.start()
    }

    private fun beginUpdate() {
        val info = latestUpdate ?: return
        val manager = UpdateManager(this)
        if (!manager.canRequestPackageInstalls()) {
            waitingForInstallPermission = true
            status.text = "更新許可をオンにしてください"
            manager.openInstallPermissionSettings()
            return
        }
        status.text = "更新を準備中"
        installLatestUpdate()
    }

    private fun installLatestUpdate() {
        val info = latestUpdate ?: return
        Thread {
            runCatching { UpdateManager(this).install(info) }
                .onFailure { error -> runOnUiThread { status.text = "更新失敗: ${error.message}" } }
        }.start()
    }

    private fun handleEnrollmentIntent(source: Intent?) {
        val link = source?.data ?: return
        if (link.scheme != "jarvis" || link.host != "enroll") return
        val brokerUrl = link.getQueryParameter("broker").orEmpty()
        val grant = link.getQueryParameter("grant").orEmpty()
        val token = link.getQueryParameter("token").orEmpty()
        if (brokerUrl.isBlank()) {
            status.text = "登録リンクが無効です"
            return
        }
        when {
            grant.isNotBlank() -> enrollGrant(brokerUrl, grant)
            token.isNotBlank() -> enrollToken(brokerUrl, token)
            else -> status.text = "登録リンクが無効です"
        }
    }

    private fun toggleAdvanced() {
        val show = brokerField.visibility != View.VISIBLE
        val visibility = if (show) View.VISIBLE else View.GONE
        brokerField.visibility = visibility
        tokenField.visibility = visibility
        manualEnrollButton.visibility = visibility
        advancedButton.text = if (show) "詳細設定を閉じる" else "管理者向け詳細設定"
    }

    private fun enrollToken(brokerUrl: String, token: String) = enroll(brokerUrl) { it.enroll(token) }
    private fun enrollGrant(brokerUrl: String, grant: String) = enroll(brokerUrl) { it.enrollGrant(grant) }

    private fun enroll(brokerUrl: String, action: (BrokerClient) -> JSONObject) {
        if (brokerUrl.isBlank()) {
            status.text = "登録リンクが無効です"
            return
        }
        status.text = "登録中"
        Thread {
            runCatching {
                val client = BrokerClient(this)
                client.brokerUrl = brokerUrl
                action(client)
            }.onSuccess {
                runOnUiThread { status.text = "登録完了" }
                checkForUpdate()
            }.onFailure { error ->
                val expired = error.message?.contains("expired", ignoreCase = true) == true ||
                    error.message?.contains("invalid", ignoreCase = true) == true ||
                    error.message?.contains("limit", ignoreCase = true) == true
                runOnUiThread { status.text = if (expired) "リンク期限切れ" else "登録失敗: ${error.message}" }
            }
        }.start()
    }

    private fun startActivePollingLoop() {
        Thread {
            while (active.get()) {
                runCatching { pollOnce() }
                Thread.sleep(5_000)
            }
        }.start()
    }

    private fun pollOnce() {
        val client = BrokerClient(this)
        if (client.brokerUrl.isBlank()) return
        client.heartbeat()
        val response = client.nextTask()
        val task = response.optJSONObject("task") ?: return
        executeTask(task)
    }

    private fun executeTask(task: JSONObject) {
        when (task.optString("type")) {
            "open-url" -> {
                val url = task.optJSONObject("payload")?.optString("url").orEmpty()
                if (url.startsWith("https://")) {
                    startActivity(Intent(this, UrlTaskActivity::class.java)
                        .putExtra("task_id", task.getString("id"))
                        .putExtra("url", url)
                        .putExtra("allow_javascript", task.optJSONObject("payload")?.optBoolean("allowJavaScript", false) == true))
                }
            }
        }
    }

    private fun scheduleFallbackWorker() {
        val constraints = Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()
        val request = PeriodicWorkRequestBuilder<JarvisPollWorker>(15, TimeUnit.MINUTES)
            .setConstraints(constraints)
            .build()
        WorkManager.getInstance(this).enqueueUniquePeriodicWork("jarvis-worker-fallback", ExistingPeriodicWorkPolicy.KEEP, request)
    }
}
