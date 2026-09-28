package ai.jarvis.worker

import android.annotation.SuppressLint
import android.os.Bundle
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.appcompat.app.AppCompatActivity
import org.json.JSONObject
import java.util.concurrent.atomic.AtomicBoolean

class UrlTaskActivity : AppCompatActivity() {
    private val reported = AtomicBoolean(false)

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val taskId = intent.getStringExtra("task_id").orEmpty()
        val executionEpoch = intent.getLongExtra("execution_epoch", 0L)
        val fencingToken = intent.getStringExtra("fencing_token").orEmpty()
        val url = intent.getStringExtra("url").orEmpty()
        val allowJavaScript = intent.getBooleanExtra("allow_javascript", false)
        if (taskId.isBlank() || executionEpoch < 1L || fencingToken.length < 16 || !url.startsWith("https://")) {
            finish()
            return
        }

        val webView = WebView(this)
        setContentView(webView)
        webView.settings.apply {
            javaScriptEnabled = allowJavaScript
            allowFileAccess = false
            allowContentAccess = false
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            domStorageEnabled = allowJavaScript
            setSupportMultipleWindows(false)
        }
        WebView.setWebContentsDebuggingEnabled(false)
        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                val next = request?.url ?: return true
                return next.scheme != "https"
            }

            override fun onPageFinished(view: WebView?, finishedUrl: String?) {
                super.onPageFinished(view, finishedUrl)
                if (!reported.compareAndSet(false, true)) return
                report(taskId, executionEpoch, fencingToken, true, JSONObject()
                    .put("loaded", true)
                    .put("finalUrl", finishedUrl ?: url))
            }

            override fun onReceivedError(view: WebView?, request: WebResourceRequest?, error: android.webkit.WebResourceError?) {
                super.onReceivedError(view, request, error)
                if (request?.isForMainFrame != true || !reported.compareAndSet(false, true)) return
                report(taskId, executionEpoch, fencingToken, false, JSONObject()
                    .put("loaded", false)
                    .put("error", error?.description?.toString() ?: "webview error"))
            }
        }
        webView.loadUrl(url)
    }

    private fun report(taskId: String, executionEpoch: Long, fencingToken: String, ok: Boolean, detail: JSONObject) {
        Thread {
            runCatching { BrokerClient(this).taskResult(taskId, executionEpoch, fencingToken, ok, detail) }
            runOnUiThread { finish() }
        }.start()
    }
}
