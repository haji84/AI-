package ai.jarvis.worker

object SwipeWakePolicy {
    fun mayDismiss(showing: Boolean, secure: Boolean, deviceLocked: Boolean, busy: Boolean,
                   captureAllowed: Boolean, now: Long, expires: Long) =
        showing && !secure && !deviceLocked && !busy && captureAllowed && now < expires
}
