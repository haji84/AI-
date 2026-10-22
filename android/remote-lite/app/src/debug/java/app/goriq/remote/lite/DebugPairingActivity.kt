package app.goriq.remote.lite

import android.app.Activity
import android.os.Bundle
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import java.util.concurrent.atomic.AtomicInteger

/** Debug-only integration path for the Android VM and a loopback Node coordinator. */
class DebugPairingActivity : Activity() {
    private var activeSessionId: String? = null
    private val diagnosticTaps = AtomicInteger()
    private fun coordinator() = CoordinatorExchange(HttpsJsonTransport(RemoteEndpoint.parse(
        checkNotNull(EnrollmentSettings(this).read()).origin)))

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val sessionButton = Button(this).apply { text = "セッションを診断する" }
        val restoreButton = Button(this).apply { text = "アクティブを再発見する" }
        val checkButton = Button(this).apply { text = "状態を再確認する" }
        val serviceButton = Button(this).apply { text = "操作権限接続を確認する" }
        val serviceStatus = TextView(this).apply { text = "操作権限状態: 未確認" }
        val operationButton = Button(this).apply { text = "画面操作ゲートを診断する" }
        val operationStatus = TextView(this).apply { text = "操作ゲート診断は未実行です" }
        val tapCount = TextView(this).apply { text = "対象タップ数: 0" }
        val targetButton = Button(this).apply {
            text = "認証された実タップの対象"
            setOnClickListener {
                diagnosticTaps.incrementAndGet()
                tapCount.text = "対象タップ数: ${diagnosticTaps.get()}"
            }
        }
        val sessionStatus = TextView(this).apply { text = "セッション診断は未実行です" }
        val content = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(32, 32, 32, 32)
            addView(sessionButton)
            addView(restoreButton)
            addView(checkButton)
            addView(sessionStatus)
            addView(serviceButton)
            addView(serviceStatus)
            addView(operationButton)
            addView(targetButton)
            addView(tapCount)
            addView(operationStatus)
        }
        setContentView(content)
        sessionButton.setOnClickListener {
            sessionButton.isEnabled = false
            sessionStatus.text = "セッションを確認しています…"
            Thread {
                val result = runCatching {
                    val access = DeviceSessionAccess(LocalIdentity(this),
                        coordinator())
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
        restoreButton.setOnClickListener {
            restoreButton.isEnabled = false
            sessionStatus.text = "再発見しています…"
            Thread {
                val result = runCatching {
                    val access = DeviceSessionAccess(LocalIdentity(this),
                        coordinator())
                    val active = checkNotNull(access.discoverActive()) { "アクティブセッションなし" }
                    check(access.verifyActive(active.sessionId).allowed) { "署名付き状態照会を拒否" }
                    activeSessionId = active.sessionId
                    "再発見成功 ID: ${active.sessionId}"
                }
                runOnUiThread {
                    sessionStatus.text = result.getOrElse { "再発見拒否: ${it.message ?: "不明なエラー"}" }
                    restoreButton.isEnabled = true
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
                        coordinator())
                    access.requireActiveThen(session) { "セッションは有効" }
                }
                runOnUiThread {
                    sessionStatus.text = result.getOrElse { "失効後は操作拒否" }
                    checkButton.isEnabled = true
                }
            }.start()
        }
        serviceButton.setOnClickListener {
            serviceStatus.text = if (ManualAccessibilityService.connected())
                "操作権限状態: 接続済み" else "操作権限状態: 未接続"
        }
        operationButton.setOnClickListener {
            operationButton.isEnabled = false
            operationStatus.text = "画面と入力を認証しています…"
            val location = IntArray(2)
            targetButton.getLocationOnScreen(location)
            val centerX = location[0] + targetButton.width / 2.0
            val centerY = location[1] + targetButton.height / 2.0
            val previous = diagnosticTaps.get()
            Thread {
                val result = runCatching {
                    val session = checkNotNull(activeSessionId) { "有効セッションなし" }
                    val access = DeviceSessionAccess(LocalIdentity(this),
                        coordinator())
                    val frame = access.requireActiveThen(session) { ManualAccessibilityService.capture() }
                    val x = (centerX / (frame.width - 1)).coerceIn(0.0, 1.0)
                    val y = (centerY / (frame.height - 1)).coerceIn(0.0, 1.0)
                    check(access.requireActiveThen(session) {
                        ManualAccessibilityService.apply(ManualAction.Tap(x, y))
                    }) { "Gesture refused" }
                    val deadline = System.currentTimeMillis() + 2_000
                    while (diagnosticTaps.get() == previous && System.currentTimeMillis() < deadline) {
                        Thread.sleep(25)
                    }
                    check(diagnosticTaps.get() > previous) { "Tap did not reach target" }
                    "認証済み画面取得と実タップ: 成功"
                }
                runOnUiThread {
                    operationStatus.text = result.getOrElse { "画面操作を拒否: ${it.message ?: "不明なエラー"}" }
                    operationButton.isEnabled = true
                }
            }.start()
        }
    }
}
