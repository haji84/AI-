package app.goriq.remote.lite

/** Short monotonic permission for publishing frames; late replies cannot revive it. */
class CaptureLease(private val elapsedMs: () -> Long, private val durationMs: Long = 3_000,
    private val hardDeadlineElapsed: Long = Long.MAX_VALUE) {
    private var observed = elapsedMs()
    private var deadline = Math.addExact(observed, durationMs)
    private var authorized = false
    private var closed = false

    init { require(durationMs in 100..10_000) { "Invalid media lease duration" } }

    @Synchronized fun renew(): Boolean {
        if (!withinDeadline()) return false
        deadline = Math.addExact(observed, durationMs)
        authorized = true
        return true
    }

    @Synchronized fun allowed(): Boolean = withinDeadline() && authorized

    @Synchronized fun close() { closed = true }

    private fun withinDeadline(): Boolean {
        if (closed) return false
        val now = elapsedMs()
        if (now < observed || now >= deadline || now >= hardDeadlineElapsed) {
            closed = true
            return false
        }
        observed = now
        return true
    }
}
