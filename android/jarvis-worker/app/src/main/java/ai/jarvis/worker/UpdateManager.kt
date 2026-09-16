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
    data class UpdateInfo(val versionCode: Long, val versionName: String, val apkFile: File)
    private val prefs get() = context.getSharedPreferences("jarvis_updates", Context.MODE_PRIVATE)
    private val apkFile get() = File(context.cacheDir, "jarvis-worker-update.apk")
    fun currentVersionCode(): Long = context.packageManager.getPackageInfo(context.packageName, 0).longVersionCode
    fun status(): String = prefs.getString("status", "更新を自動確認します（最大1時間間隔）").orEmpty()
    fun recordStatus(value: String) { prefs.edit().putString("status", value).apply() }

    fun checkForUpdate(brokerUrl: String): UpdateInfo? = synchronized(lock) {
        require(brokerUrl.startsWith("https://")) { "HTTPS connection required" }
        val now = System.currentTimeMillis()
        if (UpdatePolicy.due(prefs.getLong("lastCheck", 0), now)) {
            // Persist attempt time before I/O so offline/error loops remain bounded.
            prefs.edit().putLong("lastCheck", now).apply()
            recordStatus("署名付き更新を確認中")
            try { download(UpdatePolicy.APK_URL, apkFile) }
            catch (error: Exception) {
                recordStatus("更新を取得できません。配信・通信を確認し、1時間後に自動再試行します")
                throw error
            }
        }
        if (!apkFile.exists()) return@synchronized null
        try {
            val info = inspect(apkFile)
            if (info == null) {
                recordStatus("配布版は導入済みと同じか古い版です。新版が未配信の場合は配信完了を待ってください")
                apkFile.delete()
            } else if (context.packageManager.packageInstaller.mySessions.isEmpty()) {
                recordStatus("更新 ${info.versionName} を取得済み。" + if (isDeviceOwner()) "管理端末として自動適用待ち" else "Androidでインストール確認が必要です")
            }
            info
        } catch (error: Exception) {
            apkFile.delete()
            recordStatus("更新を拒否しました：APKの形式・アプリID・署名を確認できません")
            throw error
        }
    }

    private fun inspect(file: File): UpdateInfo? {
        val archive = context.packageManager.getPackageArchiveInfo(file.absolutePath, PackageManager.GET_SIGNING_CERTIFICATES)
            ?: error("Invalid update APK")
        val installed = context.packageManager.getPackageInfo(context.packageName, PackageManager.GET_SIGNING_CERTIFICATES)
        require(archive.packageName == context.packageName) { "Wrong APK package" }
        require(signingDigests(archive) == signingDigests(installed)) { "APK signer mismatch" }
        if (archive.longVersionCode <= installed.longVersionCode) return null
        require(UpdatePolicy.trustedUpgrade(archive.packageName, context.packageName, archive.longVersionCode,
            installed.longVersionCode, signingDigests(archive), signingDigests(installed)))
        return UpdateInfo(archive.longVersionCode, archive.versionName ?: archive.longVersionCode.toString(), file)
    }

    fun canRequestPackageInstalls(): Boolean = context.packageManager.canRequestPackageInstalls()
    fun openInstallPermissionSettings() {
        context.startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${context.packageName}"))
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }

    fun install(info: UpdateInfo) = synchronized(lock) {
        check(!WorkerRuntimeState.snapshot().optBoolean("working")) { "作業終了後に更新してください" }
        val verified = inspect(info.apkFile) ?: error("Update no longer newer")
        require(verified.versionCode == info.versionCode)
        val installer = context.packageManager.packageInstaller
        check(installer.mySessions.isEmpty()) { "Androidの更新確認が進行中です" }
        val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL).apply {
            setAppPackageName(context.packageName)
            if (Build.VERSION.SDK_INT >= 31) setRequireUserAction(if (isDeviceOwner())
                PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED else PackageInstaller.SessionParams.USER_ACTION_REQUIRED)
        }
        val id = installer.createSession(params)
        try {
            installer.openSession(id).use { session ->
                info.apkFile.inputStream().use { input ->
                    session.openWrite("jarvis-worker.apk", 0, info.apkFile.length()).use { out -> input.copyTo(out); session.fsync(out) }
                }
                val callback = Intent(context, UpdateInstallReceiver::class.java).setAction(UpdateInstallReceiver.ACTION_INSTALL_STATUS)
                val pending = PendingIntent.getBroadcast(context, id, callback, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE)
                recordStatus("Androidに更新を要求しました。完了確認待ちです")
                session.commit(pending.intentSender)
            }
        } catch (error: Exception) { installer.abandonSession(id); recordStatus("インストール開始に失敗しました。Workerから再試行してください"); throw error }
    }

    fun installAutomaticallyIfManaged(info: UpdateInfo): Boolean {
        if (!isDeviceOwner() || WorkerRuntimeState.snapshot().optBoolean("working") ||
            context.packageManager.packageInstaller.mySessions.isNotEmpty()) return false
        if (prefs.getLong("attemptVersion", 0) != info.versionCode) prefs.edit().putLong("attemptVersion", info.versionCode).putInt("attempts", 0).apply()
        val attempts = prefs.getInt("attempts", 0)
        if (attempts >= 3) { recordStatus("自動更新を3回試行しました。端末で更新状態を確認してください"); return false }
        prefs.edit().putInt("attempts", attempts + 1).apply()
        install(info)
        return true
    }
    fun notifyUpdate(info: UpdateInfo) {
        val manager = context.getSystemService(android.app.NotificationManager::class.java)
        manager.createNotificationChannel(android.app.NotificationChannel("jarvis-updates", "JARVIS更新", android.app.NotificationManager.IMPORTANCE_DEFAULT))
        val open = PendingIntent.getActivity(context, 857, Intent(context, MainActivity::class.java), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val notice = androidx.core.app.NotificationCompat.Builder(context, "jarvis-updates")
            .setSmallIcon(android.R.drawable.stat_sys_download_done).setContentTitle("JARVIS ${info.versionName} 更新の確認")
            .setContentText("タップしてWorkerを開き、Androidの更新確認を行ってください")
            .setContentIntent(open).setAutoCancel(true).setOnlyAlertOnce(true).build()
        // Notification permission may be absent; the same state stays visible in Worker and owner UI.
        runCatching { manager.notify(857, notice) }
    }
    private fun isDeviceOwner(): Boolean = context.getSystemService(DevicePolicyManager::class.java)?.isDeviceOwnerApp(context.packageName) == true

    private fun download(initial: String, target: File) {
        val partial = File(context.cacheDir, "jarvis-worker-update.partial")
        var url = initial
        val deadline = System.currentTimeMillis() + 120_000
        try {
            repeat(4) {
                require(UpdatePolicy.allowedUrl(url)) { "Untrusted update host" }
                val connection = URL(url).openConnection() as HttpURLConnection
                connection.connectTimeout = 15_000; connection.readTimeout = 15_000
                connection.instanceFollowRedirects = false
                connection.setRequestProperty("Cache-Control", "no-cache")
                try {
                    val code = connection.responseCode
                    if (code in listOf(301,302,303,307,308)) {
                        url = URL(URL(url), connection.getHeaderField("Location") ?: error("Missing redirect")).toString()
                    } else {
                        check(code == 200) { "Update download HTTP $code" }
                        require(connection.contentLengthLong <= UpdatePolicy.MAX_BYTES) { "APK too large" }
                        var total = 0L
                        connection.inputStream.use { input -> partial.outputStream().use { output ->
                            val bytes = ByteArray(32 * 1024)
                            while (true) {
                                check(System.currentTimeMillis() <= deadline) { "Update download deadline" }
                                val count = input.read(bytes); if (count < 0) break
                                total += count; require(total <= UpdatePolicy.MAX_BYTES) { "APK too large" }
                                output.write(bytes, 0, count)
                            }
                        } }
                        require(total > 0)
                        // Validate before replacing a previously verified cached candidate.
                        inspect(partial)
                        java.nio.file.Files.move(partial.toPath(), target.toPath(), java.nio.file.StandardCopyOption.REPLACE_EXISTING)
                        return
                    }
                } finally { connection.disconnect() }
            }
            error("Too many update redirects")
        } finally { partial.delete() }
    }

    private fun signingDigests(info: android.content.pm.PackageInfo): Set<String> {
        val signers = info.signingInfo?.apkContentsSigners ?: error("APK signing info missing")
        require(signers.isNotEmpty())
        return signers.map { cert -> MessageDigest.getInstance("SHA-256").digest(cert.toByteArray()).joinToString("") { "%02x".format(it) } }.toSet()
    }
    companion object { private val lock = Any() }
}
