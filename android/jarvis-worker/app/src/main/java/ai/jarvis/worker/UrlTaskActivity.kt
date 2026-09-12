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
        val url = intent.getStringExtra("url").orEmpty()
        val allowJavaScript = intent.getBooleanExtra("allow_javascript", false)
        if (taskId.isBlank() || !url.startsWith("https://")) {
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
                report(taskId, true, JSONObject()
                    .put("loaded", true)
                    .put("finalUrl", finishedUrl ?: url))
            }

            override fun onReceivedError(view: WebView?, request: WebResourceRequest?, error: android.webkit.WebResourceError?) {
                super.onReceivedError(view, request, error)
                if (request?.isForMainFrame != true || !reported.compareAndSet(false, true)) return
                report(taskId, false, JSONObject()
                    .put("loaded", false)
                    .put("error", error?.description?.toString() ?: "webview error"))
            }
        }
        webView.loadUrl(url)
    }

    private fun report(taskId: String, ok: Boolean, detail: JSONObject) {
        Thread {
            runCatching { BrokerClient(this).taskResult(taskId, ok, detail) }
            runOnUiThread { finish() }
        }.start()
    }
}
