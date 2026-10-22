package app.goriq.remote.lite

/** Serializes local stop with the instant an OS input is issued, not its later completion. */
class InputDispatchGate {
    private var open = true
    @Synchronized fun emit(operation: () -> Boolean): Boolean = open && operation()
    @Synchronized fun close() { open = false }
}
