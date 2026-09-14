package ai.jarvis.worker

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.graphics.Path
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
        fun execute(payload: JSONObject): JSONObject {
            val service = current ?: throw IllegalStateException("Accessibility automation is not enabled")
            return service.executePayload(payload)
        }
    }

    private val sheetsPackage = "com.google.android.apps.docs.editors.sheets"
    private val goldfishTexts = setOf("床掘はちみつ", "春巻きプニさん", "ポイ活くんハチミツ")
    private val qrTexts = setOf("オオグンタマQR", "春巻QR", "ポイ活くんQR")
    private val sheetCellByText = mapOf(
        "床掘はちみつ" to "C7",
        "春巻きプニさん" to "G7",
        "ポイ活くんハチミツ" to "J7",
        "オオグンタマQR" to "C5",
        "春巻QR" to "G6",
        "ポイ活くんQR" to "J6"
    )
    private val sheetMarkerTexts = (goldfishTexts + qrTexts).toList()
    private val errorTexts = listOf(
        "お友達のお手伝いが出来ませんでした",
        "あなたのアカウントでエラーが発生しました"
    )
    private val goldfishSuccessTexts = listOf("イベント詳細", "獲得履歴")
    private val qrSuccessTexts = listOf("受け取りしました", "マイQRコードを表示")
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
                "open-sheet-cell-link" -> openSheetCellLink(
                    cell = step.getString("cell"),
                    stage = step.optString("stage", "generic"),
                    timeoutMs = step.optLong("timeoutMs", 45_000).coerceIn(5_000, 60_000)
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

    private fun normalizeText(value: CharSequence?): String =
        value?.toString()?.lowercase()?.replace(Regex("\\s+"), "") ?: ""

    private fun findTextNode(text: String): AccessibilityNodeInfo? {
        val root = rootInActiveWindow ?: return null
        root.findAccessibilityNodeInfosByText(text).firstOrNull()?.let { return it }

        val target = normalizeText(text)
        val queue = ArrayDeque<AccessibilityNodeInfo>()
        queue.add(root)
        var visited = 0
        while (queue.isNotEmpty() && visited < 800) {
            val node = queue.removeFirst()
            visited++
            val visible = normalizeText(node.text) + normalizeText(node.contentDescription)
            if (visible.contains(target)) return node
            for (i in 0 until node.childCount) {
                node.getChild(i)?.let(queue::addLast)
            }
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

    private fun clickTextRetry(text: String, timeoutMs: Long): Boolean {
        val cell = sheetCellByText[text]
        val clicked = if (cell != null) {
            clickConfiguredSheetCell(cell, text, timeoutMs)
        } else {
            clickTextOnlyRetry(text, timeoutMs)
        }
        if (!clicked) return false

        when {
            text in goldfishTexts -> waitForOutcome(
                successTexts = goldfishSuccessTexts,
                timeoutMs = 30_000,
                stage = "金魚"
            )
            text in qrTexts -> {
                waitForOutcome(
                    successTexts = qrSuccessTexts,
                    timeoutMs = 30_000,
                    stage = "QR"
                )
                performGlobalAction(GLOBAL_ACTION_HOME)
            }
        }
        return true
    }

    private fun clickConfiguredSheetCell(cell: String, expectedText: String, timeoutMs: Long): Boolean {
        require(Regex("^[A-Z]{1,3}[1-9][0-9]*$").matches(cell)) { "Invalid sheet cell: $cell" }
        val deadline = SystemClock.uptimeMillis() + timeoutMs

        // Fast path when the configured cell is already visible.
        if (clickText(expectedText)) return true

        val columnLetters = cell.takeWhile { it.isLetter() }
        val row = cell.drop(columnLetters.length).toInt()
        var column = 0
        for (ch in columnLetters) column = column * 26 + (ch - 'A' + 1)

        // Normalize the viewport near the sheet's top-left. The target cells used by this
        // workflow are all in rows 5-7 and columns C-J, so a bounded reset plus a short
        // sweep is faster and safer than blind scrolling forever.
        repeat(3) {
            sheetSwipe(horizontal = true, towardStart = true)
            if (clickText(expectedText)) return true
        }
        repeat(3) {
            sheetSwipe(horizontal = false, towardStart = true)
            if (clickText(expectedText)) return true
        }

        val horizontalSweeps = when {
            column <= 4 -> 1
            column <= 7 -> 3
            else -> 5
        }
        repeat(horizontalSweeps) {
            if (SystemClock.uptimeMillis() >= deadline) return false
            if (clickText(expectedText)) return true
            sheetSwipe(horizontal = true, towardStart = false)
            SystemClock.sleep(250)
        }

        val verticalSweeps = if (row <= 7) 2 else ((row - 1) / 5).coerceAtMost(8)
        repeat(verticalSweeps) {
            if (SystemClock.uptimeMillis() >= deadline) return false
            if (clickText(expectedText)) return true
            sheetSwipe(horizontal = false, towardStart = false)
            SystemClock.sleep(250)
        }

        // One compact cross-axis search handles devices with different zoom/cell widths.
        repeat(3) {
            if (SystemClock.uptimeMillis() >= deadline) return false
            if (clickText(expectedText)) return true
            sheetSwipe(horizontal = true, towardStart = false)
            if (clickText(expectedText)) return true
            sheetSwipe(horizontal = false, towardStart = false)
        }
        return clickText(expectedText)
    }

    private fun sheetSwipe(horizontal: Boolean, towardStart: Boolean): Boolean {
        val dm = resources.displayMetrics
        val w = dm.widthPixels.toFloat()
        val h = dm.heightPixels.toFloat()
        val path = Path()
        if (horizontal) {
            val y = h * 0.62f
            val fromX = if (towardStart) w * 0.30f else w * 0.82f
            val toX = if (towardStart) w * 0.82f else w * 0.30f
            path.moveTo(fromX, y)
            path.lineTo(toX, y)
        } else {
            val x = w * 0.62f
            val fromY = if (towardStart) h * 0.34f else h * 0.82f
            val toY = if (towardStart) h * 0.82f else h * 0.34f
            path.moveTo(x, fromY)
            path.lineTo(x, toY)
        }
        return dispatchAndWait(
            GestureDescription.Builder()
                .addStroke(GestureDescription.StrokeDescription(path, 0, 260))
                .build()
        )
    }

    private fun waitForOutcome(successTexts: List<String>, timeoutMs: Long, stage: String) {
        val deadline = SystemClock.uptimeMillis() + timeoutMs
        do {
            val error = firstVisibleText(errorTexts)
            if (error != null) {
                throw IllegalStateException("$stage エラー画面を検出: $error。以降の処理を停止しました")
            }
            val success = firstVisibleText(successTexts)
            if (success != null) return
            SystemClock.sleep(250)
        } while (SystemClock.uptimeMillis() < deadline)
        throw IllegalStateException("$stage 完了画面を確認できませんでした")
    }

    private fun waitForAnyText(candidates: List<String>, timeoutMs: Long): String? {
        val deadline = SystemClock.uptimeMillis() + timeoutMs
        do {
            val visible = firstVisibleText(candidates)
            if (visible != null) return visible
            SystemClock.sleep(250)
        } while (SystemClock.uptimeMillis() < deadline)
        return null
    }

    private fun firstVisibleText(candidates: List<String>): String? {
        for (text in candidates) {
            if (findTextNode(text) != null) return text
        }
        return null
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

    private fun isCellMention(value: String, cell: String): Boolean {
        val normalized = value.uppercase().replace(Regex("\\s+"), " ")
        val escaped = Regex.escape(cell.uppercase())
        return Regex("(^|[^A-Z0-9])$escaped([^A-Z0-9]|$)").containsMatchIn(normalized)
    }

    private fun findCellNode(cell: String): AccessibilityNodeInfo? {
        val root = rootInActiveWindow ?: return null
        val queue = ArrayDeque<AccessibilityNodeInfo>()
        queue.add(root)
        var visited = 0
        while (queue.isNotEmpty() && visited < 1000) {
            val node = queue.removeFirst()
            visited++
            if (nodeStrings(node).any { isCellMention(it, cell) }) return node
            for (i in 0 until node.childCount) node.getChild(i)?.let(queue::addLast)
        }
        return null
    }

    private fun findCellAddressEditor(): AccessibilityNodeInfo? {
        val root = rootInActiveWindow ?: return null
        val queue = ArrayDeque<AccessibilityNodeInfo>()
        queue.add(root)
        var visited = 0
        var fallback: AccessibilityNodeInfo? = null
        while (queue.isNotEmpty() && visited < 1000) {
            val node = queue.removeFirst()
            visited++
            if (node.isEditable) {
                val strings = nodeStrings(node)
                val hasCellValue = strings.any { cellRegex.matches(it.trim().uppercase()) }
                val hint = strings.joinToString(" ").lowercase()
                val looksLikeNameBox = hint.contains("name") || hint.contains("名前") || hint.contains("cell") || hint.contains("セル")
                if (hasCellValue || looksLikeNameBox) return node
                if (fallback == null && node.text?.toString()?.trim()?.uppercase()?.let(cellRegex::matches) == true) fallback = node
            }
            for (i in 0 until node.childCount) node.getChild(i)?.let(queue::addLast)
        }
        return fallback
    }

    private fun setCellAddressThroughEditor(cell: String): Boolean {
        val editor = findCellAddressEditor() ?: return false
        editor.performAction(AccessibilityNodeInfo.ACTION_FOCUS)
        val args = Bundle().apply {
            putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, cell)
        }
        if (!editor.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args)) return false
        SystemClock.sleep(150)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            if (editor.performAction(AccessibilityNodeInfo.AccessibilityAction.ACTION_IME_ENTER.id)) return true
        }
        return editor.performAction(AccessibilityNodeInfo.ACTION_CLICK)
    }

    private fun sheetSwipeLeft(): Boolean {
        val path = Path().apply {
            moveTo(850f, 1050f)
            lineTo(250f, 1050f)
        }
        return dispatchAndWait(
            GestureDescription.Builder()
                .addStroke(GestureDescription.StrokeDescription(path, 0, 350))
                .build()
        )
    }

    private fun selectSheetCell(cell: String, timeoutMs: Long): Boolean {
        require(cellRegex.matches(cell.uppercase())) { "Invalid sheet cell: $cell" }
        val deadline = SystemClock.uptimeMillis() + timeoutMs

        if (setCellAddressThroughEditor(cell.uppercase())) {
            SystemClock.sleep(500)
            return true
        }

        var swipes = 0
        do {
            val node = findCellNode(cell.uppercase())
            if (node != null && clickNodeOrParent(node)) {
                SystemClock.sleep(500)
                return true
            }
            if (swipes < 5) {
                sheetSwipeLeft()
                swipes++
                SystemClock.sleep(350)
            } else {
                SystemClock.sleep(250)
            }
        } while (SystemClock.uptimeMillis() < deadline)
        return false
    }

    private fun findVisibleUrlNode(): AccessibilityNodeInfo? {
        val root = rootInActiveWindow ?: return null
        val queue = ArrayDeque<AccessibilityNodeInfo>()
        queue.add(root)
        var visited = 0
        while (queue.isNotEmpty() && visited < 1200) {
            val node = queue.removeFirst()
            visited++
            val strings = nodeStrings(node)
            if (strings.any { urlRegex.containsMatchIn(it) }) return node
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

    private fun openSheetCellLink(cell: String, stage: String, timeoutMs: Long): Boolean {
        val stageLabel = when (stage.lowercase()) {
            "goldfish" -> "金魚"
            "qr" -> "QR"
            else -> stage.ifBlank { "セル" }
        }
        if (!waitForPackage(sheetsPackage, 10_000)) {
            throw IllegalStateException("$stageLabel: スプレッドシートへ戻ったことを確認できませんでした")
        }
        val selectBudget = (timeoutMs / 3).coerceAtLeast(5_000)
        if (!selectSheetCell(cell, selectBudget)) {
            throw IllegalStateException("$stageLabel: 指定セル $cell へ移動できませんでした")
        }
        val linkBudget = (timeoutMs / 3).coerceAtLeast(5_000)
        if (!openVisibleUrl(linkBudget)) {
            throw IllegalStateException("$stageLabel: $cell 選択後にURLを確認できませんでした")
        }
        when (stage.lowercase()) {
            "goldfish" -> waitForOutcome(goldfishSuccessTexts, 30_000, "金魚")
            "qr" -> {
                waitForOutcome(qrSuccessTexts, 30_000, "QR")
                performGlobalAction(GLOBAL_ACTION_HOME)
            }
        }
        return true
    }

    private fun looksLikeSheetGrid(): Boolean {
        if (currentPackage() != sheetsPackage) return false
        if (firstVisibleText(sheetMarkerTexts) != null) return true
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

    /**
     * Open a named item on the current surface without issuing BACK automatically.
     * For the TikTok Lite spreadsheet, support both Sheets list and card/grid layouts,
     * then verify the document surface itself is visible before continuing.
     */
    private fun ensureOpenText(text: String, timeoutMs: Long): Boolean {
        if (!clickTextOnlyRetry(text, timeoutMs)) return false
        if (normalizeText(text) != normalizeText("TikTok Lite")) return true
        if (!waitForSheetGrid(12_000)) {
            throw IllegalStateException("TikTok Lite ファイルを開いたことを確認できませんでした")
        }
        return true
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
