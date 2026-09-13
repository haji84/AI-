package ai.jarvis.worker

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.graphics.Path
import android.os.Bundle
import android.os.SystemClock
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

class JarvisAccessibilityService : AccessibilityService() {
    companion object {
        @Volatile private var current: JarvisAccessibilityService? = null
        fun connected(): Boolean = current != null
        fun execute(payload: JSONObject): JSONObject {
            val service = current ?: throw IllegalStateException("Accessibility automation is not enabled")
            return service.executePayload(payload)
        }
    }

    override fun onServiceConnected() {
        current = this
        super.onServiceConnected()
    }

    override fun onDestroy() {
        if (current === this) current = null
        super.onDestroy()
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) = Unit
    override fun onInterrupt() = Unit

    private fun executePayload(payload: JSONObject): JSONObject {
        val steps = payload.optJSONArray("steps") ?: JSONArray().put(payload)
        require(steps.length() in 1..50) { "UI automation requires 1..50 bounded steps" }
        val results = JSONArray()
        for (i in 0 until steps.length()) {
            val step = steps.getJSONObject(i)
            val action = step.optString("action")
            val result = when (action) {
                "click-text" -> clickText(step.getString("text"))
                "click-text-retry" -> clickTextRetry(
                    step.getString("text"),
                    step.optLong("timeoutMs", 6_000).coerceIn(250, 15_000)
                )
                "click-text-if-present" -> {
                    clickText(step.getString("text"))
                    true
                }
                "ensure-open-text" -> ensureOpenText(
                    step.getString("text"),
                    step.optLong("timeoutMs", 8_000).coerceIn(500, 15_000)
                )
                "click-view-id" -> clickViewId(step.getString("viewId"))
                "set-text" -> setText(step)
                "tap" -> tap(step.getDouble("x").toFloat(), step.getDouble("y").toFloat())
                "swipe" -> swipe(step)
                "back" -> performGlobalAction(GLOBAL_ACTION_BACK)
                "home" -> performGlobalAction(GLOBAL_ACTION_HOME)
                "recents" -> performGlobalAction(GLOBAL_ACTION_RECENTS)
                "wait" -> {
                    val ms = step.optLong("ms", 500).coerceIn(0, 10_000)
                    Thread.sleep(ms)
                    true
                }
                else -> throw IllegalArgumentException("Unsupported UI action: $action")
            }
            if (!result) throw IllegalStateException("UI action failed at step $i: $action")
            results.put(JSONObject().put("step", i).put("action", action).put("ok", true))
        }
        return JSONObject().put("executed", results.length()).put("steps", results)
    }

    private fun clickText(text: String): Boolean {
        val root = rootInActiveWindow ?: return false
        val node = root.findAccessibilityNodeInfosByText(text).firstOrNull() ?: return false
        return clickNodeOrParent(node)
    }

    private fun clickTextRetry(text: String, timeoutMs: Long): Boolean {
        val deadline = SystemClock.uptimeMillis() + timeoutMs
        do {
            if (clickText(text)) return true
            SystemClock.sleep(250)
        } while (SystemClock.uptimeMillis() < deadline)
        return false
    }

    /**
     * Open a named item regardless of whether the app resumed on a document or on its list screen.
     * First try the visible screen. If the text is not present, go back once and retry until timeout.
     */
    private fun ensureOpenText(text: String, timeoutMs: Long): Boolean {
        if (clickTextRetry(text, minOf(timeoutMs, 1_500))) return true
        if (!performGlobalAction(GLOBAL_ACTION_BACK)) return false
        SystemClock.sleep(700)
        return clickTextRetry(text, (timeoutMs - 1_500).coerceAtLeast(500))
    }

    private fun clickViewId(viewId: String): Boolean {
        val root = rootInActiveWindow ?: return false
        val node = root.findAccessibilityNodeInfosByViewId(viewId).firstOrNull() ?: return false
        return clickNodeOrParent(node)
    }

    private fun clickNodeOrParent(start: AccessibilityNodeInfo): Boolean {
        var node: AccessibilityNodeInfo? = start
        repeat(8) {
            val currentNode = node ?: return false
            if (currentNode.isClickable && currentNode.performAction(AccessibilityNodeInfo.ACTION_CLICK)) return true
            node = currentNode.parent
        }
        return false
    }

    private fun setText(step: JSONObject): Boolean {
        val root = rootInActiveWindow ?: return false
        val node = when {
            step.has("viewId") -> root.findAccessibilityNodeInfosByViewId(step.getString("viewId")).firstOrNull()
            step.has("label") -> root.findAccessibilityNodeInfosByText(step.getString("label")).firstOrNull()
            else -> root.findFocus(AccessibilityNodeInfo.FOCUS_INPUT)
        } ?: return false
        val args = Bundle().apply {
            putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, step.getString("text"))
        }
        return node.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args)
    }

    private fun tap(x: Float, y: Float): Boolean {
        val path = Path().apply { moveTo(x, y) }
        return dispatchAndWait(GestureDescription.Builder()
            .addStroke(GestureDescription.StrokeDescription(path, 0, 80))
            .build())
    }

    private fun swipe(step: JSONObject): Boolean {
        val path = Path().apply {
            moveTo(step.getDouble("x1").toFloat(), step.getDouble("y1").toFloat())
            lineTo(step.getDouble("x2").toFloat(), step.getDouble("y2").toFloat())
        }
        val duration = step.optLong("durationMs", 350).coerceIn(100, 5_000)
        return dispatchAndWait(GestureDescription.Builder()
            .addStroke(GestureDescription.StrokeDescription(path, 0, duration))
            .build())
    }

    private fun dispatchAndWait(gesture: GestureDescription): Boolean {
        val latch = CountDownLatch(1)
        var ok = false
        val accepted = dispatchGesture(gesture, object : GestureResultCallback() {
            override fun onCompleted(gestureDescription: GestureDescription?) {
                ok = true
                latch.countDown()
            }
            override fun onCancelled(gestureDescription: GestureDescription?) {
                latch.countDown()
            }
        }, null)
        if (!accepted) return false
        latch.await(6, TimeUnit.SECONDS)
        return ok
    }
}
