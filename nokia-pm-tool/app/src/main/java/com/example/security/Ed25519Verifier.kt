package com.example.security

import java.math.BigInteger
import java.security.KeyFactory
import java.security.MessageDigest
import java.security.Signature
import java.security.spec.X509EncodedKeySpec

/**
 * Validates Ed25519 asymmetric signatures issued by the Nokia PM licensing backend.
 * Contains the official Server Public Key (never the private key).
 * Supports standard Java/Android Ed25519 and includes an RFC 8032 pure-math fallback
 * for maximum compatibility across all Android versions without external native libraries.
 */
object Ed25519Verifier {

    // Official Server Public Key (32-byte Ed25519 key in Hex)
    const val SERVER_PUBLIC_KEY_HEX = "291443119ec1d1f8b189bb9873d690e1d37c67948fba1b1baf035ba312fb8074"

    // SPKI DER Prefix for Ed25519: 30 2a 30 05 06 03 2b 65 70 03 21 00
    private val SPKI_PREFIX = byteArrayOf(
        0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00
    )

    /**
     * Verifies that [messageBytes] was signed by the server's Ed25519 private key.
     * @param messageBytes The exact UTF-8 bytes of the token payload JSON
     * @param signatureHex 64-byte signature encoded as 128 hex characters
     * @param publicKeyHex Optional override for testing; defaults to [SERVER_PUBLIC_KEY_HEX]
     */
    fun verify(
        messageBytes: ByteArray,
        signatureHex: String,
        publicKeyHex: String = SERVER_PUBLIC_KEY_HEX
    ): Boolean {
        return try {
            val signatureBytes = hexToBytes(signatureHex)
            val pubKeyBytes = hexToBytes(publicKeyHex)
            if (signatureBytes.size != 64 || pubKeyBytes.size != 32) return false

            // Try standard platform Ed25519 first (Android 12+, Java 15+)
            try {
                val spkiBytes = SPKI_PREFIX + pubKeyBytes
                val keySpec = X509EncodedKeySpec(spkiBytes)
                val keyFactory = KeyFactory.getInstance("Ed25519")
                val publicKey = keyFactory.generatePublic(keySpec)

                val sig = Signature.getInstance("Ed25519")
                sig.initVerify(publicKey)
                sig.update(messageBytes)
                return sig.verify(signatureBytes)
            } catch (ignored: Exception) {
                // Platform does not have native Ed25519 provider; use pure RFC 8032 fallback
                verifyRfc8032(messageBytes, signatureBytes, pubKeyBytes)
            }
        } catch (e: Exception) {
            e.printStackTrace()
            false
        }
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

    // =========================================================================
    // RFC 8032 Ed25519 Pure Math Implementation (Zero native dependencies)
    // Curve: -x^2 + y^2 = 1 + d*x^2*y^2 (mod p)
    // =========================================================================

    private val P = BigInteger.valueOf(2).pow(255).subtract(BigInteger.valueOf(19))
    private val L = BigInteger.valueOf(2).pow(252).add(BigInteger("27742317777372353535851937790883648493"))
    private val D = BigInteger("-121665").multiply(BigInteger("121666").modInverse(P)).mod(P)
    private val I = BigInteger.valueOf(2).modPow(P.subtract(BigInteger.ONE).divide(BigInteger.valueOf(4)), P)

    private val B_Y = BigInteger.valueOf(4).multiply(BigInteger.valueOf(5).modInverse(P)).mod(P)
    private val B_X = recoverX(B_Y, 0)
    private val B_POINT = Point(B_X, B_Y)

    private data class Point(val x: BigInteger, val y: BigInteger)

    private fun recoverX(y: BigInteger, sign: Int): BigInteger {
        val y2 = y.multiply(y).mod(P)
        val u = y2.subtract(BigInteger.ONE).mod(P)
        val v = D.multiply(y2).add(BigInteger.ONE).mod(P)
        var x = u.multiply(v.modPow(P.subtract(BigInteger.valueOf(2)), P)).mod(P)
        x = x.modPow(P.add(BigInteger.valueOf(3)).divide(BigInteger.valueOf(8)), P)
        if (x.multiply(x).subtract(u.multiply(v.modInverse(P))).mod(P) != BigInteger.ZERO) {
            x = x.multiply(I).mod(P)
        }
        if (x.testBit(0) != (sign == 1)) {
            x = P.subtract(x)
        }
        return x
    }

    private fun decodePoint(bytes: ByteArray): Point? {
        if (bytes.size != 32) return null
        val clean = bytes.clone()
        val sign = if ((clean[31].toInt() and 0x80) != 0) 1 else 0
        clean[31] = (clean[31].toInt() and 0x7F).toByte()
        val y = decodeLittleEndian(clean)
        if (y >= P) return null
        val x = recoverX(y, sign)
        return Point(x, y)
    }

    private fun decodeLittleEndian(bytes: ByteArray): BigInteger {
        val reversed = ByteArray(bytes.size)
        for (i in bytes.indices) {
            reversed[i] = bytes[bytes.size - 1 - i]
        }
        return BigInteger(1, reversed)
    }

    private fun pointAdd(p1: Point, p2: Point): Point {
        val x1 = p1.x; val y1 = p1.y
        val x2 = p2.x; val y2 = p2.y
        val x1x2 = x1.multiply(x2).mod(P)
        val y1y2 = y1.multiply(y2).mod(P)
        val dx1x2y1y2 = D.multiply(x1x2).multiply(y1y2).mod(P)

        val x3Num = x1.multiply(y2).add(y1.multiply(x2)).mod(P)
        val x3Den = BigInteger.ONE.add(dx1x2y1y2).modInverse(P)
        val x3 = x3Num.multiply(x3Den).mod(P)

        val y3Num = y1.multiply(y2).add(x1.multiply(x2)).mod(P)
        val y3Den = BigInteger.ONE.subtract(dx1x2y1y2).modInverse(P)
        val y3 = y3Num.multiply(y3Den).mod(P)

        return Point(x3, y3)
    }

    private fun pointMul(point: Point, scalar: BigInteger): Point {
        var r = Point(BigInteger.ZERO, BigInteger.ONE) // Neutral element
        var base = point
        for (i in 0 until scalar.bitLength()) {
            if (scalar.testBit(i)) {
                r = pointAdd(r, base)
            }
            base = pointAdd(base, base)
        }
        return r
    }

    private fun verifyRfc8032(message: ByteArray, signature: ByteArray, publicKey: ByteArray): Boolean {
        val aPoint = decodePoint(publicKey) ?: return false
        val rBytes = signature.copyOfRange(0, 32)
        val sBytes = signature.copyOfRange(32, 64)

        val rPoint = decodePoint(rBytes) ?: return false
        val s = decodeLittleEndian(sBytes)
        if (s >= L) return false

        // Compute H(R || A || M)
        val md = MessageDigest.getInstance("SHA-512")
        md.update(rBytes)
        md.update(publicKey)
        md.update(message)
        val h = md.digest()
        val k = decodeLittleEndian(h).mod(L)

        // Verify: [s]B == R + [k]A
        val sB = pointMul(B_POINT, s)
        val kA = pointMul(aPoint, k)
        val rPlusKa = pointAdd(rPoint, kA)

        return sB.x == rPlusKa.x && sB.y == rPlusKa.y
    }
}
