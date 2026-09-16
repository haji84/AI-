package ai.jarvis.worker

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class EnrollmentBootstrapTest {
    @Test fun acceptsOnlyConfiguredHttpsOrigin() {
        assertEquals("https://jarvis.example:8443", EnrollmentBootstrap.validatedOrigin("https://jarvis.example:8443/"))
    }

    @Test fun rejectsCredentialsPathsAndUnencryptedHosts() {
        listOf("http://192.168.1.2", "https://user:password@jarvis.example", "https://jarvis.example/enroll",
            "https://jarvis.example?token=secret", "https://jarvis.example#token", "https:///", "").forEach {
            assertThrows(Exception::class.java) { EnrollmentBootstrap.validatedOrigin(it) }
        }
    }
}
