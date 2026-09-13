package ai.jarvis.worker

import android.app.PendingIntent
import android.app.admin.DevicePolicyManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest

class UpdateManager(private val context: Context) {
    data class UpdateInfo(
        val versionCode: Long,
        val versionName: String,
        val apkFile: File,
    )

    fun currentVersionCode(): Long = if (Build.VERSION.SDK_INT >= 28) {
        context.packageManager.getPackageInfo(context.packageName, 0).longVersionCode
    } else {
        @Suppress("DEPRECATION")
        context.packageManager.getPackageInfo(context.packageName, 0).versionCode.toLong()
    }

    fun checkForUpdate(brokerUrl: String): UpdateInfo? {
        require(brokerUrl.startsWith("https://")) { "Self-update requires HTTPS Broker" }
        val apkUrl = "${brokerUrl.trimEnd('/')}/downloads/jarvis-worker.apk"
        val apkFile = File(context.cacheDir, "jarvis-worker-update.apk")
        download(apkUrl, apkFile)

        val flags = if (Build.VERSION.SDK_INT >= 28) PackageManager.GET_SIGNING_CERTIFICATES else @Suppress("DEPRECATION") PackageManager.GET_SIGNATURES
        val archive = context.packageManager.getPackageArchiveInfo(apkFile.absolutePath, flags)
            ?: throw IllegalStateException("Downloaded JARVIS update is not a valid APK")
        require(archive.packageName == context.packageName) { "Downloaded APK package does not match JARVIS Worker" }

        val archiveVersion = if (Build.VERSION.SDK_INT >= 28) archive.longVersionCode else {
            @Suppress("DEPRECATION")
            archive.versionCode.toLong()
        }
        if (archiveVersion <= currentVersionCode()) {
            apkFile.delete()
            return null
        }

        require(signingDigest(archive) == signingDigestCurrent()) { "Downloaded JARVIS update signature mismatch" }
        return UpdateInfo(archiveVersion, archive.versionName ?: archiveVersion.toString(), apkFile)
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
        require(info.apkFile.exists() && info.apkFile.length() > 0) { "JARVIS update APK is missing" }
        val installer = context.packageManager.packageInstaller
        val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL).apply {
            setAppPackageName(context.packageName)
            if (Build.VERSION.SDK_INT >= 31 && isDeviceOwner()) {
                setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED)
            }
        }
        val sessionId = installer.createSession(params)
        installer.openSession(sessionId).use { session ->
            info.apkFile.inputStream().use { input ->
                session.openWrite("jarvis-worker.apk", 0, info.apkFile.length()).use { out ->
                    input.copyTo(out)
                    session.fsync(out)
                }
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

    private fun download(url: String, file: File) {
        val connection = URL(url).openConnection() as HttpURLConnection
        connection.connectTimeout = 15_000
        connection.readTimeout = 60_000
        connection.instanceFollowRedirects = true
        connection.setRequestProperty("Cache-Control", "no-cache")
        val code = connection.responseCode
        if (code !in 200..299) throw IllegalStateException("JARVIS update download HTTP $code")
        connection.inputStream.use { input -> file.outputStream().use { output -> input.copyTo(output) } }
    }

    private fun signingDigestCurrent(): String {
        val flags = if (Build.VERSION.SDK_INT >= 28) PackageManager.GET_SIGNING_CERTIFICATES else @Suppress("DEPRECATION") PackageManager.GET_SIGNATURES
        val info = context.packageManager.getPackageInfo(context.packageName, flags)
        return signingDigest(info)
    }

    private fun signingDigest(info: android.content.pm.PackageInfo): String {
        val cert = if (Build.VERSION.SDK_INT >= 28) {
            val signingInfo = info.signingInfo ?: throw IllegalStateException("APK signing info missing")
            if (signingInfo.hasMultipleSigners()) signingInfo.apkContentsSigners.first() else signingInfo.signingCertificateHistory.first()
        } else {
            @Suppress("DEPRECATION")
            info.signatures.first()
        }
        return MessageDigest.getInstance("SHA-256").digest(cert.toByteArray()).joinToString("") { "%02x".format(it) }
    }
}
