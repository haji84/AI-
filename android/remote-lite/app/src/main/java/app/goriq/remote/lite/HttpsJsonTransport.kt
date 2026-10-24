package app.goriq.remote.lite

import java.io.ByteArrayOutputStream
import java.net.URL
import java.nio.ByteBuffer
import java.nio.charset.CodingErrorAction
import javax.net.ssl.HttpsURLConnection

data class JsonReply(val status: Int, val body: String) {
    override fun toString(): String = "JsonReply(status=$status, body=redacted)"
}

class HttpsJsonTransport(private val endpoint: RemoteEndpoint) {
    private val routes = setOf("/v1/device/propose", "/v1/device/prove", "/v1/device/pending",
        "/v1/device/active", "/v1/device/challenge", "/v1/device/accept", "/v1/device/status",
        "/v1/device/signal", "/v1/device/poll", "/v1/device/end", "/v1/device/ice")

    fun post(path: String, body: String): JsonReply {
        require(path in routes) { "Unsupported device endpoint" }
        val bytes = body.toByteArray(Charsets.UTF_8)
        require(bytes.size <= 98_304) { "Coordinator request too large" }
        val connection = URL(endpoint.origin + path).openConnection() as HttpsURLConnection
        try {
            connection.requestMethod = "POST"
            connection.instanceFollowRedirects = false
            connection.useCaches = false
            connection.connectTimeout = 5_000
            connection.readTimeout = 5_000
            connection.setRequestProperty("Content-Type", "application/json")
            connection.setRequestProperty("Accept", "application/json")
            connection.doOutput = true
            connection.setFixedLengthStreamingMode(bytes.size)
            connection.outputStream.use { it.write(bytes) }
            val status = connection.responseCode
            check(status !in 300..399) { "Coordinator redirect refused" }
            check(connection.contentType?.substringBefore(';')?.trim()
                ?.equals("application/json", ignoreCase = true) == true) { "Coordinator content type refused" }
            check(connection.contentLengthLong <= 98_304) { "Coordinator response too large" }
            val output = ByteArrayOutputStream()
            val stream = if (status in 200..299) connection.inputStream else connection.errorStream
            checkNotNull(stream) { "Missing coordinator response" }.use { input ->
                val buffer = ByteArray(4096)
                while (true) {
                    val count = input.read(buffer)
                    if (count < 0) break
                    check(output.size() + count <= 98_304) { "Coordinator response too large" }
                    output.write(buffer, 0, count)
                }
            }
            val decoded = Charsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT)
                .onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(output.toByteArray()))
            return JsonReply(status, decoded.toString())
        } finally { connection.disconnect() }
    }
}
