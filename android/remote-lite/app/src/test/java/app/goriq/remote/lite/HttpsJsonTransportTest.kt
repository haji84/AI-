package app.goriq.remote.lite

import java.io.BufferedInputStream
import java.net.InetAddress
import java.nio.file.Files
import java.security.KeyStore
import java.util.concurrent.atomic.AtomicInteger
import javax.net.ssl.*
import org.junit.Assert.*
import org.junit.BeforeClass
import org.junit.Test

/** Test trust is scoped to this JVM fixture; production transport has no trust override. */
class HttpsJsonTransportTest {
    companion object {
        private lateinit var serverContext: SSLContext
        private lateinit var trustedFactory: SSLSocketFactory

        @JvmStatic @BeforeClass fun certificate() {
            val path = Files.createTempFile("remote-lite-test-", ".p12")
            Files.delete(path)
            val password = "vm-fixture-only"
            val keytool = java.io.File(System.getProperty("java.home"), "bin/keytool" +
                if ((System.getProperty("os.name") ?: "").startsWith("Windows")) ".exe" else "")
            val process = ProcessBuilder(keytool.path, "-genkeypair", "-alias", "loopback",
                "-keyalg", "EC", "-groupname", "secp256r1", "-storetype", "PKCS12",
                "-keystore", path.toString(), "-storepass", password, "-keypass", password,
                "-dname", "CN=Remote Lite JVM fixture", "-ext", "SAN=ip:127.0.0.1",
                "-validity", "2", "-noprompt").redirectErrorStream(true).start()
            val output = process.inputStream.bufferedReader().readText()
            check(process.waitFor() == 0) { "Fixture certificate failed: $output" }
            val store = KeyStore.getInstance("PKCS12").apply {
                Files.newInputStream(path).use { load(it, password.toCharArray()) }
            }
            Files.delete(path)
            val keyManager = KeyManagerFactory.getInstance(KeyManagerFactory.getDefaultAlgorithm())
                .apply { init(store, password.toCharArray()) }
            serverContext = SSLContext.getInstance("TLS").apply {
                init(keyManager.keyManagers, null, null)
            }
            val trust = TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm())
                .apply { init(store) }
            trustedFactory = SSLContext.getInstance("TLS").apply { init(null, trust.trustManagers, null) }
                .socketFactory
        }
    }

    private class Server(private val status: Int = 200,
        private val response: String = "{\"ok\":true,\"result\":null}",
        private val headers: String = "") : AutoCloseable {
        private val socket = serverContext.serverSocketFactory.createServerSocket(0, 1,
            InetAddress.getByName("127.0.0.1")) as SSLServerSocket
        val hits = AtomicInteger()
        @Volatile var received = ""
        val endpoint = RemoteEndpoint.parse("https://127.0.0.1:${socket.localPort}")
        private val thread = Thread {
            try {
                socket.accept().use { client ->
                    client.soTimeout = 5_000
                    val input = BufferedInputStream(client.getInputStream())
                    fun line(): String {
                        val out = java.io.ByteArrayOutputStream()
                        while (out.size() < 8192) {
                            val value = input.read()
                            if (value == -1 || value == 10) return out.toString("US-ASCII").trimEnd('\r')
                            out.write(value)
                        }
                        error("Oversized test request header")
                    }
                    val start = line()
                    var length = 0
                    while (true) {
                        val item = line()
                        if (item.isEmpty()) break
                        if (item.startsWith("Content-Length:", ignoreCase = true))
                            length = item.substringAfter(':').trim().toInt()
                    }
                    check(start.startsWith("POST /v1/device/"))
                    received = input.readNBytes(length).toString(Charsets.UTF_8)
                    hits.incrementAndGet()
                    val bytes = response.toByteArray(Charsets.UTF_8)
                    client.getOutputStream().apply {
                        write(("HTTP/1.1 $status Fixture\r\nContent-Type: application/json\r\n" +
                            "Content-Length: ${bytes.size}\r\nConnection: close\r\n$headers\r\n")
                            .toByteArray(Charsets.US_ASCII))
                        write(bytes)
                        flush()
                    }
                }
            } catch (_: Exception) { /* TLS denials and close-before-request are expected. */ }
        }.apply { isDaemon = true; start() }
        override fun close() { socket.close(); thread.join(1000) }
    }

    private fun <T> trusted(block: () -> T): T {
        val original = HttpsURLConnection.getDefaultSSLSocketFactory()
        HttpsURLConnection.setDefaultSSLSocketFactory(trustedFactory)
        return try { block() } finally { HttpsURLConnection.setDefaultSSLSocketFactory(original) }
    }

    @Test fun validatedTlsCarriesJsonToTheConfiguredOrigin() = trusted {
        Server().use { server ->
            val result = runCatching { HttpsJsonTransport(server.endpoint).post("/v1/device/propose", "{\"inviteCode\":\"fixture\"}") }
            assertTrue("A trusted HTTPS reply must be accepted", result.isSuccess)
            assertEquals(200, result.getOrThrow().status)
            assertEquals("{\"ok\":true,\"result\":null}", result.getOrThrow().body)
            assertEquals("{\"inviteCode\":\"fixture\"}", server.received)
            assertEquals(1, server.hits.get())
        }
    }

    @Test fun anUntrustedCertificateCannotReceiveTheEnrollmentBody() {
        Server().use { server ->
            assertThrows(SSLException::class.java) {
                HttpsJsonTransport(server.endpoint).post("/v1/device/propose", "{}")
            }
            assertEquals(0, server.hits.get())
        }
    }

    @Test fun signedSessionIceUsesTheValidatedHttpsTransport() = trusted {
        Server().use { server ->
            val body = "{\"sessionId\":\"fixture-session\",\"proof\":{}}"
            val reply = HttpsJsonTransport(server.endpoint).post("/v1/device/ice", body)
            assertEquals(200, reply.status)
            assertEquals("{\"ok\":true,\"result\":null}", reply.body)
            assertEquals(body, server.received)
            assertEquals(1, server.hits.get())
        }
    }

    @Test fun redirectIsRefusedInsteadOfForwardingTheBody() = trusted {
        Server(status = 302, headers = "Location: https://127.0.0.1:1/v1/device/propose\r\n").use { server ->
            assertThrows(IllegalStateException::class.java) {
                HttpsJsonTransport(server.endpoint).post("/v1/device/propose", "{}")
            }
            assertEquals(1, server.hits.get())
        }
    }

    @Test fun requestLimitsAndFixedDeviceRoutesApplyBeforeAnyNetworkCall() {
        Server().use { server ->
            val transport = HttpsJsonTransport(server.endpoint)
            for (path in listOf("/v1/start", "/v1/device/propose?redirect=x", "//evil.example/x")) {
                assertThrows(IllegalArgumentException::class.java) { transport.post(path, "{}") }
            }
            assertThrows(IllegalArgumentException::class.java) {
                transport.post("/v1/device/propose", "x".repeat(98_305))
            }
            assertEquals(0, server.hits.get())
        }
    }

    @Test fun oversizedResponseCannotBecomeAnAcceptedCoordinatorReply(): Unit = trusted {
        Server(response = "x".repeat(98_305)).use { server ->
            assertThrows(IllegalStateException::class.java) {
                HttpsJsonTransport(server.endpoint).post("/v1/device/propose", "{}")
            }
        }
    }
}
