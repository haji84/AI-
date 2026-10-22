package app.goriq.remote.lite

import android.app.Activity
import android.os.Bundle
import android.widget.ScrollView
import android.widget.TextView

class LicenseActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val text = TextView(this).apply {
            textSize = 12f
            setPadding(24, 24, 24, 24)
            text = "WebRTC Android SDK 150.7871.01\nPublisher: https://github.com/webrtc-sdk/android\n\n" +
                assets.open("notices/WEBRTC_SDK_LICENSE.txt").bufferedReader().use { it.readText() } + "\n\n" +
                assets.open("notices/WEBRTC.md").bufferedReader().use { it.readText() }
        }
        setContentView(ScrollView(this).apply { addView(text) })
    }
}
