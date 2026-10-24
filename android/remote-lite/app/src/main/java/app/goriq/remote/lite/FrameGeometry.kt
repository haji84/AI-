package app.goriq.remote.lite

data class PixelPoint(val x: Float, val y: Float)

/** A gesture is valid only against the recent, full-display frame the viewer saw. */
data class FrameGeometry(
    val width: Int,
    val height: Int,
    val rotation: Int,
    val capturedAtElapsedMs: Long,
) {
    fun point(
        x: Double,
        y: Double,
        displayWidth: Int,
        displayHeight: Int,
        displayRotation: Int,
        nowElapsedMs: Long,
    ): PixelPoint {
        require(x.isFinite() && y.isFinite() && x in 0.0..1.0 && y in 0.0..1.0) {
            "Invalid coordinate"
        }
        check(width > 0 && height > 0 && width == displayWidth && height == displayHeight) {
            "Display dimensions changed"
        }
        check(rotation == displayRotation) { "Display rotated" }
        check(nowElapsedMs - capturedAtElapsedMs in 0L..5_000L) { "Frame expired" }
        return PixelPoint(((width - 1) * x).toFloat(), ((height - 1) * y).toFloat())
    }
}
