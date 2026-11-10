package com.example.security

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.SystemClock
import android.util.Log
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import java.util.concurrent.TimeUnit

enum class LicenseStatus(val label: String, val badgeColor: String) {
    ACTIVE("Actif", "#10b981"),
    OFFLINE_VALID("Valide Hors-Ligne", "#00b4d8"),
    SYNC_REQUIRED("Synchronisation Requise", "#f59e0b"),
    EXPIRED("Expiré", "#64748b"),
    SUSPENDED("Suspendu", "#d97706"),
    REVOKED("Révoqué", "#ef4444"),
    UNLICENSED("Non Activé", "#94a3b8"),
    TAMPERED("Horloge Altérée", "#dc2626")
}

data class LicenseInfo(
    val status: LicenseStatus,
    val licenseKey: String,
    val technicianName: String,
    val technicianCompany: String,
    val durationType: String,
    val licenseExpiresAt: String?,
    val offlineValidUntil: String?,
    val remainingOfflineDays: Int,
    val lastSyncFormatted: String,
    val installationId: String,
    val isOperationAllowed: Boolean,
    val statusMessage: String
)

sealed class LicenseResult {
    data class Success(val info: LicenseInfo, val message: String) : LicenseResult()
    data class Error(val code: String, val message: String) : LicenseResult()
}

class LicenseManager(private val context: Context) {

    companion object {
        private const val TAG = "LicenseManager"
        private const val PREFS_NAME = "nokia_pm_license_secure_prefs"

        // Keys in SharedPreferences
        private const val KEY_TOKEN_PAYLOAD = "lic_token_payload"
        private const val KEY_TOKEN_SIG = "lic_token_signature"
        private const val KEY_LAST_SYNC_MS = "lic_last_sync_ms"
        private const val KEY_LAST_KNOWN_CLOCK_MS = "lic_last_known_clock_ms"
        private const val KEY_LAST_ELAPSED_REALTIME = "lic_last_elapsed_realtime"
        private const val KEY_SERVER_URL = "lic_server_url"

        // Default endpoint (can be updated dynamically or pointed to custom Supabase function)
        const val DEFAULT_SERVER_URL = "http://10.0.2.2:3001" // Android Emulator localhost bridge or Supabase
        const val JSON_MEDIA_TYPE = "application/json; charset=utf-8"
    }

    private val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    private val httpClient = OkHttpClient.Builder()
        .connectTimeout(12, TimeUnit.SECONDS)
        .readTimeout(15, TimeUnit.SECONDS)
        .build()

    fun getServerUrl(): String {
        return prefs.getString(KEY_SERVER_URL, null) ?: DEFAULT_SERVER_URL
    }

    fun setServerUrl(url: String) {
        val clean = url.trim().replace(Regex("/+$"), "")
        prefs.edit().putString(KEY_SERVER_URL, clean).apply()
    }

    /**
     * Determines whether a specific operation is permitted according to current license state.
     * Operations like "view", "edit_draft", "photo" are ALWAYS allowed so user never loses data.
     * Operations like "export", "create_link" require ACTIVE or OFFLINE_VALID status.
     */
    fun isOperationAllowed(operation: String): Boolean {
        val readOnlyOps = setOf("view", "edit_draft", "photo", "camera", "open", "browse")
        if (readOnlyOps.contains(operation.lowercase())) {
            return true
        }
        val info = getLicenseInfo()
        return info.status == LicenseStatus.ACTIVE || info.status == LicenseStatus.OFFLINE_VALID
    }

