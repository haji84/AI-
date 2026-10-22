package app.goriq.remote.lite

import android.app.Activity
import android.os.Bundle
import android.view.WindowManager
import android.widget.Button

/** Negative acceptance target, never shipped in release. */
class SecureTestActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
        var taps = 0
        setContentView(Button(this).apply {
            isAllCaps = false
            text = "Secure target taps: 0"
            setOnClickListener { text = "Secure target taps: " + ++taps }
        })
    }
}
