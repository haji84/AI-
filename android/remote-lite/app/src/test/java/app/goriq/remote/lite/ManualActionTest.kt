package app.goriq.remote.lite

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class ManualActionTest {
    @Test fun browserSwipeDurationMustMeetTheNativeMinimum() {
        for (duration in listOf(50L, 99L)) {
            assertThrows(IllegalArgumentException::class.java) {
                ManualAction.parse("swipe", 0.5, 0.75, 0.5, 0.3, duration)
            }
        }
        assertEquals(ManualAction.Swipe(0.5, 0.75, 0.5, 0.3, 100),
            ManualAction.parse("swipe", 0.5, 0.75, 0.5, 0.3, 100))
    }

    @Test fun onlyBoundedHumanInputIsAccepted() {
        assertEquals(ManualAction.Tap(0.5, 0.25), ManualAction.parse("tap", 0.5, 0.25))
        assertEquals(ManualAction.Swipe(0.1, 0.2, 0.8, 0.9, 350),
            ManualAction.parse("swipe", 0.1, 0.2, 0.8, 0.9, 350))
        assertEquals(ManualAction.Back, ManualAction.parse("back"))
        for (action in listOf("shell", "execute", "task", "ai", "script")) {
            assertThrows(IllegalArgumentException::class.java) { ManualAction.parse(action) }
        }
        assertThrows(IllegalArgumentException::class.java) { ManualAction.parse("tap", Double.NaN, 0.5) }
        assertThrows(IllegalArgumentException::class.java) { ManualAction.parse("tap", 1.01, 0.5) }
        assertThrows(IllegalArgumentException::class.java) { ManualAction.parse("swipe", 0.1, 0.2, 0.8, 0.9, 6000) }
    }
}
