package ai.jarvis.worker

import android.content.Context
import androidx.work.Worker
import androidx.work.WorkerParameters

class JarvisPollWorker(appContext: Context, params: WorkerParameters) : Worker(appContext, params) {
    override fun doWork(): Result {
        val client = BrokerClient(applicationContext)
        if (client.brokerUrl.isBlank()) return Result.success()
        return runCatching {
            client.heartbeat()
            val manager = UpdateManager(applicationContext)
            val info = manager.parseUpdateInfo(client.updateInfo())
            if (info != null) manager.installAutomaticallyIfManaged(info)
            Result.success()
        }.getOrElse { Result.retry() }
    }
}
