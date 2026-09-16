package ai.jarvis.worker

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.graphics.Path
import android.graphics.Rect
import android.os.Build
import android.os.Bundle
import android.os.SystemClock
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import org.json.JSONArray
import org.json.JSONObject
import java.util.ArrayDeque
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

class JarvisAccessibilityService : AccessibilityService() {
    companion object {
        @Volatile private var current: JarvisAccessibilityService? = null

        fun connected(): Boolean = current != null

        fun currentPackageName(): String = current?.currentPackage().orEmpty()

        fun executeRemote(command: JSONObject): JSONObject {
            val service = current ?: error("Accessibility is disabled")
            require(Build.VERSION.SDK_INT >= 30) { "Screen capture needs Android 11" }
            require(command.getLong("expiresAt") > System.currentTimeMillis()) { "Expired command" }
            require(!WorkerRuntimeState.snapshot().optBoolean("working")) { "Device busy" }
            require(service.getSystemService(android.app.KeyguardManager::class.java)?.isDeviceLocked == false) { "Device locked" }
            val input = command.getJSONObject("input")
            if (input.getString("action") == "screenshot") return service.captureRemoteScreen()
            val action = when (input.getString("action")) {
                "tap", "swipe" -> input
                "text" -> {
                    val focused = service.rootInActiveWindow?.findFocus(AccessibilityNodeInfo.FOCUS_INPUT)
                    require(focused != null && !focused.isPassword) { "Sensitive or missing text field" }
                    require(input.getString("text").length <= 2_000)
                    JSONObject().put("action", "set-text").put("text", input.getString("text")).put("refusePassword", true)
                }
                "keyevent" -> JSONObject().put("action", when (input.getString("key").removePrefix("KEYCODE_")) {
                    "BACK" -> "back"; "HOME" -> "home"; "APP_SWITCH" -> "recents"; else -> error("Unsupported key")
                })
                else -> error("Unsupported remote action")
            }
            require(command.getLong("expiresAt") > System.currentTimeMillis())
            val result = service.executePayload(JSONObject().put("steps", JSONArray().put(action)))
            return result.put("ok", true)
        }

        fun execute(payload: JSONObject): JSONObject {
            val service = current ?: throw IllegalStateException("Accessibility automation is not enabled")
            return service.executePayload(payload)
        }
    }

    private val sheetsPackage = "com.google.android.apps.docs.editors.sheets"

    @android.annotation.TargetApi(30)
    private fun captureRemoteScreen(): JSONObject {
        val latch = CountDownLatch(1)
        var output: JSONObject? = null
        takeScreenshot(android.view.Display.DEFAULT_DISPLAY, mainExecutor, object : TakeScreenshotCallback {
            override fun onSuccess(result: ScreenshotResult) {
                try {
                    result.hardwareBuffer.use { buffer ->
                        val hardware = android.graphics.Bitmap.wrapHardwareBuffer(buffer, result.colorSpace) ?: error("No bitmap")
                        val bitmap = hardware.copy(android.graphics.Bitmap.Config.ARGB_8888, false)
                        hardware.recycle()
                        requireNotNull(bitmap)
                        try {
                            val stream = java.io.ByteArrayOutputStream()
                            bitmap.compress(android.graphics.Bitmap.CompressFormat.JPEG, 55, stream)
                            val bytes = stream.toByteArray()
                            require(bytes.size <= 650_000) { "Screenshot too large" }
                            output = JSONObject().put("ok", true).put("mimeType", "image/jpeg")
                                .put("nativeWidth", bitmap.width).put("nativeHeight", bitmap.height)
                                .put("imageBase64", android.util.Base64.encodeToString(bytes, android.util.Base64.NO_WRAP))
                                .put("capturedAt", java.time.Instant.now().toString())
                        } finally { bitmap.recycle() }
                    }
                } catch (_: Exception) { /* Return a visible failure, never a stale frame. */ }
                finally { latch.countDown() }
            }
            override fun onFailure(errorCode: Int) { latch.countDown() }
        })
        require(latch.await(3, TimeUnit.SECONDS)) { "Screenshot timed out" }
        return output ?: error("Screenshot unavailable")
    }
    private val cellRegex = Regex("^[A-Z]{1,3}[1-9][0-9]{0,5}$")
    private val urlRegex = Regex("https?://\\S+", RegexOption.IGNORE_CASE)

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
            if (action.isBlank()) throw IllegalArgumentException("UI action is required at step $i")
            val retries = step.optInt("retries", 0).coerceIn(0, 3)
            val retryDelayMs = step.optLong("retryDelayMs", 350).coerceIn(100, 3_000)
            WorkerRuntimeState.step(i, action)

