package app.goriq.remote.lite

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.media.projection.MediaProjectionConfig
import android.media.projection.MediaProjectionManager
import android.os.*
import android.widget.*

/** An incoming request never starts sharing: select the session and approve the OS dialog locally. */
class RemoteSessionActivity : Activity() {
    private lateinit var selection: TextView
    private lateinit var sharing: TextView
    private lateinit var start: Button
    private var selected: DeviceSessionView? = null
    private var pendingCapture: String? = null
    private var discoveryGeneration = 0
    private val handler = Handler(Looper.getMainLooper())
    private val refresh = object : Runnable {
        override fun run() {
            val state = RemoteSessionService.state
            sharing.text = state.message + "\n送信フレーム数: " + state.frames
            handler.postDelayed(this, 500)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val column = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(24, 24, 24, 24) }
        fun label(value: String) = TextView(this).apply { text = value; textSize = 16f; column.addView(this) }
        fun button(value: String, action: () -> Unit) = Button(this).apply {
            text = value; setOnClickListener { action() }; column.addView(this)
        }
        label("GORIQ Remote 画面共有（開発版）")
        label("この版の映像接続は検証中です。公開接続は未対応です。Android 14以上の手動タップ・スワイプ・戻る/ホームに対応する候補で、Android 9〜13の遠隔入力は未対応です。ロック・保護画面は操作できません。再起動後は再度の画面共有許可が必要です。")
        selection = label("所有者の接続要求を確認してください。")
        button("接続要求を確認する") { discover() }
        start = button("このセッションへ画面を共有する") {
            val session = selected
            if (session == null || pendingCapture != null) return@button
            // Bind before either OS dialog; a late discovery reply cannot change this approval.
            pendingCapture = session.sessionId
            selected = null
            start.isEnabled = false
            if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED)
                requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 9)
            else requestCapture()
        }.apply { isEnabled = false }
        button("画面共有を停止する") {
            startService(serviceIntent().setAction(RemoteSessionService.ACTION_STOP))
        }
        sharing = label(RemoteSessionService.state.message)
        label("接続元から下のボタンをタップし、映像と入力結果を確認できます。")
        var taps = 0
        val count = label("入力テスト: 0")
        button("この画面の入力テスト対象") {
            taps++
            count.text = "入力テスト: " + taps
            count.setBackgroundColor(if (taps % 2 == 1) 0xff22aa44.toInt() else 0xff3366dd.toInt())
        }
        button("ライセンスを表示する") { startActivity(Intent(this, LicenseActivity::class.java)) }
        button("閉じる") { finish() }
        setContentView(ScrollView(this).apply { addView(column) })
    }

    override fun onResume() { super.onResume(); handler.post(refresh) }
    override fun onPause() { handler.removeCallbacks(refresh); super.onPause() }

    private fun discover() {
        if (pendingCapture != null) return
        val generation = ++discoveryGeneration
        selected = null
        start.isEnabled = false
        selection.text = "署名付き接続要求を確認しています…"
        Thread {
            val result = runCatching {
                val saved = checkNotNull(EnrollmentSettings(this).read())
                val identity = LocalIdentity(this)
                check(identity.deviceId() == saved.deviceId && identity.fingerprint() == saved.fingerprint)
                val access = DeviceSessionAccess(identity, CoordinatorExchange(HttpsJsonTransport(RemoteEndpoint.parse(saved.origin))))
                checkNotNull(access.discoverPending() ?: access.discoverActive()) { "接続要求なし" }
            }
            runOnUiThread {
                if (generation != discoveryGeneration || pendingCapture != null) return@runOnUiThread
                selected = result.getOrNull()
                start.isEnabled = selected != null
                selection.text = selected?.let { "接続要求を確認しました。\nセッションID: " + it.sessionId +
                    "\n自分が接続元で開始した要求と一致することを確認してください。" }
                    ?: "接続要求を確認できません。端末登録・所有者の接続操作・通信を確認してください。"
            }
        }.start()
    }

    private fun requestCapture() {
        if (pendingCapture == null) return
        val manager = getSystemService(MediaProjectionManager::class.java)
        val intent = if (Build.VERSION.SDK_INT >= 34)
            manager.createScreenCaptureIntent(MediaProjectionConfig.createConfigForDefaultDisplay())
            else manager.createScreenCaptureIntent()
        startActivityForResult(intent, 10)
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == 9) requestCapture()
    }

    @Deprecated("Framework activity result API retained without an additional UI dependency")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode != 10) return
        val approvedSession = pendingCapture
        pendingCapture = null
        if (resultCode != RESULT_OK || data == null || approvedSession == null) {
            selection.text = "画面共有は開始していません。"
            return
        }
        val intent = serviceIntent().setAction(RemoteSessionService.ACTION_START)
            .putExtra("session", approvedSession).putExtra("result", resultCode).putExtra("projection", data)
        selected = null
        start.isEnabled = false
        startForegroundService(intent)
    }

    private fun serviceIntent(): Intent =
        Intent().setClassName(this, getString(app.goriq.remote.lite.R.string.remote_session_service))
}
