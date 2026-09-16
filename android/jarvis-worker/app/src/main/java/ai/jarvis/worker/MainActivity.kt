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
    private lateinit var automationStatus: TextView
    private lateinit var brokerField: EditText
    private lateinit var tokenField: EditText
    private lateinit var manualEnrollButton: Button
    private lateinit var advancedButton: Button
    private lateinit var updateButton: Button
    private var latestUpdate: UpdateManager.UpdateInfo? = null
    private var waitingForInstallPermission = false
    private val enrollmentInProgress = AtomicBoolean(false)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        status = TextView(this).apply { text = "未登録" }
        val guide = TextView(this).apply { text = "登録済みなら自動で再接続します。初回は所有者から届いた専用リンクの「登録する」を押してください。USBやPCでの受付操作は不要です。" }
        val retryEnrollment = Button(this).apply {
            text = "登録・接続を再確認"
            setOnClickListener { verifyCurrentEnrollment() }
        }
        automationStatus = TextView(this).apply { text = "自動操作: 確認中" }
        val automationSettings = Button(this).apply {
            text = "自動操作を有効化"
            setOnClickListener { startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)) }
        }
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
        val installedVersion = runCatching {
            packageManager.getPackageInfo(packageName, 0).versionName ?: "unknown"
        }.getOrDefault("unknown")
        val version = TextView(this).apply {
            text = "JARVIS Worker v$installedVersion"
            textSize = 12f
            alpha = 0.65f
            setPadding(0, 24, 0, 0)
        }
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(32, 48, 32, 32)
            addView(status)
            addView(guide)
            addView(retryEnrollment)
            addView(automationStatus)
            addView(automationSettings)
            addView(updateButton)
            addView(advancedButton)
            addView(brokerField)
            addView(tokenField)
            addView(manualEnrollButton)
            addView(settings)
            addView(version)
        }
        setContentView(root)

        val enrollmentLink = intent?.data
        if (enrollmentLink != null) handleEnrollmentIntent(intent) else verifyCurrentEnrollment()
        scheduleFallbackWorker()
        ensureCommandService()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleEnrollmentIntent(intent)
    }

    override fun onResume() {
        super.onResume()
        active.set(true)
        verifyCurrentEnrollment()
        automationStatus.text = if (JarvisAccessibilityService.connected()) "自動操作: 有効" else "自動操作: 未有効"
        if (waitingForInstallPermission && UpdateManager(this).canRequestPackageInstalls() && latestUpdate != null) {
            waitingForInstallPermission = false
            installLatestUpdate()
        }
        ensureCommandService()
        startActivePollingLoop()
    }

    override fun onPause() {
        active.set(false)
        super.onPause()
    }

    private fun ensureCommandService() {
        val client = BrokerClient(this)
        if (client.brokerUrl.isBlank()) return
        runCatching { JarvisCommandService.start(this) }
    }

    private fun verifyCurrentEnrollment() {
        if (!enrollmentInProgress.compareAndSet(false, true)) return
        val client = BrokerClient(this)
        if (client.brokerUrl.isBlank()) {
            val bootstrap = BuildConfig.ENROLLMENT_BOOTSTRAP_URL
            if (bootstrap.isBlank()) {
                status.text = "接続先の準備が必要です。JARVISの端末登録画面から登録リンクを開いてください。"
                enrollmentInProgress.set(false)
                return
            }
            try {
                client.brokerUrl = EnrollmentBootstrap.validatedOrigin(bootstrap)
            } catch (_: Exception) {
                status.text = "JARVISの接続先設定が無効です"
                enrollmentInProgress.set(false)
                return
            }
        }
        status.text = "登録状態を確認中"
        Thread {
            runCatching {
                try {
                    client.heartbeat()
                } catch (error: BrokerHttpException) {
                    val prefs = getSharedPreferences("jarvis_config", MODE_PRIVATE)
                    // Network failures and previously registered identities must never mint grants.
                    if (error.statusCode != 401 || prefs.getBoolean("enrollment_verified", false) ||
                        client.brokerUrl != BuildConfig.ENROLLMENT_BOOTSTRAP_URL.trimEnd('/')) throw error
                    runOnUiThread { status.text = "JARVISへ自動登録中" }
                    client.enrollFromPairingWindow()
                    client.heartbeat()
                }
                getSharedPreferences("jarvis_config", MODE_PRIVATE).edit().putBoolean("enrollment_verified", true).apply()
            }
                .onSuccess {
                    runCatching { JarvisCommandService.start(this) }
                    runOnUiThread { status.text = "登録完了" }
                    checkForUpdate()
                }
                .onFailure { error ->
                    runOnUiThread {
                        status.text = when ((error as? BrokerHttpException)?.statusCode) {
                            503 -> "まだ登録されていません。所有者の専用リンクを開いて「登録する」を押してください。アプリのインストールだけでは登録は完了しません。"
                            401 -> "端末の認証を確認できません。JARVISの端末登録画面を確認してください。"
                            else -> "JARVISへ接続できません。家のWi-Fiとホストの起動を確認して再確認してください。"
                        }
                    }
                }
            enrollmentInProgress.set(false)
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
        if (brokerUrl.isBlank() && grant.isBlank() && token.isBlank()) {
            verifyCurrentEnrollment()
            return
        }
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
        if (!enrollmentInProgress.compareAndSet(false, true)) return
        status.text = "登録中"
        Thread {
            runCatching {
                val client = BrokerClient(this)
                val previousBroker = client.brokerUrl
                val destination = EnrollmentBootstrap.validatedOrigin(brokerUrl)
                val verified = getSharedPreferences("jarvis_config", MODE_PRIVATE).getBoolean("enrollment_verified", false)
                require(!verified || previousBroker == destination) { "登録済み端末の接続先変更は所有者の確認が必要です" }
                client.brokerUrl = destination
                // Reopening an invitation must reconnect an existing signed identity,
                // not consume another slot or overwrite its key.
                try { client.heartbeat() }
                catch (error: BrokerHttpException) {
                    if (error.statusCode != 401) throw error
                    require(!verified) { "登録済み端末の認証を確認できません。再登録せず所有者へ確認してください" }
                    action(client)
                }
                client.heartbeat()
                getSharedPreferences("jarvis_config", MODE_PRIVATE).edit().putBoolean("enrollment_verified", true).apply()
            }.onSuccess {
                runCatching { JarvisCommandService.start(this) }
                runOnUiThread { status.text = "登録完了" }
                checkForUpdate()
            }.onFailure { error ->
                val expired = (error as? BrokerHttpException)?.statusCode == 410 || error.message?.contains("expired", ignoreCase = true) == true ||
                    error.message?.contains("invalid", ignoreCase = true) == true ||
                    error.message?.contains("limit", ignoreCase = true) == true
                runOnUiThread { status.text = if (expired) "リンク期限切れ" else "登録失敗: ${error.message}" }
            }
            enrollmentInProgress.set(false)
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
        TaskExecutor(this).execute(task)
    }

    private fun scheduleFallbackWorker() {
        val constraints = Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()
        val request = PeriodicWorkRequestBuilder<JarvisPollWorker>(15, TimeUnit.MINUTES)
            .setConstraints(constraints)
            .build()
        WorkManager.getInstance(this).enqueueUniquePeriodicWork("jarvis-worker-fallback", ExistingPeriodicWorkPolicy.KEEP, request)
    }
}
