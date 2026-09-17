package ai.jarvis.worker

import org.junit.Assert.*
import org.junit.Test

class RemoteSupportTest {
    @Test fun legacyRequiresLiveConsentAndAccessibility() {
        for (api in 26..29) {
            assertFalse(RemoteSupport.available(api, true, false))
            assertFalse(RemoteSupport.available(api, false, true))
            assertTrue(RemoteSupport.available(api, true, true))
        }
        assertFalse(RemoteSupport.available(25, true, true))
        assertTrue(RemoteSupport.available(30, true, false))
        assertFalse(RemoteSupport.available(30, false, false))
    }
    @Test fun noUpdateDuringEnrollmentInputOrSharing() {
        fun idle(enrolled: Boolean = true, working: Boolean = false, visible: Boolean = false,
                 projection: Boolean = false, now: Long = 90_000, last: Long = 0, manual: Boolean = false) =
            RemoteSupport.updateIdle(enrolled, working, visible, projection, now, last, manual)
        assertTrue(idle())
        assertFalse(idle(enrolled = false)); assertFalse(idle(working = true))
        assertFalse(idle(visible = true)); assertFalse(idle(projection = true))
        assertFalse(idle(last = 85_000)); assertFalse(idle(last = 100_000))
        assertTrue(idle(visible = true, manual = true))
        assertFalse(idle(enrolled = false, manual = true))
    }
}
