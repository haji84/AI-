package ai.jarvis.worker

import java.net.URI

/** Public artifact only: never send Broker credentials to the release host. */
object UpdatePolicy {
    const val APK_URL = "https://github.com/haji84/AI-/releases/download/jarvis-worker-latest/jarvis-worker.apk"
    const val MAX_BYTES = 32L * 1024 * 1024
    const val CHECK_INTERVAL_MS = 60L * 60 * 1000
    fun allowedUrl(value: String): Boolean = runCatching {
        val uri = URI(value)
        uri.scheme == "https" && uri.userInfo == null && uri.port in listOf(-1, 443) &&
            (value == APK_URL || uri.host == "release-assets.githubusercontent.com")
    }.getOrDefault(false)
    fun due(last: Long, now: Long): Boolean = last == 0L || now < last || now - last >= CHECK_INTERVAL_MS
    fun trustedUpgrade(packageName: String, expectedPackage: String, version: Long, installed: Long,
                       signers: Set<String>, installedSigners: Set<String>): Boolean =
        packageName == expectedPackage && version > installed && signers.isNotEmpty() && signers == installedSigners
}
