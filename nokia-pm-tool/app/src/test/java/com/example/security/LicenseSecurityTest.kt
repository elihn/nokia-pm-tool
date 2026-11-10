package com.example.security

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.security.KeyFactory
import java.security.Signature
import java.security.spec.PKCS8EncodedKeySpec

class LicenseSecurityTest {

    // Reference test keypair matching backend/config/ed25519_keys.json
    private val serverPrivateKeyHex = "24726a9eb1aaa3b78226b9f8e58e7fffc53dd2a1fd43fbcb8463c7e3d14358f0"
    private val serverPublicKeyHex = "291443119ec1d1f8b189bb9873d690e1d37c67948fba1b1baf035ba312fb8074"

    @Test
    fun testEd25519SignatureVerificationWithServerKeys() {
        val message = "{\"license_key\":\"NOKIA-TEST-1234\",\"installation_id\":\"NOKIA_DEV_ABC\"}"
        val messageBytes = message.toByteArray(Charsets.UTF_8)

        // Sign using Java / Conscrypt Ed25519 (available in JVM test environment)
        val pkcs8Prefix = byteArrayOf(
            0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20
        )
        val privBytes = hexToBytes(serverPrivateKeyHex)
        val privKeySpec = PKCS8EncodedKeySpec(pkcs8Prefix + privBytes)
        val kf = KeyFactory.getInstance("Ed25519")
        val privKey = kf.generatePrivate(privKeySpec)

        val sig = Signature.getInstance("Ed25519")
        sig.initSign(privKey)
        sig.update(messageBytes)
        val signatureBytes = sig.sign()
        val signatureHex = signatureBytes.joinToString("") { "%02x".format(it) }

        // Verify using Ed25519Verifier
        val isValid = Ed25519Verifier.verify(messageBytes, signatureHex, serverPublicKeyHex)
        assertTrue("Valid signature must pass Ed25519 verification", isValid)

        // Tamper message: must fail
        val tamperedMessage = "{\"license_key\":\"NOKIA-TEST-HACK\",\"installation_id\":\"NOKIA_DEV_ABC\"}"
        val isTamperedValid = Ed25519Verifier.verify(tamperedMessage.toByteArray(Charsets.UTF_8), signatureHex, serverPublicKeyHex)
        assertFalse("Tampered message must be rejected", isTamperedValid)

        // Tamper signature: must fail
        val tamperedSigHex = signatureHex.substring(0, signatureHex.length - 2) + "00"
        val isTamperedSigValid = Ed25519Verifier.verify(messageBytes, tamperedSigHex, serverPublicKeyHex)
        assertFalse("Tampered signature must be rejected", isTamperedSigValid)
    }

    private fun hexToBytes(hex: String): ByteArray {
        val clean = hex.trim().replace(" ", "")
        val len = clean.length
        val data = ByteArray(len / 2)
        var i = 0
        while (i < len) {
            data[i / 2] = ((Character.digit(clean[i], 16) shl 4) + Character.digit(clean[i + 1], 16)).toByte()
            i += 2
        }
        return data
    }
}
