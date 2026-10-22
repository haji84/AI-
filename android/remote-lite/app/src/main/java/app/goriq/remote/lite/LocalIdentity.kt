package app.goriq.remote.lite

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.MessageDigest
import java.security.Signature
import java.security.spec.ECGenParameterSpec
import java.util.UUID

/** A separate AndroidKeyStore identity; no JARVIS/GORIQ owner credential is reused. */
class LocalIdentity(context: Context) : EnrollmentIdentity {
    private val prefs = context.getSharedPreferences("remote_lite_identity", Context.MODE_PRIVATE)
    private val alias = "remote_lite_p256_v1"

    private fun store() = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }

    fun ensure(): String {
        val saved = prefs.getString("device_id", null)
        val hasKey = store().containsAlias(alias)
        if (saved != null && hasKey) return saved
        check(saved == null && !hasKey) { "Device identity is incomplete; re-pairing needs local approval" }
        val generator = KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, "AndroidKeyStore")
        generator.initialize(KeyGenParameterSpec.Builder(alias,
            KeyProperties.PURPOSE_SIGN or KeyProperties.PURPOSE_VERIFY)
            .setAlgorithmParameterSpec(ECGenParameterSpec("secp256r1"))
            .setDigests(KeyProperties.DIGEST_SHA256)
            .setUserAuthenticationRequired(false).build())
        generator.generateKeyPair()
        val id = UUID.randomUUID().toString()
        check(prefs.edit().putString("device_id", id).commit()) { "Could not persist device ID" }
        return id
    }

    override fun deviceId(): String = ensure()

    override fun publicKeyPem(): String {
        ensure()
        val encoded = store().getCertificate(alias).publicKey.encoded
        val body = Base64.encodeToString(encoded, Base64.NO_WRAP).chunked(64).joinToString("\n")
        return "-----BEGIN PUBLIC KEY-----\n$body\n-----END PUBLIC KEY-----\n"
    }

    override fun fingerprint(): String {
        ensure()
        val encoded = store().getCertificate(alias).publicKey.encoded
        return MessageDigest.getInstance("SHA-256").digest(encoded)
            .joinToString("") { "%02x".format(it) }
    }

    override fun sign(message: String): String {
        ensure()
        val privateKey = store().getKey(alias, null) as java.security.PrivateKey
        val signer = Signature.getInstance("SHA256withECDSA")
        signer.initSign(privateKey)
        signer.update(message.toByteArray(Charsets.UTF_8))
        return Base64.encodeToString(signer.sign(), Base64.NO_WRAP)
    }
}
