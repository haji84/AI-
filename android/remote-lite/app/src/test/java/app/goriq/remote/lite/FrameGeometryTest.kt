package app.goriq.remote.lite

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class FrameGeometryTest {
    @Test fun mapsRatiosToTheExactCapturedDisplay() {
        val frame = FrameGeometry(1080, 2400, 0, 1000)
        assertEquals(PixelPoint(0f, 0f), frame.point(0.0, 0.0, 1080, 2400, 0, 1200))
        assertEquals(PixelPoint(1079f, 2399f), frame.point(1.0, 1.0, 1080, 2400, 0, 1200))
    }

    @Test fun refusesStaleRotatedAndResizedFrames() {
        val frame = FrameGeometry(1080, 2400, 0, 1000)
        assertThrows(IllegalStateException::class.java) { frame.point(0.5, 0.5, 1080, 2400, 1, 1200) }
        assertThrows(IllegalStateException::class.java) { frame.point(0.5, 0.5, 1000, 2400, 0, 1200) }
        assertThrows(IllegalStateException::class.java) { frame.point(0.5, 0.5, 1080, 2400, 0, 6001) }
        assertThrows(IllegalStateException::class.java) { frame.point(0.5, 0.5, 1080, 2400, 0, 999) }
    }
}
