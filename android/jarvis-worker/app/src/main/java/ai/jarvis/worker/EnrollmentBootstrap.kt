package ai.jarvis.worker

import java.net.URI

/** Installation configuration only: never accept discovery advertisements as owner identity. */
object EnrollmentBootstrap {
    fun validatedOrigin(value: String): String {
        val uri = URI(value.trim())
        require(uri.scheme == "https" && !uri.host.isNullOrBlank() &&
            uri.rawUserInfo == null && uri.rawQuery == null && uri.rawFragment == null &&
            (uri.rawPath.isNullOrEmpty() || uri.rawPath == "/")) {
            "JARVIS bootstrap requires an HTTPS origin"
        }
        return value.trim().trimEnd('/')
    }
}