    /**
     * Evaluates current license status, verifying signature, 30-day offline validity,
     * and anti-clock rollback protection.
     */
    @Synchronized
    fun getLicenseInfo(): LicenseInfo {
        val installId = DeviceSecurityManager.getInstallationId(context)
        val payloadStr = prefs.getString(KEY_TOKEN_PAYLOAD, null)
        val sigHex = prefs.getString(KEY_TOKEN_SIG, null)
        val lastSyncMs = prefs.getLong(KEY_LAST_SYNC_MS, 0L)

        if (payloadStr.isNullOrEmpty() || sigHex.isNullOrEmpty()) {
            return LicenseInfo(
                status = LicenseStatus.UNLICENSED,
                licenseKey = "",
                technicianName = "Inconnu",
                technicianCompany = "Non assigné",
                durationType = "",
                licenseExpiresAt = null,
                offlineValidUntil = null,
                remainingOfflineDays = 0,
                lastSyncFormatted = "Jamais",
                installationId = installId,
                isOperationAllowed = false,
                statusMessage = "Aucune licence enregistrée sur cet appareil. Une activation en ligne est requise."
            )
        }

        // 1. Verify Asymmetric Ed25519 Signature
        val isSignatureValid = Ed25519Verifier.verify(payloadStr.toByteArray(Charsets.UTF_8), sigHex)
        if (!isSignatureValid) {
            Log.e(TAG, "Cryptographic signature mismatch on license token!")
            return LicenseInfo(
                status = LicenseStatus.REVOKED,
                licenseKey = "",
                technicianName = "Signature altérée",
                technicianCompany = "",
                durationType = "",
                licenseExpiresAt = null,
                offlineValidUntil = null,
                remainingOfflineDays = 0,
                lastSyncFormatted = formatTimestamp(lastSyncMs),
                installationId = installId,
                isOperationAllowed = false,
                statusMessage = "Erreur de sécurité : signature cryptographique de licence invalide."
            )
        }

        // 2. Parse token payload
        val json = try {
            JSONObject(payloadStr)
        } catch (e: Exception) {
            return LicenseInfo(
                status = LicenseStatus.UNLICENSED,
                licenseKey = "",
                technicianName = "",
                technicianCompany = "",
                durationType = "",
                licenseExpiresAt = null,
                offlineValidUntil = null,
                remainingOfflineDays = 0,
                lastSyncFormatted = "",
                installationId = installId,
                isOperationAllowed = false,
                statusMessage = "Jeton de licence corrompu."
            )
        }

        val tokenKey = json.optString("license_key", "")
        val tokenInstallId = json.optString("installation_id", "")
        val techName = json.optString("technician_name", "Opérateur Nokia")
        val techCompany = json.optString("technician_company", "Nokia Partner")
        val statusStr = json.optString("status", "ACTIVE")
        val durationType = json.optString("duration_type", "1_MONTH")
        val licenseExpiresAt = if (json.has("license_expires_at") && !json.isNull("license_expires_at")) json.getString("license_expires_at") else null
        val offlineValidUntil = json.optString("offline_valid_until", "")

        // 3. Strict 1 phone check: installation_id in token MUST match device
        if (tokenInstallId != installId) {
            return LicenseInfo(
                status = LicenseStatus.REVOKED,
                licenseKey = tokenKey,
                technicianName = techName,
                technicianCompany = techCompany,
                durationType = durationType,
                licenseExpiresAt = licenseExpiresAt,
                offlineValidUntil = offlineValidUntil,
                remainingOfflineDays = 0,
                lastSyncFormatted = formatTimestamp(lastSyncMs),
                installationId = installId,
                isOperationAllowed = false,
                statusMessage = "Cette licence est liée à un autre téléphone. Un seul appareil par licence est autorisé."
            )
        }

        // 4. Anti-clock tampering protection
        val now = System.currentTimeMillis()
        val lastKnownClock = prefs.getLong(KEY_LAST_KNOWN_CLOCK_MS, 0L)
        // Allow at most 1 hour clock adjustment backward; more indicates intentional rollback
        if (lastKnownClock > 0 && now < (lastKnownClock - 3600_000L)) {
            Log.w(TAG, "Clock rollback detected! current=$now, lastKnown=$lastKnownClock")
            return LicenseInfo(
                status = LicenseStatus.TAMPERED,
                licenseKey = tokenKey,
                technicianName = techName,
                technicianCompany = techCompany,
                durationType = durationType,
                licenseExpiresAt = licenseExpiresAt,
                offlineValidUntil = offlineValidUntil,
                remainingOfflineDays = 0,
                lastSyncFormatted = formatTimestamp(lastSyncMs),
                installationId = installId,
                isOperationAllowed = false,
                statusMessage = "Horloge du téléphone altérée détectée. Veuillez remettre l'heure automatique et vous reconnecter."
            )
        }
        // Save current monotonic clock checkpoint
        if (now > lastKnownClock) {
            prefs.edit().putLong(KEY_LAST_KNOWN_CLOCK_MS, now).apply()
        }

        // 5. Check Explicit Backend Status
        if (statusStr.equals("REVOKED", ignoreCase = true)) {
            return LicenseInfo(
                status = LicenseStatus.REVOKED,
                licenseKey = tokenKey,
                technicianName = techName,
                technicianCompany = techCompany,
                durationType = durationType,
                licenseExpiresAt = licenseExpiresAt,
                offlineValidUntil = offlineValidUntil,
                remainingOfflineDays = 0,
                lastSyncFormatted = formatTimestamp(lastSyncMs),
                installationId = installId,
                isOperationAllowed = false,
                statusMessage = "Cette licence a été révoquée par l'administrateur."
            )
        }

        if (statusStr.equals("SUSPENDED", ignoreCase = true)) {
            return LicenseInfo(
                status = LicenseStatus.SUSPENDED,
                licenseKey = tokenKey,
                technicianName = techName,
                technicianCompany = techCompany,
                durationType = durationType,
                licenseExpiresAt = licenseExpiresAt,
                offlineValidUntil = offlineValidUntil,
                remainingOfflineDays = 0,
                lastSyncFormatted = formatTimestamp(lastSyncMs),
                installationId = installId,
                isOperationAllowed = false,
                statusMessage = "Cette licence est suspendue. Contactez l'administrateur."
            )
        }

        // 6. Check Overall License Expiration (e.g., 1 month or 1 year has ended)
        if (!licenseExpiresAt.isNullOrEmpty()) {
            val expDate = parseIsoDate(licenseExpiresAt)
            if (expDate != null && now > expDate.time) {
                return LicenseInfo(
                    status = LicenseStatus.EXPIRED,
                    licenseKey = tokenKey,
                    technicianName = techName,
                    technicianCompany = techCompany,
                    durationType = durationType,
                    licenseExpiresAt = licenseExpiresAt,
                    offlineValidUntil = offlineValidUntil,
                    remainingOfflineDays = 0,
                    lastSyncFormatted = formatTimestamp(lastSyncMs),
                    installationId = installId,
                    isOperationAllowed = false,
                    statusMessage = "La période de validité de votre licence a expiré. Veuillez renouveler."
                )
            }
        }

        // 7. Check 30-Day Offline Validity Window
        val offlineDate = parseIsoDate(offlineValidUntil)
        val remainingDays = if (offlineDate != null) {
            val diffMs = offlineDate.time - now
            if (diffMs > 0) (diffMs / (24 * 3600 * 1000L)).toInt() else 0
        } else {
            0
        }

        if (offlineDate != null && now > offlineDate.time) {
            return LicenseInfo(
                status = LicenseStatus.SYNC_REQUIRED,
                licenseKey = tokenKey,
                technicianName = techName,
                technicianCompany = techCompany,
                durationType = durationType,
                licenseExpiresAt = licenseExpiresAt,
                offlineValidUntil = offlineValidUntil,
                remainingOfflineDays = 0,
                lastSyncFormatted = formatTimestamp(lastSyncMs),
                installationId = installId,
                isOperationAllowed = false,
                statusMessage = "Les 30 jours d'utilisation hors-ligne sont écoulés. Connectez-vous à Internet pour synchroniser."
            )
        }

        // License is fully valid!
        val isFreshlySynced = (now - lastSyncMs) < (24 * 3600 * 1000L)
        val effectiveStatus = if (isFreshlySynced) LicenseStatus.ACTIVE else LicenseStatus.OFFLINE_VALID

        return LicenseInfo(
            status = effectiveStatus,
            licenseKey = tokenKey,
            technicianName = techName,
            technicianCompany = techCompany,
            durationType = durationType,
            licenseExpiresAt = licenseExpiresAt,
            offlineValidUntil = offlineValidUntil,
            remainingOfflineDays = remainingDays,
            lastSyncFormatted = formatTimestamp(lastSyncMs),
            installationId = installId,
            isOperationAllowed = true,
            statusMessage = if (effectiveStatus == LicenseStatus.ACTIVE)
                "Licence active et vérifiée."
            else
                "Mode hors-ligne : $remainingDays jour(s) de validité restante avant synchronisation obligatoire."
        )
    }

