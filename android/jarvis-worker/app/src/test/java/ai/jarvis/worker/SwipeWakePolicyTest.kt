package ai.jarvis.worker

import org.junit.Assert.*
import org.junit.Test

class SwipeWakePolicyTest {
    @Test fun onlyVisibleNonSecureKeyguardCanBeDismissed() {
        assertTrue(SwipeWakePolicy.mayDismiss(true, false, false, false, true, 1000, 2000))
        assertFalse(SwipeWakePolicy.mayDismiss(false, false, false, false, true, 1000, 2000))
        assertFalse(SwipeWakePolicy.mayDismiss(true, true, false, false, true, 1000, 2000))
        assertFalse(SwipeWakePolicy.mayDismiss(true, false, true, false, true, 1000, 2000))
        assertFalse(SwipeWakePolicy.mayDismiss(true, false, false, true, true, 1000, 2000))
        assertFalse(SwipeWakePolicy.mayDismiss(true, false, false, false, false, 1000, 2000))
        assertFalse(SwipeWakePolicy.mayDismiss(true, false, false, false, true, 2000, 2000))
    }
}
