package app.goriq.remote.lite

import org.junit.Assert.*
import org.junit.Test

class CaptureLeaseTest {
    @Test fun noFrameBeforeTheFirstSuccessfulSignedCheck() {
        var now = 10L
        val lease = CaptureLease({ now })
        assertFalse(lease.allowed())
        now = 100
        assertTrue(lease.renew())
        assertTrue(lease.allowed())
        now = 3_099
        assertTrue(lease.allowed())
        now = 3_100
        assertFalse(lease.allowed())
    }

    @Test fun aStalledStatusReplyCannotReviveAnExpiredStreamEvenWithoutAFrameCallback() {
        var now = 0L
        val lease = CaptureLease({ now })
        assertTrue(lease.renew())
        now = 3_000
        assertFalse(lease.renew())
        assertFalse(lease.allowed())
    }

    @Test fun localStopCannotBeUndoneByAnAlreadyRunningStatusRequest() {
        val lease = CaptureLease({ 0L })
        assertTrue(lease.renew())
        lease.close()
        assertFalse(lease.allowed())
        assertFalse(lease.renew())
    }

    @Test fun renewedPermissionUsesTheLatestSuccessfulCheck() {
        var now = 0L
        val lease = CaptureLease({ now })
        assertTrue(lease.renew())
        now = 2_999
        assertTrue(lease.renew())
        now = 5_998
        assertTrue(lease.allowed())
        now = 5_999
        assertFalse(lease.allowed())
    }

    @Test fun initialAuthorizationAlsoHasABoundedWait() {
        var now = 0L
        val lease = CaptureLease({ now })
        now = 3_000
        assertFalse(lease.renew())
        assertFalse(lease.allowed())
    }

    @Test fun relayDeadlineCannotBeExtendedByFreshStatusOrALateWatchdog() {
        var now = 0L
        val lease = CaptureLease({ now }, hardDeadlineElapsed = 6_000)
        assertTrue(lease.renew())
        now = 2_999
        assertTrue(lease.renew())
        now = 5_998
        assertTrue(lease.renew())
        now = 5_999
        assertTrue(lease.allowed())
        now = 6_000
        // Publishing and dispatch call allowed() directly; no watchdog tick is needed.
        assertFalse(lease.allowed())
        assertFalse(lease.renew())
        now = 1
        assertFalse(lease.allowed())
        assertFalse(lease.renew())
    }
}
