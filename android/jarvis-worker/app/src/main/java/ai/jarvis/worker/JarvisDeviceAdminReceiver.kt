package ai.jarvis.worker

import android.app.admin.DeviceAdminReceiver
import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent

class JarvisDeviceAdminReceiver : DeviceAdminReceiver() {
    companion object {
        fun component(context: Context) = ComponentName(context, JarvisDeviceAdminReceiver::class.java)

        fun configureDedicatedMode(context: Context): Boolean {
            val dpm = context.getSystemService(DevicePolicyManager::class.java) ?: return false
            val admin = component(context)
            if (!dpm.isDeviceOwnerApp(context.packageName)) return false

            dpm.setLockTaskPackages(admin, arrayOf(context.packageName))
            dpm.setKeyguardDisabled(admin, true)
            dpm.setStatusBarDisabled(admin, true)
            return true
        }
    }

    override fun onEnabled(context: Context, intent: Intent) {
        super.onEnabled(context, intent)
        configureDedicatedMode(context)
    }
}
