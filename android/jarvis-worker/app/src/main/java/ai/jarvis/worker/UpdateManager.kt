package ai.jarvis.worker

import android.app.PendingIntent
import android.app.admin.DevicePolicyManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.net.Uri
import android.os.Build
import android.provider.Settings
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest

class UpdateManager(private val context: Context) {
    data class UpdateInfo(
        val versionCode: Long,
        val versionName: String,
        val apkUrl: String,
        val sha256Base64Url: String,
    )

    fun currentVersionCode(): Long = if (Build.VERSION.SDK_INT >= 28) {
        context.packageManager.getPackageInfo(context.packageName, 0).longVersionCode
    } else {
        @Suppress("DEPRECATION")
        context.packageManager.getPackageInfo(context.packageName, 0).versionCode.toLong()
    }

    fun parseUpdateInfo(json: JSONObject): UpdateInfo? {
        if (!json.optBoolean("available", false)) return null
        val versionCode = json.optLong("versionCode", 0)
        val versionName = json.optString("versionName")
        val apkUrl = json.optString("apkUrl")
        val sha = json.optString("sha256Base64Url")
        if (versionCode <= currentVersionCode() || !apkUrl.startsWith("https://") || sha.isBlank()) return null
        return UpdateInfo(versionCode, versionName, apkUrl, sha)
    }

    fun canRequestPackageInstalls(): Boolean = Build.VERSION.SDK_INT < 26 || context.packageManager.canRequestPackageInstalls()

    fun openInstallPermissionSettings() {
        if (Build.VERSION.SDK_INT < 26) return
        context.startActivity(
            Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${context.packageName}"))
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        )
    }

    fun install(info: UpdateInfo) {
        val bytes = download(info.apkUrl)
        val digest = MessageDigest.getInstance("SHA-256").digest(bytes)
        val actual = android.util.Base64.encodeToString(
            digest,
            android.util.Base64.URL_SAFE or android.util.Base64.NO_WRAP or android.util.Base64.NO_PADDING,
        )
        require(actual == info.sha256Base64Url) { "Downloaded JARVIS update checksum mismatch" }

        val installer = context.packageManager.packageInstaller
        val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL).apply {
            setAppPackageName(context.packageName)
            if (Build.VERSION.SDK_INT >= 31 && isDeviceOwner()) {
                setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED)
            }
        }
        val sessionId = installer.createSession(params)
        installer.openSession(sessionId).use { session ->
            session.openWrite("jarvis-worker.apk", 0, bytes.size.toLong()).use { out ->
                out.write(bytes)
                session.fsync(out)
            }
            val callback = Intent(context, UpdateInstallReceiver::class.java)
                .setAction(UpdateInstallReceiver.ACTION_INSTALL_STATUS)
            val pending = PendingIntent.getBroadcast(
                context,
                sessionId,
                callback,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE,
            )
            session.commit(pending.intentSender)
        }
    }

    fun installAutomaticallyIfManaged(info: UpdateInfo): Boolean {
        if (!isDeviceOwner()) return false
        install(info)
        return true
    }

    private fun isDeviceOwner(): Boolean = context.getSystemService(DevicePolicyManager::class.java)
        ?.isDeviceOwnerApp(context.packageName) == true

    private fun download(url: String): ByteArray {
        val connection = URL(url).openConnection() as HttpURLConnection
        connection.connectTimeout = 15_000
        connection.readTimeout = 60_000
        connection.instanceFollowRedirects = true
        connection.setRequestProperty("Cache-Control", "no-cache")
        val code = connection.responseCode
        if (code !in 200..299) throw IllegalStateException("JARVIS update download HTTP $code")
        return connection.inputStream.use { it.readBytes() }
    }
}
