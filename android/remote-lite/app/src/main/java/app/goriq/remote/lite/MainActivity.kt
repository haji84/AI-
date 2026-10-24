package app.goriq.remote.lite

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import android.os.Build
import android.provider.Settings
import android.view.ViewGroup
import android.view.ViewTreeObserver
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import java.util.concurrent.atomic.AtomicInteger

/** Honest local setup/diagnostics screen. No remote session starts on launch. */
class MainActivity : Activity() {
    private lateinit var status: TextView
    private val diagnosticTaps = AtomicInteger()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val column = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(32, 32, 32, 32)
        }
        fun label(text: String) = TextView(this).apply {
            this.text = text
            textSize = 17f
            setPadding(0, 0, 0, 24)
            column.addView(this, ViewGroup.LayoutParams(-1, -2))
        }
        fun button(text: String, onClick: () -> Unit) = Button(this).apply {
            this.text = text
            setOnClickListener { onClick() }
            column.addView(this, ViewGroup.LayoutParams(-1, -2))
        }
        label("GORIQ Remote Lite（Android検証版）")
        label("この版は端末内の画面・入力と鍵の検証用です。外出先からの接続はまだ利用できません。")
        status = label("端末を確認しています…")
        button("操作権限の設定を開く") {
            startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))
        }
        button("画面取得を診断する") {
            if (Build.VERSION.SDK_INT < 30) {
                status.text = "Android 9/10はこの画面取得方式に対応していません。"
            } else {
                status.text = "画面を確認しています…"
                Thread {
                    val result = runCatching { ManualAccessibilityService.capture() }
                    runOnUiThread {
                        status.text = result.fold(
                            { "画面取得: ${it.width}×${it.height}、${it.jpeg.size}バイト。遠隔接続は未実装です。" },
                            { "画面取得できません: ${it.message ?: "権限または端末状態を確認してください"}" })
                    }
                }.start()
            }
        }
        val target = button("入力テスト対象（この画面だけ）") {
            diagnosticTaps.incrementAndGet()
            status.text = "入力テスト対象にタップが届きました。"
        }
        button("手動入力を診断する") {
            val previous = diagnosticTaps.get()
            status.text = "画面取得と入力を確認しています…"
            target.viewTreeObserver.addOnPreDrawListener(object : ViewTreeObserver.OnPreDrawListener {
                override fun onPreDraw(): Boolean {
                    target.viewTreeObserver.removeOnPreDrawListener(this)
                    val location = IntArray(2)
                    target.getLocationOnScreen(location)
                    val centerX = location[0] + target.width / 2.0
                    val centerY = location[1] + target.height / 2.0
                    Thread {
                        val result = runCatching {
                            val frame = ManualAccessibilityService.capture()
                            val x = (centerX / (frame.width - 1)).coerceIn(0.0, 1.0)
                            val y = (centerY / (frame.height - 1)).coerceIn(0.0, 1.0)
                            check(ManualAccessibilityService.apply(ManualAction.Tap(x, y))) { "Gesture refused" }
                            val deadline = System.currentTimeMillis() + 2_000
                            while (diagnosticTaps.get() == previous && System.currentTimeMillis() < deadline) {
                                Thread.sleep(25)
                            }
                            check(diagnosticTaps.get() > previous) { "Tap did not reach test target" }
                            "画面取得と手動入力: 成功"
                        }
                        runOnUiThread {
                            status.text = result.getOrElse { "手動入力できません: ${it.message ?: "端末状態を確認してください"}" }
                        }
                    }.start()
                    return true
                }
            })
        }
        button("端末登録の設定を開く") {
            startActivity(Intent(this, EnrollmentActivity::class.java))
        }
        button("画面共有の設定を開く") {
            startActivity(Intent(this, RemoteSessionActivity::class.java))
        }
        setContentView(ScrollView(this).apply { addView(column) })
        Thread {
            val result = runCatching {
                val identity = LocalIdentity(this)
                val id = identity.ensure()
                "端末ID: $id\n鍵の確認コード: ${identity.fingerprint().take(16)}\n操作権限: ${if (ManualAccessibilityService.connected()) "有効" else "未接続"}"
            }
            runOnUiThread { status.text = result.getOrElse { "端末鍵を確認できません: ${it.message}" } }
        }.start()
        try {
            if (EnrollmentSettings(this).read() == null)
                startActivity(Intent(this, EnrollmentActivity::class.java))
        } catch (_: Exception) { status.text = "保存済みの登録情報を確認できません。端末鍵を保持してください。" }
    }
}
