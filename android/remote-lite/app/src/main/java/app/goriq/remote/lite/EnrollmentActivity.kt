package app.goriq.remote.lite

import android.app.Activity
import android.app.AlertDialog
import android.os.Bundle
import android.text.InputType
import android.view.View
import android.view.WindowManager
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView

/** Incoming invitations are previews. Only a local tap can submit a device registration. */
class EnrollmentActivity : Activity() {
    private lateinit var settings: EnrollmentSettings
    private lateinit var status: TextView
    private lateinit var register: Button
    private lateinit var confirm: Button
    private lateinit var recover: Button
    private lateinit var input: EditText
    private var invitation: EnrollmentLink? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
        settings = EnrollmentSettings(this)
        val column = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(24, 24, 24, 24)
            importantForAutofill = View.IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS
        }
        fun label(value: String) = TextView(this).apply {
            text = value
            textSize = 16f
            setPadding(0, 0, 0, 16)
            column.addView(this)
        }
        fun button(value: String, action: () -> Unit) = Button(this).apply {
            text = value
            setOnClickListener { action() }
            column.addView(this)
        }
        label("GORIQ Remote 端末登録")
        label("所有者から受け取った招待を確認して、この端末を登録します。画面共有や遠隔操作は登録だけでは始まりません。")
        input = EditText(this).apply {
            hint = "招待リンクを貼り付け"
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI
            isSaveEnabled = false
            column.addView(this)
        }
        button("招待を確認する") { preview(input.text.toString()) }
        status = label("招待リンクを開くか、ここへ貼り付けてください。")
        register = button("この接続先へ端末を登録する") { submit() }.apply { isEnabled = false }
        confirm = button("所有者の承認を確認する") { confirmRegistration() }.apply { isEnabled = false }
        recover = button("所有者確認後に新しい招待で再申請する") { recoverRegistration() }.apply { isEnabled = false }
        button("閉じる") { finish() }
        setContentView(ScrollView(this).apply { addView(column) })
        renderSaved()
        val incoming = intent.dataString
        intent.data = null
        if (incoming != null) preview(incoming)
    }

    private fun preview(value: String) {
        input.text.clear()
        invitation = null
        register.isEnabled = false
        recover.isEnabled = false
        try {
            val link = EnrollmentLink.parse(value)
            val saved = settings.read()
            if (saved != null) {
                if (saved.origin == link.endpoint.origin && saved.phase != "approved") {
                    invitation = link
                    recover.isEnabled = true
                }
                status.text = if (saved.origin == link.endpoint.origin)
                    "登録情報を保持しています。承認確認、または所有者確認後の再申請を選んでください。\n${description(saved)}"
                    else "別の接続先の登録情報を保持しています。接続先を自動変更できません。\n${description(saved)}"
                confirm.isEnabled = true
                return
            }
            invitation = link
            status.text = "接続先: ${link.endpoint.origin}\n所有者から受け取った接続先と一致することを確認してください。"
            register.isEnabled = true
        } catch (_: Exception) {
            status.text = "招待を確認できません。HTTPS接続先を含む有効な招待リンクを確認してください。"
        }
    }

    private fun recoverRegistration() {
        val link = invitation ?: return
        val expected = runCatching { settings.read() }.getOrNull() ?: return
        AlertDialog.Builder(this)
            .setTitle("所有者側で以前の申請を確認しましたか？")
            .setMessage("以前の申請が期限切れで、登録されていないことを所有者側で確認してから実行してください。端末鍵・指紋・以前の申請IDを保持し、同じ接続先へ新しい招待で再申請します。承認済みの場合は承認確認を使ってください。")
            .setNegativeButton("戻る", null)
            .setPositiveButton("確認済み・再申請する") { _, _ -> submit(link, expected) }
            .show()
    }

    private fun submit() {
        val link = invitation ?: return
        submit(link, null)
    }

    private fun submit(link: EnrollmentLink, recovery: SavedEnrollment?) {
        invitation = null
        busy("端末を登録しています…")
        Thread {
            val result = runCatching {
                val setup = EnrollmentSetup(LocalIdentity(this), settings) {
                    CoordinatorExchange(HttpsJsonTransport(it))
                }
                if (recovery == null) setup.submit(link) else setup.retryAfterOwnerConfirmation(link, recovery)
            }
            runOnUiThread {
                if (!renderSaved()) status.text = "登録できません。接続先と安全なHTTPS通信を確認してください。"
                if (result.isFailure) status.append("\n登録結果が不明な場合は再送せず、所有者側の登録状態を確認してください。")
            }
        }.start()
    }

    private fun confirmRegistration() {
        busy("所有者の承認を確認しています…")
        Thread {
            val result = runCatching {
                val saved = checkNotNull(settings.read())
                val identity = LocalIdentity(this)
                check(identity.deviceId() == saved.deviceId && identity.fingerprint() == saved.fingerprint)
                val exchange = CoordinatorExchange(HttpsJsonTransport(RemoteEndpoint.parse(saved.origin)))
                DeviceSessionAccess(identity, exchange).discoverPending()
                // A successful signed discovery authenticates the approved key even with no pending session.
                EnrollmentSetup(identity, settings) { exchange }.recordApprovalAfterSignedCheck(saved)
            }
            runOnUiThread {
                renderSaved()
                if (result.isSuccess) status.text = "登録済み（今回の署名照会で確認）。\n${description(result.getOrThrow())}"
                else status.text = "承認を確認できません。所有者側の承認・登録解除と通信状態を確認してください。"
            }
        }.start()
    }

    private fun busy(message: String) {
        register.isEnabled = false
        confirm.isEnabled = false
        recover.isEnabled = false
        status.text = message
    }

    private fun renderSaved(): Boolean = try {
        val saved = settings.read()
        register.isEnabled = false
        recover.isEnabled = false
        confirm.isEnabled = saved != null
        if (saved != null) status.text = description(saved)
        saved != null
    } catch (_: Exception) {
        register.isEnabled = false
        confirm.isEnabled = false
        recover.isEnabled = false
        status.text = "保存済みの登録情報を確認できません。端末鍵を消去せず、所有者へ確認してください。"
        true
    }

    private fun description(saved: SavedEnrollment): String {
        val state = when (saved.phase) {
            "approved" -> "登録情報を保存済み。利用時に承認状態を再確認します。遠隔接続はこの開発版ではまだ利用できません。"
            "awaiting-owner-approval" -> "所有者の承認待ち。所有者の画面で指紋を照合して承認してください。"
            else -> "登録結果が不明です。所有者側で確認してください。未登録で以前の申請が期限切れなら、新しい招待を貼り付けて確認後に再申請できます。"
        }
        return "$state\n接続先: ${saved.origin}\n端末ID: ${saved.deviceId}\n" +
            (saved.requestId?.let { "申請ID: $it\n" } ?: "") +
            (if (saved.previousRequestIds.isEmpty()) "" else "以前の申請ID: ${saved.previousRequestIds.joinToString(", ")}\n") +
            "指紋: ${saved.fingerprint}"
    }
}