    /**
     * Performs initial online activation.
     */
    suspend fun activate(licenseKey: String, customServerUrl: String? = null): LicenseResult = withContext(Dispatchers.IO) {
        val serverBase = customServerUrl ?: getServerUrl()
        val installId = DeviceSecurityManager.getInstallationId(context)
        val devicePubKey = DeviceSecurityManager.getDevicePublicKeyHex(context)
        val deviceModel = DeviceSecurityManager.getDeviceModel()

        val endpoint = "$serverBase/api/activate"
        val jsonBody = JSONObject().apply {
            put("license_key", licenseKey.trim().uppercase())
            put("installation_id", installId)
            put("device_public_key", devicePubKey)
            put("device_model", deviceModel)
            put("app_version", "1.0")
        }

        try {
            val request = Request.Builder()
                .url(endpoint)
                .post(jsonBody.toString().toRequestBody(JSON_MEDIA_TYPE.toMediaType()))
                .build()

            val response = httpClient.newCall(request).execute()
            val responseBody = response.body?.string() ?: ""

            if (!response.isSuccessful) {
                val errJson = try { JSONObject(responseBody) } catch (e: Exception) { null }
                val errorMsg = errJson?.optString("error", "Erreur serveur HTTP ${response.code}")
                    ?: "Erreur d'activation (HTTP ${response.code})"
                return@withContext LicenseResult.Error("ACTIVATION_FAILED", errorMsg)
            }

            val respJson = JSONObject(responseBody)
            val tokenObj = respJson.getJSONObject("token")
            val payloadObj = tokenObj.getJSONObject("payload")
            val signature = tokenObj.getString("signature")
            val payloadStr = payloadObj.toString()

            // Verify signature locally
            if (!Ed25519Verifier.verify(payloadStr.toByteArray(Charsets.UTF_8), signature)) {
                return@withContext LicenseResult.Error("SECURITY_ERROR", "La signature du serveur est invalide.")
            }

            // Save token and sync time
            val now = System.currentTimeMillis()
            prefs.edit()
                .putString(KEY_TOKEN_PAYLOAD, payloadStr)
                .putString(KEY_TOKEN_SIG, signature)
                .putLong(KEY_LAST_SYNC_MS, now)
                .putLong(KEY_LAST_KNOWN_CLOCK_MS, now)
                .apply()

            val info = getLicenseInfo()
            LicenseResult.Success(info, "Licence activée avec succès pour ${info.technicianName}.")
        } catch (e: Exception) {
            Log.e(TAG, "Network exception during activate", e)
            LicenseResult.Error("NETWORK_ERROR", "Impossible de joindre le serveur de licence : ${e.localizedMessage ?: "Vérifiez votre connexion Internet."}")
        }
    }

