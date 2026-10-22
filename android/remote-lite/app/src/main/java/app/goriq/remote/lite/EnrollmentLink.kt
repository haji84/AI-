package app.goriq.remote.lite

import java.net.URI
import java.net.URLDecoder
import java.util.Locale

class RemoteEndpoint private constructor(val origin: String) {
    companion object {
        fun parse(value: String): RemoteEndpoint {
            require(value.length in 1..512) { "Invalid server address" }
            val uri = try { URI(value.trim()) } catch (_: Exception) {
                throw IllegalArgumentException("Invalid server address")
            }
            val host = uri.host?.lowercase(Locale.ROOT)
            require(uri.scheme?.lowercase(Locale.ROOT) == "https" && !host.isNullOrEmpty() &&
                !host.endsWith('.') && uri.rawUserInfo == null &&
                (uri.rawPath.isNullOrEmpty() || uri.rawPath == "/") &&
                uri.rawQuery == null && uri.rawFragment == null &&
                (uri.port == -1 || uri.port in 1..65535)) { "An HTTPS server origin is required" }
            return RemoteEndpoint(URI("https", null, host, if (uri.port == 443) -1 else uri.port,
                null, null, null).toASCIIString())
        }
    }
    override fun toString(): String = origin
}

class EnrollmentLink private constructor(val endpoint: RemoteEndpoint, val inviteCode: String) {
    companion object {
        fun parse(value: String): EnrollmentLink {
            require(value.length in 1..2048) { "Invalid invitation" }
            val uri = try { URI(value.trim()) } catch (_: Exception) {
                throw IllegalArgumentException("Invalid invitation")
            }
            require(uri.scheme == "goriqremote" && uri.rawAuthority == "enroll" &&
                uri.rawPath.isNullOrEmpty() && uri.rawFragment == null) { "Invalid invitation" }
            val values = mutableMapOf<String, String>()
            for (part in (uri.rawQuery ?: "").split('&')) {
                val pair = part.split('=', limit = 2)
                require(pair.size == 2) { "Invalid invitation parameter" }
                val key: String
                val item: String
                try {
                    key = URLDecoder.decode(pair[0], "UTF-8")
                    item = URLDecoder.decode(pair[1], "UTF-8")
                } catch (_: Exception) { throw IllegalArgumentException("Invalid invitation encoding") }
                require(key in setOf("server", "invite") && !values.containsKey(key)) {
                    "Duplicate or unknown invitation parameter"
                }
                values[key] = item
            }
            require(values.keys == setOf("server", "invite")) { "Incomplete invitation" }
            val code = requireNotNull(values["invite"])
            require(Regex("[0-9a-f]{48}").matches(code)) { "Invalid invitation code" }
            return EnrollmentLink(RemoteEndpoint.parse(requireNotNull(values["server"])), code)
        }
    }
    override fun toString(): String = "EnrollmentLink(server=${endpoint.origin}, invite=redacted)"
}
