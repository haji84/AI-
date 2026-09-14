package ai.jarvis.worker

import org.json.JSONObject
import java.time.Instant

object WorkerRuntimeState {
    @Volatile private var currentTaskId: String? = null
    @Volatile private var currentTaskType: String? = null
    @Volatile private var currentStepIndex: Int? = null
    @Volatile private var currentStepAction: String? = null
    @Volatile private var taskStartedAt: String? = null
    @Volatile private var lastCompletedAt: String? = null
    @Volatile private var lastError: String? = null

    fun beginTask(taskId: String, taskType: String) {
        currentTaskId = taskId
        currentTaskType = taskType
        currentStepIndex = null
        currentStepAction = null
        taskStartedAt = Instant.now().toString()
        lastError = null
    }

    fun step(index: Int, action: String) {
        currentStepIndex = index
        currentStepAction = action
    }

    fun completeTask() {
        lastCompletedAt = Instant.now().toString()
        currentTaskId = null
        currentTaskType = null
        currentStepIndex = null
        currentStepAction = null
        taskStartedAt = null
    }

    fun fail(message: String) {
        lastError = message
        currentTaskId = null
        currentTaskType = null
        currentStepIndex = null
        currentStepAction = null
        taskStartedAt = null
    }

    fun snapshot(): JSONObject = JSONObject()
        .put("working", currentTaskId != null)
        .put("currentTaskId", currentTaskId ?: JSONObject.NULL)
        .put("currentTaskType", currentTaskType ?: JSONObject.NULL)
        .put("currentStepIndex", currentStepIndex ?: JSONObject.NULL)
        .put("currentStepAction", currentStepAction ?: JSONObject.NULL)
        .put("taskStartedAt", taskStartedAt ?: JSONObject.NULL)
        .put("lastCompletedAt", lastCompletedAt ?: JSONObject.NULL)
        .put("lastError", lastError ?: JSONObject.NULL)
}
