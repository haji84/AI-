package app.goriq.remote.lite

import android.content.Context

/** Only the last session's applied signaling position, never SDP/ICE or credentials. */
class SignalCursorSettings(context: Context) : SignalCursorStore {
    companion object { private val lock = Any() }
    private val prefs = context.getSharedPreferences("remote_lite_signal_cursor", Context.MODE_PRIVATE)
    override fun read(session: String): Long = synchronized(lock) {
        val snapshot = prefs.all
        if (snapshot.isEmpty()) return@synchronized 0L
        val storedSession = snapshot["session"] as? String ?: error("Incomplete signal cursor")
        val cursor = snapshot["cursor"] as? Long ?: error("Missing signal cursor")
        check(Regex("[A-Za-z0-9._:-]{1,128}").matches(storedSession)) { "Invalid cursor session" }
        check(cursor in 0..9_007_199_254_740_991L) { "Invalid signal cursor" }
        if (storedSession == session) cursor else 0L
    }
    override fun write(session: String, cursor: Long) = synchronized(lock) {
        require(Regex("[A-Za-z0-9._:-]{1,128}").matches(session) && cursor in 0..9_007_199_254_740_991L)
        check(cursor >= read(session)) { "Cannot move a saved cursor backwards" }
        check(prefs.edit().putString("session", session).putLong("cursor", cursor).commit()) {
            "Could not persist signal cursor"
        }
    }
}
