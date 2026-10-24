package app.goriq.remote.lite

import android.content.Context

/** Only registration metadata is persisted. Invitations/private keys/viewer tokens never enter it. */
class EnrollmentSettings(context: Context) : EnrollmentStateStore {
    private val prefs = context.getSharedPreferences("remote_lite_setup", Context.MODE_PRIVATE)

    override fun read(): SavedEnrollment? {
        if (!prefs.contains("origin")) {
            check(prefs.all.isEmpty()) { "Incomplete saved enrollment" }
            return null
        }
        val origin = RemoteEndpoint.parse(checkNotNull(prefs.getString("origin", null))).origin
        val phase = checkNotNull(prefs.getString("phase", null))
        val id = checkNotNull(prefs.getString("device_id", null))
        val fingerprint = checkNotNull(prefs.getString("fingerprint", null))
        val request = prefs.getString("request_id", null)
        val previous = prefs.getString("previous_request_ids", "")!!.split(",").filter { it.isNotEmpty() }
        check(phase in setOf("requesting", "awaiting-owner-approval", "approved") &&
            Regex("[A-Za-z0-9._:-]{1,128}").matches(id) &&
            Regex("[0-9a-f]{64}").matches(fingerprint) &&
            (request == null || Regex("[0-9a-f-]{36}").matches(request)) &&
            (phase != "awaiting-owner-approval" || request != null) &&
            previous.size <= 32 && previous.distinct().size == previous.size &&
            previous.all { Regex("[0-9a-f-]{36}").matches(it) }) { "Invalid saved enrollment" }
        return SavedEnrollment(origin, phase, id, fingerprint, request, previous)
    }

    override fun write(value: SavedEnrollment) {
        val editor = prefs.edit().putString("origin", value.origin).putString("phase", value.phase)
            .putString("device_id", value.deviceId).putString("fingerprint", value.fingerprint)
            .putString("previous_request_ids", value.previousRequestIds.joinToString(","))
        if (value.requestId == null) editor.remove("request_id") else editor.putString("request_id", value.requestId)
        check(editor.commit()) { "Could not persist enrollment" }
    }
}
