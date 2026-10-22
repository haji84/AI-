package app.goriq.remote.lite

import org.junit.Assert.assertSame
import org.junit.Assert.assertThrows
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
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
    private fun stunConfig(session: String = "session-1", device: String = "device-1",
        deadline: Long = expiry,
        servers: List<SessionIceServer> = listOf(SessionIceServer(
            listOf("stun:stun.cloudflare.com:3478"), "", ""))) =
        config(session, device, deadline, "stun-approved-provider", servers)

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

    @Test fun canonicalCloudflareStunIsAcceptedWithoutCredentialsForTheBoundedSession() {
        val stun = stunConfig(deadline = now + 3_600_000)
        assertSame(stun, stun.validated("session-1", "device-1", now))
        assertEquals(3_610_000L, stun.monotonicDeadline(10_000, 10_200))
    }

    @Test fun stunRejectsUnknownProviderPortsAndMixedOrRepeatedUrls() {
        val invalidServers = listOf(
            emptyList(),
            listOf(SessionIceServer(listOf("stun:unexpected.example:3478"), "", "")),
            listOf(SessionIceServer(listOf("stun:stun.cloudflare.com:3479"), "", "")),
            listOf(SessionIceServer(listOf("stun:stun.cloudflare.com"), "", "")),
            listOf(SessionIceServer(listOf("stuns:stun.cloudflare.com:3478"), "", "")),
            listOf(SessionIceServer(listOf("stun:stun.cloudflare.com:3478?transport=udp"), "", "")),
            listOf(SessionIceServer(listOf("stun:stun.cloudflare.com:3478", "turn:relay.example.net:3478"), "", "")),
            listOf(SessionIceServer(List(2) { "stun:stun.cloudflare.com:3478" }, "", "")),
            List(2) { SessionIceServer(listOf("stun:stun.cloudflare.com:3478"), "", "") })
        for (servers in invalidServers) assertThrows(IllegalArgumentException::class.java) {
            stunConfig(servers = servers).validated("session-1", "device-1", now)
        }
    }

    @Test fun stunRejectsAnyUsernameOrCredential() {
        val invalid = listOf("user" to "", "" to password, " " to "", "" to " ")
        for ((username, credential) in invalid) assertThrows(IllegalArgumentException::class.java) {
            stunConfig(servers = listOf(SessionIceServer(listOf("stun:stun.cloudflare.com:3478"),
                username, credential))).validated("session-1", "device-1", now)
        }
    }

    @Test fun stunRetainsSessionDeviceClockExpiryAndMonotonicChecks() {
        val invalid = listOf(stunConfig(session = "other"), stunConfig(device = "other"),
            stunConfig(deadline = now), stunConfig(deadline = now + 3_600_001))
        for (value in invalid) assertThrows(IllegalArgumentException::class.java) {
            value.validated("session-1", "device-1", now)
        }
        val stun = stunConfig()
        assertThrows(IllegalArgumentException::class.java) { stun.validated("session-1", "device-1", now + 30_001) }
        assertThrows(IllegalArgumentException::class.java) { stun.monotonicDeadline(10_000, 9_999) }
        assertThrows(IllegalArgumentException::class.java) { stun.monotonicDeadline(10_000, 70_000) }
    }

    @Test fun stunSurvivesItsInitialIceExpiryWithFreshStatusButStopsWhenStatusExpires() {
        val stun = stunConfig(deadline = now + 6_000)
        val deadline = stun.credentialDeadline(10_000, 10_200)
        assertNull(deadline)
        var elapsed = 10_200L
        val lease = CaptureLease({ elapsed }, hardDeadlineElapsed = deadline ?: Long.MAX_VALUE)
        assertTrue(lease.renew())
        elapsed = 13_199
        assertTrue(lease.renew())
        elapsed = 16_198 // Initial ICE/session idle expiry was 16_000; signed status is still active.
        assertTrue(lease.renew())
        assertTrue(lease.allowed())
        elapsed = 19_198
        assertFalse(lease.allowed())
        assertFalse(lease.renew())
    }

    @Test fun stunRevocationCannotBeUndoneByALateStatusReply() {
        val stun = stunConfig()
        val lease = CaptureLease({ 10_200L },
            hardDeadlineElapsed = stun.credentialDeadline(10_000, 10_200) ?: Long.MAX_VALUE)
        assertTrue(lease.renew())
        // The signed status callback closes the lease on expiry or revocation.
        lease.close()
        assertFalse(lease.allowed())
        assertFalse(lease.renew())
    }

    @Test fun turnKeepsItsFixedCredentialDeadlineAndEveryIceRequestMustFinishBeforeExpiry() {
        assertEquals(70_000L, config().credentialDeadline(10_000, 10_200))
        assertNull(config(mode = "direct-only", servers = emptyList()).credentialDeadline(10_000, 10_200))
        for (ice in listOf(config(), stunConfig(), config(mode = "direct-only", servers = emptyList()))) {
            assertThrows(IllegalArgumentException::class.java) { ice.credentialDeadline(10_000, 70_000) }
        }
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
