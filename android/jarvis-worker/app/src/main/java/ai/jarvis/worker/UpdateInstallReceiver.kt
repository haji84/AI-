package ai.jarvis.worker

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller

class UpdateInstallReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != ACTION_INSTALL_STATUS) return
        when (intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE)) {
            PackageInstaller.STATUS_PENDING_USER_ACTION -> {
                UpdateManager(context).recordStatus("Androidのインストール確認待ちです。Workerを開いて更新を確認してください")
                val confirm = if (android.os.Build.VERSION.SDK_INT >= 33) {
                    intent.getParcelableExtra(Intent.EXTRA_INTENT, Intent::class.java)
                } else {
                    @Suppress("DEPRECATION")
                    intent.getParcelableExtra(Intent.EXTRA_INTENT)
                }
                confirm?.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                if (confirm != null) {
                    val manager = context.getSystemService(android.app.NotificationManager::class.java)
                    manager.createNotificationChannel(android.app.NotificationChannel("jarvis-updates", "JARVIS更新", android.app.NotificationManager.IMPORTANCE_DEFAULT))
                    val pending = android.app.PendingIntent.getActivity(context, 858, confirm,
                        android.app.PendingIntent.FLAG_UPDATE_CURRENT or android.app.PendingIntent.FLAG_IMMUTABLE)
                    val notification = androidx.core.app.NotificationCompat.Builder(context, "jarvis-updates")
                        .setSmallIcon(android.R.drawable.stat_sys_download_done).setContentTitle("Androidの更新確認が必要です")
                        .setContentText("タップしてJARVIS Workerのインストールを確認してください")
                        .setContentIntent(pending).setAutoCancel(true).build()
                    runCatching { manager.notify(858, notification) }
                }
                if (confirm != null) runCatching { context.startActivity(confirm) }.onFailure {
                    UpdateManager(context).recordStatus("Androidの更新確認を表示できません。Workerを開いてください")
                }
            }
            PackageInstaller.STATUS_SUCCESS -> {
                UpdateManager(context).recordStatus("更新完了。再接続を確認しています")
                context.getSystemService(android.app.NotificationManager::class.java).cancel(858)
            }
            else -> UpdateManager(context).recordStatus("更新できませんでした。Androidでキャンセルされたか、空き容量・権限の確認が必要です")
        }
    }

    companion object {
        const val ACTION_INSTALL_STATUS = "ai.jarvis.worker.UPDATE_INSTALL_STATUS"
    }
}
