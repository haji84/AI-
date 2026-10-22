package app.goriq.remote.lite

import org.junit.Assert.assertSame
import org.junit.Assert.assertThrows
import org.junit.Assert.assertEquals
import org.junit.Test
import java.util.Base64

class SessionIceTest {
    private val now = 1_000_000L
    private val expiry = now + 60_000L
    private val password = Base64.getEncoder().encodeToString(ByteArray(20) { 1 })
    private fun server(url: String = "turns:relay.example.net:5349?transport=tcp",
        username: String = "1060:" + "a".repeat(32), credential: String = password) =
        SessionIceServer(listOf(url), username, credential)
    private fun config(session: String = "session-1", device: String = "device-1",
        deadline: Long = expiry, mode: String = "turn-ephemeral-approved-provider",
        servers: List<SessionIceServer> = listOf(server())) =
        DeviceSessionIce(session, device, deadline, mode, servers, now)

    @Test fun validRelayAndExplicitDirectConfigurationAreAccepted() {
        val relay = config()
        assertSame(relay, relay.validated("session-1", "device-1", now))
        val direct = config(mode = "direct-only", servers = emptyList())
        assertSame(direct, direct.validated("session-1", "device-1", now))
    }

    @Test fun serverDurationAllowsSmallClockSkewAndUsesAConservativeMonotonicDeadline() {
        val relay = config(deadline = now + 600_000,
            servers = listOf(server(username = "1600:" + "a".repeat(32))))
        assertSame(relay, relay.validated("session-1", "device-1", now - 1_000))
        assertSame(relay, relay.validated("session-1", "device-1", now + 1_000))
        // Deadline is based on request start, so a 200ms fetch consumes 200ms.
        assertEquals(610_000L, relay.monotonicDeadline(10_000, 10_200))
        assertThrows(IllegalArgumentException::class.java) { relay.monotonicDeadline(10_000, 9_999) }
        assertThrows(IllegalArgumentException::class.java) { relay.monotonicDeadline(10_000, 610_000) }
        assertThrows(IllegalArgumentException::class.java) { relay.validated("session-1", "device-1", now - 30_001) }
    }

    @Test fun wrongBindingExpiryModeAndRelayShapeAreRefused() {
        val invalid = listOf(config(session = "other"), config(device = "other"),
            config(deadline = now), config(deadline = now + 600_001), config(mode = "unknown"),
            config(servers = emptyList()), config(mode = "direct-only"),
            config(servers = List(5) { server() }),
            config(servers = listOf(server(url = "https://unexpected.example"))),
            config(servers = listOf(server(url = "turn:relay.example.net:0"))),
            config(servers = listOf(server(url = "turn:relay.example.net:99999"))),
            config(servers = listOf(server(username = "wrong"))),
            config(servers = listOf(server(username = "1061:" + "a".repeat(32)))),
            config(servers = listOf(server(credential = "wrong"))))
        for (value in invalid) assertThrows(IllegalArgumentException::class.java) {
            value.validated("session-1", "device-1", now)
        }
    }
}