            var ok = false
            var lastError: Throwable? = null
            for (attempt in 0..retries) {
                try {
                    ok = executeAction(step, action)
                    if (ok) break
                } catch (t: Throwable) {
                    lastError = t
                }
                if (attempt < retries) SystemClock.sleep(retryDelayMs)
            }
            if (!ok) {
                val suffix = lastError?.message?.let { ": $it" }.orEmpty()
                throw IllegalStateException("UI action failed at step $i: $action$suffix", lastError)
            }
            results.put(JSONObject()
                .put("step", i)
                .put("action", action)
                .put("ok", true))
        }
        return JSONObject().put("executed", results.length()).put("steps", results)
    }

    private fun executeAction(step: JSONObject, action: String): Boolean = when (action) {
        "click-text" -> clickText(step.getString("text"))
        "click-text-retry" -> clickTextOnlyRetry(
            step.getString("text"),
            step.optLong("timeoutMs", 6_000).coerceIn(250, 30_000)
        )
        "click-text-if-present" -> {
            clickText(step.getString("text"))
            true
        }
        "ensure-open-text" -> clickTextOnlyRetry(
            step.getString("text"),
            step.optLong("timeoutMs", 8_000).coerceIn(500, 30_000)
        )
        "wait-text" -> waitForAnyText(
            jsonStrings(step.getJSONArray("texts")),
            step.optLong("timeoutMs", 10_000).coerceIn(250, 60_000)
        ) != null
        "wait-package" -> waitForPackage(
            step.getString("packageName"),
            step.optLong("timeoutMs", 10_000).coerceIn(250, 60_000)
        )
        "wait-sheet-grid" -> waitForSheetGrid(
            step.optLong("timeoutMs", 12_000).coerceIn(500, 60_000)
        )
        "wait-outcome" -> waitForOutcome(
            successTexts = jsonStrings(step.getJSONArray("successTexts")),
            errorTexts = jsonStrings(step.optJSONArray("errorTexts") ?: JSONArray()),
            timeoutMs = step.optLong("timeoutMs", 30_000).coerceIn(500, 90_000),
            label = step.optString("label", "画面")
        )
        "select-sheet-cell" -> selectSheetCell(
            step.getString("cell"),
            step.optLong("timeoutMs", 20_000).coerceIn(1_000, 60_000)
        )
        "open-visible-url" -> openVisibleUrl(
            step.optLong("timeoutMs", 15_000).coerceIn(500, 60_000)
        )
        "open-sheet-cell-link" -> openSheetCellLink(
            cell = step.getString("cell"),
            timeoutMs = step.optLong("timeoutMs", 45_000).coerceIn(5_000, 90_000)
        )
        "click-view-id" -> clickViewId(step.getString("viewId"))
        "set-text" -> setText(step)
        "tap" -> tap(step.getDouble("x").toFloat(), step.getDouble("y").toFloat())
        "tap-relative" -> tapRelative(step.getDouble("xRatio"), step.getDouble("yRatio"))
        "swipe" -> swipe(step)
        "swipe-relative" -> swipeRelative(step)
        "back" -> performGlobalAction(GLOBAL_ACTION_BACK)
        "home" -> performGlobalAction(GLOBAL_ACTION_HOME)
        "recents" -> performGlobalAction(GLOBAL_ACTION_RECENTS)
        "wait" -> {
            val ms = step.optLong("ms", 500).coerceIn(0, 10_000)
            SystemClock.sleep(ms)
            true
        }
        else -> throw IllegalArgumentException("Unsupported UI action: $action")
    }

    private fun jsonStrings(array: JSONArray): List<String> =
        (0 until array.length()).map { array.getString(it) }.filter { it.isNotBlank() }

    private fun normalizeText(value: CharSequence?): String =
        value?.toString()?.lowercase()?.replace(Regex("\\s+"), "") ?: ""

    private fun findTextNode(text: String): AccessibilityNodeInfo? {
        val root = rootInActiveWindow ?: return null
        root.findAccessibilityNodeInfosByText(text).firstOrNull()?.let { return it }
        val target = normalizeText(text)
        val queue = ArrayDeque<AccessibilityNodeInfo>()
        queue.add(root)
        var visited = 0
        while (queue.isNotEmpty() && visited < 1_200) {
            val node = queue.removeFirst()
            visited++
            val visible = normalizeText(node.text) + normalizeText(node.contentDescription)
            if (visible.contains(target)) return node
            for (i in 0 until node.childCount) node.getChild(i)?.let(queue::addLast)
        }
        return null
    }

    private fun clickText(text: String): Boolean {
        val node = findTextNode(text) ?: return false
        return clickNodeOrParent(node)
    }

    private fun clickTextOnlyRetry(text: String, timeoutMs: Long): Boolean {
        val deadline = SystemClock.uptimeMillis() + timeoutMs
        do {
            if (clickText(text)) return true
            SystemClock.sleep(250)
        } while (SystemClock.uptimeMillis() < deadline)
        return false
    }

    private fun waitForAnyText(candidates: List<String>, timeoutMs: Long): String? {
        val deadline = SystemClock.uptimeMillis() + timeoutMs
        do {
            firstVisibleText(candidates)?.let { return it }
            SystemClock.sleep(250)
        } while (SystemClock.uptimeMillis() < deadline)
        return null
    }

    private fun firstVisibleText(candidates: List<String>): String? {
        for (text in candidates) if (findTextNode(text) != null) return text
        return null
    }

    private fun waitForOutcome(
        successTexts: List<String>,
        errorTexts: List<String>,
        timeoutMs: Long,
        label: String
    ): Boolean {
        require(successTexts.isNotEmpty()) { "wait-outcome requires successTexts" }
        val deadline = SystemClock.uptimeMillis() + timeoutMs
        do {
            val error = firstVisibleText(errorTexts)
            if (error != null) throw IllegalStateException("$label エラー画面を検出: $error")
            if (firstVisibleText(successTexts) != null) return true
            SystemClock.sleep(250)
        } while (SystemClock.uptimeMillis() < deadline)
        throw IllegalStateException("$label 完了画面を確認できませんでした")
    }

    private fun currentPackage(): String = rootInActiveWindow?.packageName?.toString().orEmpty()

    private fun waitForPackage(packageName: String, timeoutMs: Long): Boolean {
        val deadline = SystemClock.uptimeMillis() + timeoutMs
        do {
            if (currentPackage() == packageName) return true
            SystemClock.sleep(250)
        } while (SystemClock.uptimeMillis() < deadline)
        return false
    }

    private fun nodeStrings(node: AccessibilityNodeInfo): List<String> = listOfNotNull(
        node.text?.toString(),
        node.contentDescription?.toString()
    )

    private data class SheetCellRef(val column: String, val row: Int)

    private fun parseSheetCellRef(cell: String): SheetCellRef {
        val normalized = cell.trim().uppercase()
        require(cellRegex.matches(normalized)) { "Invalid sheet cell: $cell" }
        val split = normalized.indexOfFirst(Char::isDigit)
        return SheetCellRef(normalized.substring(0, split), normalized.substring(split).toInt())
    }

    private fun normalizedNodeLabel(node: AccessibilityNodeInfo): String =
        nodeStrings(node).joinToString(" ").trim().uppercase().replace(Regex("\\s+"), " ")

    private fun tokenPresent(text: String, token: String): Boolean {
        val escaped = Regex.escape(token.uppercase())
        return Regex("(^|[^A-Z0-9])$escaped([^A-Z0-9]|$)").containsMatchIn(text.uppercase())
    }

    private fun looksLikeHeaderNode(node: AccessibilityNodeInfo, label: String, columnHeader: Boolean): Boolean {
        val text = normalizedNodeLabel(node)
        if (text.isBlank()) return false
        val wanted = label.uppercase()
        val bounds = Rect().also(node::getBoundsInScreen)
        if (bounds.isEmpty) return false
        val dm = resources.displayMetrics
        val nearTop = bounds.centerY() < dm.heightPixels * 0.45
        val nearLeft = bounds.centerX() < dm.widthPixels * 0.30

        if (text == wanted) return if (columnHeader) nearTop else nearLeft
        if (!tokenPresent(text, wanted)) return false

        val semantic = if (columnHeader) {
            text.contains("COLUMN") || text.contains("列") || text.contains("COL ") || text.startsWith("COL")
        } else {
            text.contains("ROW") || text.contains("行")
        }
        return semantic || if (columnHeader) nearTop else nearLeft
    }

    private fun headerNode(label: String, columnHeader: Boolean): AccessibilityNodeInfo? {
        val root = rootInActiveWindow ?: return null
        val queue = ArrayDeque<AccessibilityNodeInfo>()
        queue.add(root)
        var visited = 0
        while (queue.isNotEmpty() && visited < 2_000) {
            val node = queue.removeFirst()
            visited++
            if (looksLikeHeaderNode(node, label, columnHeader)) return node
            for (i in 0 until node.childCount) node.getChild(i)?.let(queue::addLast)
        }
        return null
    }

    private fun tapCellIntersection(ref: SheetCellRef): Boolean {
        val columnNode = headerNode(ref.column, true) ?: return false
        val rowNode = headerNode(ref.row.toString(), false) ?: return false
        val columnBounds = Rect().also(columnNode::getBoundsInScreen)
        val rowBounds = Rect().also(rowNode::getBoundsInScreen)
        if (columnBounds.isEmpty || rowBounds.isEmpty) return false
        val x = columnBounds.centerX().toFloat()
        val y = rowBounds.centerY().toFloat()
        val dm = resources.displayMetrics
        if (x <= 0 || y <= 0 || x >= dm.widthPixels || y >= dm.heightPixels) return false
        return tap(x, y)
    }

    private fun findCellAddressEditor(): AccessibilityNodeInfo? {
        val root = rootInActiveWindow ?: return null
        val queue = ArrayDeque<AccessibilityNodeInfo>()
        queue.add(root)
        var visited = 0
        while (queue.isNotEmpty() && visited < 1_500) {
            val node = queue.removeFirst()
            visited++
            if (node.isEditable) {
                val strings = nodeStrings(node)
                val hasCellValue = strings.any { cellRegex.matches(it.trim().uppercase()) }
                val hint = strings.joinToString(" ").lowercase()
                val looksLikeNameBox = hint.contains("name") || hint.contains("名前") || hint.contains("cell") || hint.contains("セル") || hint.contains("range") || hint.contains("範囲")
                if (hasCellValue || looksLikeNameBox) return node
            }
            for (i in 0 until node.childCount) node.getChild(i)?.let(queue::addLast)
        }
        return null
    }

    private fun setCellAddressThroughEditor(cell: String): Boolean {
        val editor = findCellAddressEditor() ?: return false
        editor.performAction(AccessibilityNodeInfo.ACTION_FOCUS)
        val args = Bundle().apply {
            putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, cell)
        }
        if (!editor.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args)) return false
        SystemClock.sleep(150)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R &&
            editor.performAction(AccessibilityNodeInfo.AccessibilityAction.ACTION_IME_ENTER.id)) return true
        return editor.performAction(AccessibilityNodeInfo.ACTION_CLICK)
    }

    private fun sheetSwipeLeft(): Boolean = swipeByRatio(0.82, 0.62, 0.25, 0.62, 350)
    private fun sheetSwipeRight(): Boolean = swipeByRatio(0.25, 0.62, 0.82, 0.62, 350)
    private fun sheetSwipeUp(): Boolean = swipeByRatio(0.55, 0.78, 0.55, 0.30, 350)
    private fun sheetSwipeDown(): Boolean = swipeByRatio(0.55, 0.30, 0.55, 0.78, 350)

    private fun normalizeSheetOrigin() {
        // Put the sheet near A1 before resolving an A1-style reference. This prevents
        // the previous user's scroll position from changing what C7/G6/J7 means.
        repeat(5) {
            sheetSwipeRight()
            SystemClock.sleep(120)
        }
        repeat(5) {
            sheetSwipeDown()
            SystemClock.sleep(120)
        }
    }

    private fun selectSheetCell(cell: String, timeoutMs: Long): Boolean {
        val ref = parseSheetCellRef(cell)
        val normalizedCell = "${ref.column}${ref.row}"
        val deadline = SystemClock.uptimeMillis() + timeoutMs

        normalizeSheetOrigin()
        SystemClock.sleep(350)

        // C7 means column C x row 7, never a visible string search for "C7".
        var horizontalSwipes = 0
        var verticalSwipes = 0
        do {
            if (tapCellIntersection(ref)) {
                SystemClock.sleep(500)
                return true
            }
            val columnVisible = headerNode(ref.column, true) != null
            val rowVisible = headerNode(ref.row.toString(), false) != null
            when {
                !columnVisible && horizontalSwipes < 10 -> {
                    sheetSwipeLeft()
                    horizontalSwipes++
                }
                !rowVisible && verticalSwipes < 10 -> {
                    sheetSwipeUp()
                    verticalSwipes++
                }
                else -> break
            }
            SystemClock.sleep(300)
        } while (SystemClock.uptimeMillis() < deadline)

        // Fallback for Sheets builds exposing an editable name/range box instead of headers.
        if (setCellAddressThroughEditor(normalizedCell)) {
            SystemClock.sleep(500)
            return true
        }
        return false
    }

    private fun findVisibleUrlNode(): AccessibilityNodeInfo? {
        val root = rootInActiveWindow ?: return null
        val queue = ArrayDeque<AccessibilityNodeInfo>()
        queue.add(root)
        var visited = 0
        while (queue.isNotEmpty() && visited < 1_500) {
            val node = queue.removeFirst()
            visited++
            if (nodeStrings(node).any { urlRegex.containsMatchIn(it) }) return node
            for (i in 0 until node.childCount) node.getChild(i)?.let(queue::addLast)
        }
        return null
    }

    private fun openVisibleUrl(timeoutMs: Long): Boolean {
        val deadline = SystemClock.uptimeMillis() + timeoutMs
        do {
            val node = findVisibleUrlNode()
            if (node != null && clickNodeOrParent(node)) return true
            SystemClock.sleep(250)
        } while (SystemClock.uptimeMillis() < deadline)
        return false
    }

    private fun openSheetCellLink(cell: String, timeoutMs: Long): Boolean {
        if (!waitForPackage(sheetsPackage, 10_000)) {
            throw IllegalStateException("スプレッドシート画面を確認できませんでした")
        }
        val selectBudget = (timeoutMs / 2).coerceAtLeast(5_000)
        if (!selectSheetCell(cell, selectBudget)) {
            throw IllegalStateException("指定セル $cell（列・行座標）へ移動できませんでした")
        }
        val linkBudget = (timeoutMs / 2).coerceAtLeast(5_000)
        if (!openVisibleUrl(linkBudget)) {
            throw IllegalStateException("$cell 選択後にURLを確認できませんでした")
        }
        return true
    }

    private fun looksLikeSheetGrid(): Boolean {
        if (currentPackage() != sheetsPackage) return false
        if (findCellAddressEditor() != null) return true
        val root = rootInActiveWindow ?: return false
        val queue = ArrayDeque<AccessibilityNodeInfo>()
        queue.add(root)
        var visited = 0
        while (queue.isNotEmpty() && visited < 800) {
            val node = queue.removeFirst()
            visited++
            for (value in nodeStrings(node)) {
                val tokens = value.uppercase().split(Regex("[^A-Z0-9]+"))
                if (tokens.any(cellRegex::matches)) return true
            }
            if (headerNode("A", true) != null || headerNode("1", false) != null) return true
            for (i in 0 until node.childCount) node.getChild(i)?.let(queue::addLast)
        }
        return false
    }

    private fun waitForSheetGrid(timeoutMs: Long): Boolean {
        val deadline = SystemClock.uptimeMillis() + timeoutMs
        do {
            if (looksLikeSheetGrid()) return true
            SystemClock.sleep(250)
        } while (SystemClock.uptimeMillis() < deadline)
        return false
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
            step.has("label") -> findTextNode(step.getString("label"))
            else -> root.findFocus(AccessibilityNodeInfo.FOCUS_INPUT)
        } ?: return false
        if (step.optBoolean("refusePassword") && node.isPassword) return false
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

    private fun tapRelative(xRatio: Double, yRatio: Double): Boolean {
        val dm = resources.displayMetrics
        return tap(
            (dm.widthPixels * xRatio.coerceIn(0.0, 1.0)).toFloat(),
            (dm.heightPixels * yRatio.coerceIn(0.0, 1.0)).toFloat()
        )
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

    private fun swipeRelative(step: JSONObject): Boolean = swipeByRatio(
        step.getDouble("x1Ratio"), step.getDouble("y1Ratio"),
        step.getDouble("x2Ratio"), step.getDouble("y2Ratio"),
        step.optLong("durationMs", 350).coerceIn(100, 5_000)
    )

    private fun swipeByRatio(x1: Double, y1: Double, x2: Double, y2: Double, durationMs: Long): Boolean {
        val dm = resources.displayMetrics
        val path = Path().apply {
            moveTo((dm.widthPixels * x1.coerceIn(0.0, 1.0)).toFloat(), (dm.heightPixels * y1.coerceIn(0.0, 1.0)).toFloat())
            lineTo((dm.widthPixels * x2.coerceIn(0.0, 1.0)).toFloat(), (dm.heightPixels * y2.coerceIn(0.0, 1.0)).toFloat())
        }
        return dispatchAndWait(GestureDescription.Builder()
            .addStroke(GestureDescription.StrokeDescription(path, 0, durationMs))
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
