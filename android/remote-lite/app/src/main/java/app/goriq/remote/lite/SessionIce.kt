package app.goriq.remote.lite

import java.util.Base64

// Memory-only DTOs: default Object.toString never includes credentials.
class SessionIceServer(val urls: List<String>, val username: String, val credential: String)

class DeviceSessionIce(val sessionId: String, val deviceId: String, val expiresAt: Long,
    val mode: String, val iceServers: List<SessionIceServer>, val serverTime: Long) {
    fun validated(expectedSession: String, expectedDevice: String, now: Long): DeviceSessionIce {
        require(sessionId == expectedSession && deviceId == expectedDevice) { "Session ICE binding mismatch" }
        require(now in 1..9_007_199_254_740_991L && serverTime in 1..9_007_199_254_740_991L &&
            kotlin.math.abs(serverTime - now) <= 30_000 && expiresAt > serverTime &&
            expiresAt <= serverTime + 3_600_000) { "Session ICE expired or invalid" }
        if (mode == "direct-only") {
            require(iceServers.isEmpty()) { "Direct ICE contains relay credentials" }
            return this
        }
        require(mode == "turn-ephemeral-approved-provider" && iceServers.size in 1..4 &&
            expiresAt <= serverTime + 600_000) { "Relay ICE unavailable" }
        val url = Regex("turns?:[A-Za-z0-9.-]+(?::([0-9]{1,5}))?(?:\\?transport=(?:udp|tcp))?")
        for (server in iceServers) {
            require(server.urls.size in 1..4 && server.urls.all {
                val match = url.matchEntire(it)
                it.length <= 256 && !it.contains("..") && match != null &&
                    (match.groupValues[1].isEmpty() || match.groupValues[1].toInt() in 1..65535)
            }) { "Relay URL invalid" }
            require(Regex("[1-9][0-9]{0,12}:[a-f0-9]{32}").matches(server.username) &&
                server.username.substringBefore(':').toLong() * 1000 == expiresAt) { "Relay username invalid" }
            require(server.credential.length == 28) { "Relay credential invalid" }
            val bytes = Base64.getDecoder().decode(server.credential)
            require(bytes.size == 20 && Base64.getEncoder().encodeToString(bytes) == server.credential) {
                "Relay credential invalid"
            }
        }
        return this
    }

    /** Count the whole request against remaining server duration; wall-clock changes cannot extend it. */
    fun monotonicDeadline(started: Long, received: Long): Long {
        val remaining = expiresAt - serverTime
        require(remaining in 1..3_600_000 && started >= 0 && received >= started &&
            received - started < remaining && started <= Long.MAX_VALUE - remaining) { "Session ICE request expired" }
        return started + remaining
    }
}
