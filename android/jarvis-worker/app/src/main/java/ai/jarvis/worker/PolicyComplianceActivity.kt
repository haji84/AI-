package ai.jarvis.worker

import android.app.Activity
import android.app.admin.DevicePolicyManager
import android.os.Bundle
import android.os.PersistableBundle

class PolicyComplianceActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val extras = intent.getParcelableExtra<PersistableBundle>(
            DevicePolicyManager.EXTRA_PROVISIONING_ADMIN_EXTRAS_BUNDLE,
        )
        val broker = extras?.getString("jarvis_broker").orEmpty()
        val token = extras?.getString("jarvis_token").orEmpty()

        if (broker.isBlank() || token.isBlank()) {
            setResult(RESULT_CANCELED)
            finish()
            return
        }

        val client = BrokerClient(this).apply { brokerUrl = broker }
        Thread {
            val result = runCatching {
                JarvisDeviceAdminReceiver.configureDedicatedMode(this)
                client.enroll(token)
            }
            runOnUiThread {
                setResult(if (result.isSuccess) RESULT_OK else RESULT_CANCELED)
                finish()
            }
        }.start()
    }
}
