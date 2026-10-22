package app.goriq.remote.lite

import org.junit.Assert.*
import org.junit.Test

class EnrollmentLinkTest {
    private val code = "a".repeat(48)

    @Test fun invitationBindsOneCanonicalHttpsOriginAndDoesNotPrintTheInvite() {
        val result = runCatching {
            EnrollmentLink.parse("goriqremote://enroll?server=https%3A%2F%2FEXAMPLE.com%3A443%2F&invite=$code")
        }
        assertTrue("A valid invitation must open a preview", result.isSuccess)
        val link = result.getOrThrow()
        assertEquals("https://example.com", link.endpoint.origin)
        assertEquals(code, link.inviteCode)
        assertFalse(link.toString().contains(code))
    }

    @Test fun endpointCannotContainCredentialsPathsOrDowngrade() {
        for (origin in listOf("http://example.com", "https://a:b@example.com", "https://example.com/api",
            "https://example.com?x=1", "https://example.com#x", "https://example.com:0",
            "https://example.com:65536", "https://example.com\\@evil.com", "https://example.com.")) {
            assertThrows(origin, IllegalArgumentException::class.java) { RemoteEndpoint.parse(origin) }
        }
        assertEquals("https://127.0.0.1:9443", RemoteEndpoint.parse("https://127.0.0.1:9443").origin)
    }

    @Test fun duplicateEncodedOrUnknownParametersCannotChangeTheServer() {
        for (link in listOf(
            "goriqremote://enroll?server=https%3A%2F%2Fa.example&server=https%3A%2F%2Fb.example&invite=$code",
            "goriqremote://enroll?server=https%3A%2F%2Fa.example&%73erver=https%3A%2F%2Fb.example&invite=$code",
            "goriqremote://enroll?server=https%3A%2F%2Fa.example&invite=$code&auto=true",
            "goriqremote://enroll?server=https%3A%2F%2Fa.example&invite=$code#hidden",
            "goriqremote://enroll/other?server=https%3A%2F%2Fa.example&invite=$code",
            "goriqremote://user@enroll?server=https%3A%2F%2Fa.example&invite=$code",
            "goriqremote://enroll?server=https%3A%2F%2Fa.example&invite=short",
            "goriqremote://enroll?server=%zz&invite=$code")) {
            assertThrows(link, IllegalArgumentException::class.java) { EnrollmentLink.parse(link) }
        }
    }
}
