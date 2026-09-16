package ai.jarvis.worker

import org.junit.Assert.*
import org.junit.Test

class UpdatePolicyTest {
    @Test fun onlyOfficialHttpsArtifactAndAssetRedirects() {
        assertTrue(UpdatePolicy.allowedUrl(UpdatePolicy.APK_URL))
        assertTrue(UpdatePolicy.allowedUrl("https://release-assets.githubusercontent.com/github-production-release-asset/x?sig=fixture"))
        for (url in listOf("http://github.com/haji84/AI-/releases/download/jarvis-worker-latest/jarvis-worker.apk",
            "https://github.com/other/repo/file", "https://github.com.evil.test/apk",
            "https://user:password@release-assets.githubusercontent.com/x", "https://release-assets.githubusercontent.com:8443/x",
            "file:///tmp/apk", "https://192.168.0.169:8792/downloads/jarvis-worker.apk")) assertFalse(url, UpdatePolicy.allowedUrl(url))
    }
    @Test fun signerPackageAndVersionMustAllMatch() {
        fun allowed(pkg: String = "ai.jarvis.worker", version: Long = 17, signatures: Set<String> = setOf("owner")) =
            UpdatePolicy.trustedUpgrade(pkg, "ai.jarvis.worker", version, 16, signatures, setOf("owner"))
        assertTrue(allowed())
        assertFalse(allowed(pkg = "another.app")); assertFalse(allowed(version = 16)); assertFalse(allowed(version = 15))
        assertFalse(allowed(signatures = emptySet())); assertFalse(allowed(signatures = setOf("attacker")))
        assertFalse(allowed(signatures = setOf("owner", "attacker")))
    }
    @Test fun checksAreBoundedButRecoverFromClockRollback() {
        assertTrue(UpdatePolicy.due(0, 100)); assertFalse(UpdatePolicy.due(100, 101))
        assertTrue(UpdatePolicy.due(100, 100 + UpdatePolicy.CHECK_INTERVAL_MS))
        assertTrue(UpdatePolicy.due(200, 100))
    }
}
