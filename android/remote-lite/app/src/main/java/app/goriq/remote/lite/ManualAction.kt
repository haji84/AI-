package app.goriq.remote.lite

/** Only direct human gestures and system navigation belong in the friend APK. */
sealed interface ManualAction {
    data class Tap(val x: Double, val y: Double) : ManualAction
    data class Swipe(val x1: Double, val y1: Double, val x2: Double, val y2: Double,
        val durationMs: Long) : ManualAction
    data object Back : ManualAction
    data object Home : ManualAction
    data object Recents : ManualAction

    companion object {
        fun parse(action: String, x1: Double? = null, y1: Double? = null,
            x2: Double? = null, y2: Double? = null, durationMs: Long? = null): ManualAction {
            fun ratio(value: Double?): Double {
                require(value != null && value.isFinite() && value in 0.0..1.0) { "Invalid coordinate" }
                return value
            }
            return when (action) {
                "tap" -> Tap(ratio(x1), ratio(y1))
                "swipe" -> Swipe(ratio(x1), ratio(y1), ratio(x2), ratio(y2),
                    (durationMs ?: 350).also { require(it in 100..5_000) { "Invalid duration" } })
                "back" -> Back
                "home" -> Home
                "recents" -> Recents
                else -> throw IllegalArgumentException("Unsupported manual action")
            }
        }
    }
}
