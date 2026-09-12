package ai.jarvis.worker

import android.content.Intent
import android.os.Bundle
import android.provider.Settings
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

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val broker = EditText(this).apply { hint = "https://JARVIS broker" }
        val token = EditText(this).apply { hint = "Enrollment token" }
        status = TextView(this).apply { text = "未登録" }
        val enroll = Button(this).apply { text = "JARVISに登録" }
        val accessibility = Button(this).apply {
            text = "端末設定を開く"
            setOnClickListener { startActivity(Intent(Settings.ACTION_SETTINGS)) }
        }
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(32, 48, 32, 32)
            addView(status)
            addView(broker)
            addView(token)
            addView(enroll)
            addView(accessibility)
        }
        setContentView(root)

        val deepLink = intent?.data
        if (deepLink?.scheme == "jarvis" && deepLink.host == "enroll") {
            broker.setText(deepLink.getQueryParameter("broker").orEmpty())
            token.setText(deepLink.getQueryParameter("token").orEmpty())
            if (broker.text.isNotBlank() && token.text.isNotBlank()) enroll(broker.text.toString(), token.text.toString())
        }

        enroll.setOnClickListener { enroll(broker.text.toString(), token.text.toString()) }
        scheduleFallbackWorker()
    }

    override fun onResume() {
        super.onResume()
        active.set(true)
        startActivePollingLoop()
    }

    override fun onPause() {
        active.set(false)
        super.onPause()
    }

    private fun enroll(brokerUrl: String, token: String) {
        status.text = "登録中…"
        Thread {
            runCatching {
                val client = BrokerClient(this)
                client.brokerUrl = brokerUrl
                client.enroll(token)
            }.onSuccess {
                runOnUiThread { status.text = "READY" }
            }.onFailure {
                runOnUiThread { status.text = "登録失敗: ${it.message}" }
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