    /**
     * Performs silent or manual online sync to renew the 30-day offline validity window.
     */
    suspend fun sync(customServerUrl: String? = null): LicenseResult = withContext(Dispatchers.IO) {
        val serverBase = customServerUrl ?: getServerUrl()
        val installId = DeviceSecurityManager.getInstallationId(context)
        val payloadStr = prefs.getString(KEY_TOKEN_PAYLOAD, null)

        if (payloadStr.isNullOrEmpty()) {
            return@withContext LicenseResult.Error("NO_LICENSE", "Aucune licence à synchroniser.")
        }

        val json = try { JSONObject(payloadStr) } catch (e: Exception) { null }
        val licenseKey = json?.optString("license_key", "") ?: ""

        val endpoint = "$serverBase/api/sync"
        val jsonBody = JSONObject().apply {
            put("license_key", licenseKey)
            put("installation_id", installId)
        }

        try {
            val request = Request.Builder()
                .url(endpoint)
                .post(jsonBody.toString().toRequestBody(JSON_MEDIA_TYPE.toMediaType()))
                .build()

            val response = httpClient.newCall(request).execute()
            val responseBody = response.body?.string() ?: ""

            if (!response.isSuccessful) {
                val errJson = try { JSONObject(responseBody) } catch (e: Exception) { null }
                val errorMsg = errJson?.optString("error", "Erreur synchronisation (HTTP ${response.code})")
                    ?: "Erreur HTTP ${response.code}"

                // If revoked or suspended, update local token state
                val status = errJson?.optString("status", "")
                if (status == "REVOKED" || status == "SUSPENDED" || status == "EXPIRED") {
                    json?.put("status", status)
                    prefs.edit().putString(KEY_TOKEN_PAYLOAD, json.toString()).apply()
                }

                return@withContext LicenseResult.Error("SYNC_FAILED", errorMsg)
            }

            val respJson = JSONObject(responseBody)
            val tokenObj = respJson.getJSONObject("token")
            val payloadObj = tokenObj.getJSONObject("payload")
            val signature = tokenObj.getString("signature")
            val newPayloadStr = payloadObj.toString()

            // Verify signature
            if (!Ed25519Verifier.verify(newPayloadStr.toByteArray(Charsets.UTF_8), signature)) {
                return@withContext LicenseResult.Error("SECURITY_ERROR", "Signature du jeton synchronisé invalide.")
            }

            val now = System.currentTimeMillis()
            prefs.edit()
                .putString(KEY_TOKEN_PAYLOAD, newPayloadStr)
                .putString(KEY_TOKEN_SIG, signature)
                .putLong(KEY_LAST_SYNC_MS, now)
                .putLong(KEY_LAST_KNOWN_CLOCK_MS, now)
                .apply()

            val info = getLicenseInfo()
            LicenseResult.Success(info, "Licence synchronisée. 30 jours de validité hors-ligne renouvelés.")
        } catch (e: Exception) {
            Log.e(TAG, "Network exception during sync", e)
            LicenseResult.Error("NETWORK_ERROR", "Échec de synchronisation (hors-ligne) : ${e.localizedMessage}")
        }
    }

    /**
     * Checks if device is currently connected to Internet.
     */
    fun isOnline(): Boolean {
        val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager ?: return false
        val network = cm.activeNetwork ?: return false
        val capabilities = cm.getNetworkCapabilities(network) ?: return false
        return capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
    }

    private fun parseIsoDate(iso: String?): Date? {
        if (iso.isNullOrEmpty()) return null
        return try {
            val sdf = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", Locale.US).apply {
                timeZone = TimeZone.getTimeZone("UTC")
            }
            sdf.parse(iso.take(19))
        } catch (e: Exception) {
            null
        }
    }

    private fun formatTimestamp(ms: Long): String {
        if (ms <= 0L) return "Jamais"
        val sdf = SimpleDateFormat("dd/MM/yyyy HH:mm", Locale.FRANCE)
        return sdf.format(Date(ms))
    }
}
