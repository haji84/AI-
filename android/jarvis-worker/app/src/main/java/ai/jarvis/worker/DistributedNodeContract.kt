package ai.jarvis.worker

import android.app.ActivityManager
import android.content.Context
import android.os.Build
import android.os.StatFs
import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant

object DistributedNodeContract {
    fun snapshot(
        context: Context,
        batteryPercent: Int?,
        charging: Boolean,
        network: String
    ): JSONObject {
        val activity = context.getSystemService(ActivityManager::class.java)
        val memoryInfo = ActivityManager.MemoryInfo()
        activity?.getMemoryInfo(memoryInfo)

        val stat = StatFs(context.filesDir.absolutePath)
        val architecture = Build.SUPPORTED_ABIS.firstOrNull()

        return JSONObject()
            .put("schemaVersion", 1)
            .put("platform", "android")
            .put("architecture", architecture ?: JSONObject.NULL)
            .put("executionModes", JSONArray(listOf("foreground", "background-scheduled", "deferred")))
            .put("networkRequirement", "offline-capable")
            .put("persistence", JSONObject()
                .put("localState", true)
                .put("checkpointResume", false)
                .put("offlineQueue", false))
            .put("migration", JSONObject()
                .put("supported", JSONArray(listOf("RESTARTABLE", "PINNED")))
                .put("checkpointResume", false)
                .put("sideEffectingFencing", false))
            .put("security", JSONObject()
                .put("credentialIsolation", true)
                .put("taskScopedAuthorization", true))
            .put("constraints", JSONObject()
                .put("residentExecution", false)
                .put("lockedUiRequiresHuman", true))
            .put("resources", JSONObject()
                .put("cpuCores", Runtime.getRuntime().availableProcessors())
                .put("memoryAvailableMb", if (activity != null) memoryInfo.availMem / (1024L * 1024L) else JSONObject.NULL)
                .put("freeStorageMb", stat.availableBytes / (1024L * 1024L))
                .put("batteryPercent", batteryPercent ?: JSONObject.NULL)
                .put("charging", charging)
                .put("network", network))
            .put("checkedAt", Instant.now().toString())
    }
}
