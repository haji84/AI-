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
            // Update distribution failures must not block task processing.
            runCatching {
                val info = manager.checkForUpdate(client.brokerUrl)
                if (info != null && !manager.installAutomaticallyIfManaged(info)) manager.notifyUpdate(info)
            }

            repeat(5) {
                val response = client.nextTask()
                val task = response.optJSONObject("task") ?: return@repeat
                TaskExecutor(applicationContext).execute(task)
            }
            Result.success()
        }.getOrElse { Result.retry() }
    }
}
