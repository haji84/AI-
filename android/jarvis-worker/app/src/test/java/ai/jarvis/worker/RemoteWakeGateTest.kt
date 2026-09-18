package ai.jarvis.worker

import org.junit.Assert.*
import org.junit.Test

class RemoteWakeGateTest {
    private class Device {
        var now = 1_000L; var on = false; var locked = false; var busy = false; var capture = true
        var wakes = 0; var afterPause: () -> Unit = { on = true }; var wakeError = false
        fun run(expiry: Long = 9_000) = RemoteWakeGate.awaitReady(expiry, { now }, { now }, { on },
            { locked }, { busy }, { capture }, { duration -> assertTrue(duration in 1..8_000); wakes++; if(wakeError) throw SecurityException() },
            { now += it; afterPause() })
    }
    private fun fails(code: String, block: () -> Unit) {
        try { block(); fail("Expected failure") } catch (e: RemoteWakeFailure) { assertEquals(code, e.code) }
    }
    @Test fun wakesOnceThenContinues() { val d = Device(); assertTrue(d.run()); assertEquals(1, d.wakes) }
    @Test fun interactiveNeedsNoWake() { val d = Device(); d.on = true; assertFalse(d.run()); assertEquals(0, d.wakes) }
    @Test fun expiredLockedBusyAndMissingConsentNeverWake() {
        val d = Device(); fails("COMMAND_EXPIRED") { d.run(1_000) }
        d.locked = true; fails("UNLOCK_REQUIRED") { d.run() }; d.locked = false
        d.busy = true; fails("DEVICE_BUSY") { d.run() }; d.busy = false
        d.capture = false; fails("CAPTURE_CONSENT_REQUIRED") { d.run() }; assertEquals(0,d.wakes)
    }
    @Test fun wakeTimeoutAndCommandDeadlineAreBounded() {
        val d = Device(); d.afterPause = {}; fails("WAKE_TIMEOUT") { d.run() }; assertEquals(3_000L,d.now)
        val e = Device(); e.afterPause = {}; fails("COMMAND_EXPIRED") { e.run(1_100) }; assertEquals(1_100L,e.now)
    }
    @Test fun lockingOrRevocationWhileWakingStopsInput() {
        val d = Device(); d.afterPause = { d.on = true; d.locked = true }; fails("UNLOCK_REQUIRED") { d.run() }
        val e = Device(); e.afterPause = { e.on = true; e.capture = false }; fails("CAPTURE_CONSENT_REQUIRED") { e.run() }
    }
    @Test fun wakeDenialNeverBecomesSuccess() {
        val d = Device(); d.wakeError = true
        try { d.run(); fail("Expected denial") } catch (_: SecurityException) { assertEquals(1, d.wakes) }
    }
}
