package com.example

import android.Manifest
import android.annotation.SuppressLint
import android.app.AlertDialog
import android.content.ClipData
import android.content.ContentUris
import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.provider.MediaStore
import android.util.Base64
import android.util.Log
import android.view.ViewGroup
import android.webkit.ConsoleMessage
import android.webkit.GeolocationPermissions
import android.webkit.JavascriptInterface
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.annotation.RequiresApi
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import com.example.ui.theme.MyApplicationTheme
import androidx.lifecycle.lifecycleScope
import com.example.security.LicenseInfo
import com.example.security.LicenseManager
import com.example.security.LicenseResult
import com.example.security.LicenseStatus
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

class MainActivity : ComponentActivity() {

    companion object {
        const val TIMESTAMP_CAMERA_FREE_PKG = "com.jeyluta.timestampcamerafree"
        const val TIMESTAMP_CAMERA_PRO_PKG = "com.jeyluta.timestampcamera"
        const val TIMESTAMP_CAMERA_PLAY_URL = "market://details?id=com.jeyluta.timestampcamerafree"
        const val TIMESTAMP_CAMERA_WEB_URL = "https://play.google.com/store/apps/details?id=com.jeyluta.timestampcamerafree"
    }

    lateinit var licenseManager: LicenseManager
    private var webViewRef: WebView? = null
    private var networkCallback: android.net.ConnectivityManager.NetworkCallback? = null

    private var filePathCallback: ValueCallback<Array<Uri>>? = null
    private var pendingGeoCallback: GeolocationPermissions.Callback? = null
    private var pendingGeoOrigin: String? = null
    private var pendingCameraUri: Uri? = null
    private var captureStartTimeMs: Long = 0L

    // ---------- Galerie / sélecteur de fichiers ----------
    private val fileChooserLauncher = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { result ->
        if (result.resultCode == RESULT_OK) {
            val intent = result.data
            val uris = when {
                intent?.clipData != null -> {
                    val count = intent.clipData!!.itemCount
                    Array(count) { i -> intent.clipData!!.getItemAt(i).uri }
                }
                intent?.data != null -> arrayOf(intent.data!!)
                else -> null
            }
            filePathCallback?.onReceiveValue(uris)
        } else {
            filePathCallback?.onReceiveValue(null)
        }
        filePathCallback = null
    }

    // ---------- Intégration exclusive TimeStamp Camera Free ----------
    private val cameraLauncher = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { result ->
        handleCameraCaptureResult(result.resultCode, result.data)
    }

    private val cameraPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { permissions ->
        val cameraGranted = permissions[Manifest.permission.CAMERA] == true
        if (cameraGranted) {
            val targetPkg = getInstalledTimestampCameraPackage()
            if (targetPkg != null) {
                launchTimestampCamera(targetPkg)
            } else {
                showTimestampCameraRequiredDialog()
            }
        } else {
            filePathCallback?.onReceiveValue(null)
            filePathCallback = null
            Toast.makeText(this, "Permission caméra requise pour TimeStamp Camera", Toast.LENGTH_LONG).show()
        }
    }

    private val locationPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { permissions ->
        val granted = permissions[Manifest.permission.ACCESS_FINE_LOCATION] == true ||
                permissions[Manifest.permission.ACCESS_COARSE_LOCATION] == true
        pendingGeoCallback?.invoke(pendingGeoOrigin, granted, false)
        pendingGeoCallback = null
        pendingGeoOrigin = null
    }

    /**
     * Vérifie si TimeStamp Camera Free (ou version Pro compatible) est installée.
     * Ne retourne JAMAIS une autre application caméra (interdiction stricte de l'appareil par défaut, GCam, Open Camera, etc.).
     */
    fun getInstalledTimestampCameraPackage(): String? {
        val candidates = listOf(
            TIMESTAMP_CAMERA_FREE_PKG,
            TIMESTAMP_CAMERA_PRO_PKG,
            "com.jeyluta.timestampcamerapro"
        )
        for (pkg in candidates) {
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                    packageManager.getPackageInfo(pkg, PackageManager.PackageInfoFlags.of(0))
                } else {
                    @Suppress("DEPRECATION")
                    packageManager.getPackageInfo(pkg, 0)
                }
                return pkg
            } catch (_: PackageManager.NameNotFoundException) {}
        }
        return null
    }

    /**
     * Affiche un dialogue bloquant informant que TimeStamp Camera Free est obligatoire
     * et propose son installation directe depuis le Google Play Store.
     */
    fun showTimestampCameraRequiredDialog() {
        runOnUiThread {
            AlertDialog.Builder(this)
                .setTitle("TimeStamp Camera Free requis")
                .setMessage(
                    "L'application TimeStamp Camera Free (http://www.timestampcamera.com/) est obligatoire pour les rapports de maintenance Nokia PM afin d'intégrer l'horodatage et les coordonnées GPS certifiées.\n\n" +
                    "Veuillez installer TimeStamp Camera Free depuis le Google Play Store pour prendre des photos."
                )
                .setPositiveButton("Installer (Google Play)") { _, _ ->
                    filePathCallback?.onReceiveValue(null)
                    filePathCallback = null
                    openTimestampCameraPlayStore()
                }
                .setNegativeButton("Annuler") { _, _ ->
                    filePathCallback?.onReceiveValue(null)
                    filePathCallback = null
                    Toast.makeText(this, "Capture annulée : TimeStamp Camera Free obligatoire", Toast.LENGTH_SHORT).show()
                }
                .setCancelable(false)
                .show()
        }
    }

    fun openTimestampCameraPlayStore() {
        try {
            val playIntent = Intent(Intent.ACTION_VIEW, Uri.parse(TIMESTAMP_CAMERA_PLAY_URL)).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            startActivity(playIntent)
        } catch (_: Exception) {
            val webIntent = Intent(Intent.ACTION_VIEW, Uri.parse(TIMESTAMP_CAMERA_WEB_URL)).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            startActivity(webIntent)
        }
    }

    /**
     * Point d'entrée de la capture photo : vérifie l'application requise et les permissions.
     */
    private fun startCameraFlow() {
        val targetPkg = getInstalledTimestampCameraPackage()
        if (targetPkg == null) {
            showTimestampCameraRequiredDialog()
            return
        }

        val hasCam = ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED
        if (hasCam) {
            launchTimestampCamera(targetPkg)
        } else {
            val neededPerms = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                arrayOf(Manifest.permission.CAMERA, Manifest.permission.READ_MEDIA_IMAGES)
            } else {
                arrayOf(Manifest.permission.CAMERA, Manifest.permission.READ_EXTERNAL_STORAGE)
            }
            cameraPermissionLauncher.launch(neededPerms)
        }
    }

    // Crée l'entrée de la photo dans la Galerie (Pictures/Nokia PM)
    private fun createPhotoUri(): Uri? {
        val timeStamp = SimpleDateFormat("yyyyMMdd_HHmmss", Locale.US).format(Date())
        val name = "NokiaPM_$timeStamp.jpg"

        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            val values = ContentValues().apply {
                put(MediaStore.Images.Media.DISPLAY_NAME, name)
                put(MediaStore.Images.Media.MIME_TYPE, "image/jpeg")
                put(MediaStore.Images.Media.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/Nokia PM")
            }
            contentResolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values)
        } else {
            val picturesDir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_PICTURES)
            val nokiaDir = File(picturesDir, "Nokia PM").apply { mkdirs() }
            val imageFile = File(nokiaDir, name)
            FileProvider.getUriForFile(this, "${packageName}.fileprovider", imageFile)
        }
    }

    /**
     * Lance directement TimeStamp Camera Free SANS sélecteur Android (Intent.createChooser n'est pas utilisé).
     */
    private fun launchTimestampCamera(targetPackage: String) {
        val uri = createPhotoUri()
        if (uri == null) {
            filePathCallback?.onReceiveValue(null)
            filePathCallback = null
            Toast.makeText(this, "Impossible d'initialiser le fichier photo", Toast.LENGTH_LONG).show()
            return
        }

        pendingCameraUri = uri
        captureStartTimeMs = System.currentTimeMillis() - 2000L

        val captureIntent = Intent(MediaStore.ACTION_IMAGE_CAPTURE).apply {
            setPackage(targetPackage)
            putExtra(MediaStore.EXTRA_OUTPUT, uri)
            clipData = ClipData.newRawUri("NokiaPM_Photo", uri)
            addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION or Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }

        // Si une activité spécifique d'IMAGE_CAPTURE existe dans le package, la cibler directement
        val resolved = packageManager.queryIntentActivities(captureIntent, 0)
        val specific = resolved.firstOrNull { it.activityInfo.packageName == targetPackage }
        if (specific != null) {
            captureIntent.setClassName(specific.activityInfo.packageName, specific.activityInfo.name)
        }

        try {
            // Lancement DIRECT sans sélecteur Android
            cameraLauncher.launch(captureIntent)
        } catch (e: Exception) {
            Log.e("MainActivity", "Échec lancement capture TimeStamp Camera, tentative launch intent", e)
            val launchIntent = packageManager.getLaunchIntentForPackage(targetPackage)
            if (launchIntent != null) {
                try {
                    cameraLauncher.launch(launchIntent)
                } catch (ex: Exception) {
                    showTimestampCameraRequiredDialog()
                }
            } else {
                showTimestampCameraRequiredDialog()
            }
        }
    }

    /**
     * Récupération multi-stratégie de la photo capturée par TimeStamp Camera Free :
     * 1. Vérification de pendingCameraUri (EXTRA_OUTPUT)
     * 2. Vérification de data?.data (URI retourné dans l'intent)
     * 3. Requête MediaStore (photo ajoutée depuis captureStartTimeMs)
     * 4. Scan des répertoires de stockage TimestampCamera (DCIM/TimestampCamera, Pictures/TimestampCamera)
     */
    private fun handleCameraCaptureResult(resultCode: Int, data: Intent?) {
        val uri = pendingCameraUri
        val startTime = captureStartTimeMs

        var finalUri: Uri? = null

        // Stratégie 1 : TimeStamp Camera a écrit dans pendingCameraUri (EXTRA_OUTPUT)
        if (uri != null && getUriFileSize(uri) > 1024L) {
            finalUri = uri
            Log.d("MainActivity", "Photo récupérée via EXTRA_OUTPUT : $uri")
        }

        // Stratégie 2 : Intent data retourné
        if (finalUri == null && data?.data != null && getUriFileSize(data.data!!) > 1024L) {
            val returnedUri = data.data!!
            if (uri != null && copyUriContent(returnedUri, uri)) {
                finalUri = uri
            } else {
                finalUri = returnedUri
            }
            Log.d("MainActivity", "Photo récupérée via intent.data : $finalUri")
        }

        // Stratégie 3 : Scan MediaStore pour la photo récemment créée
        if (finalUri == null && startTime > 0L) {
            val recentMediaUri = findRecentlyAddedMediaPhoto(startTime)
            if (recentMediaUri != null && getUriFileSize(recentMediaUri) > 1024L) {
                if (uri != null && copyUriContent(recentMediaUri, uri)) {
                    finalUri = uri
                } else {
                    finalUri = recentMediaUri
                }
                Log.d("MainActivity", "Photo récupérée via MediaStore : $finalUri")
            }
        }

        // Stratégie 4 : Dossiers TimestampCamera sur le stockage
        if (finalUri == null && startTime > 0L) {
            val fsUri = findPhotoFromTimestampDirectories(startTime)
            if (fsUri != null && getUriFileSize(fsUri) > 1024L) {
                if (uri != null && copyUriContent(fsUri, uri)) {
                    finalUri = uri
                } else {
                    finalUri = fsUri
                }
                Log.d("MainActivity", "Photo récupérée via répertoire TimestampCamera : $finalUri")
            }
        }

        if (finalUri != null) {
            Toast.makeText(this, "Photo TimeStamp Camera importée", Toast.LENGTH_SHORT).show()
            filePathCallback?.onReceiveValue(arrayOf(finalUri))
        } else {
            // Nettoyage de l'URI vide le cas échéant
            if (uri != null && getUriFileSize(uri) <= 0L) {
                try { contentResolver.delete(uri, null, null) } catch (_: Exception) {}
            }
            filePathCallback?.onReceiveValue(null)
        }

        filePathCallback = null
        pendingCameraUri = null
        captureStartTimeMs = 0L
    }

    private fun getUriFileSize(uri: Uri): Long {
        return try {
            if (uri.scheme == "file") {
                uri.path?.let { File(it).length() } ?: 0L
            } else {
                contentResolver.openAssetFileDescriptor(uri, "r")?.use { afd ->
                    val len = afd.length
                    if (len != android.content.res.AssetFileDescriptor.UNKNOWN_LENGTH) {
                        len
                    } else {
                        afd.createInputStream().use { it.available().toLong() }
                    }
                } ?: 0L
            }
        } catch (_: Exception) {
            0L
        }
    }

    private fun copyUriContent(srcUri: Uri, dstUri: Uri): Boolean {
        return try {
            val input = if (srcUri.scheme == "file") {
                java.io.FileInputStream(srcUri.path ?: return false)
            } else {
                contentResolver.openInputStream(srcUri) ?: return false
            }
            input.use { inStream ->
                val outStream = contentResolver.openOutputStream(dstUri, "wt") ?: return false
                outStream.use { out ->
                    inStream.copyTo(out)
                    out.flush()
                }
            }
            true
        } catch (e: Exception) {
            Log.e("MainActivity", "Erreur copie image de $srcUri vers $dstUri", e)
            false
        }
    }

    private fun findRecentlyAddedMediaPhoto(sinceTimeMs: Long): Uri? {
        val sinceSec = (sinceTimeMs / 1000L) - 5L
        val projection = arrayOf(
            MediaStore.Images.Media._ID,
            MediaStore.Images.Media.DATE_ADDED,
            MediaStore.Images.Media.DATE_TAKEN,
            MediaStore.Images.Media.SIZE
        )

        try {
            val selection = "${MediaStore.Images.Media.DATE_ADDED} >= ? AND ${MediaStore.Images.Media.SIZE} > 1024"
            val selectionArgs = arrayOf(sinceSec.toString())
            val sortOrder = "${MediaStore.Images.Media.DATE_ADDED} DESC"

            contentResolver.query(
                MediaStore.Images.Media.EXTERNAL_CONTENT_URI,
                projection,
                selection,
                selectionArgs,
                sortOrder
            )?.use { cursor ->
                if (cursor.moveToFirst()) {
                    val id = cursor.getLong(cursor.getColumnIndexOrThrow(MediaStore.Images.Media._ID))
                    return ContentUris.withAppendedId(
                        MediaStore.Images.Media.EXTERNAL_CONTENT_URI,
                        id
                    )
                }
            }
        } catch (e: Exception) {
            Log.e("MainActivity", "Erreur query DATE_ADDED", e)
        }

        try {
            val selectionTaken = "${MediaStore.Images.Media.DATE_TAKEN} >= ? AND ${MediaStore.Images.Media.SIZE} > 1024"
            val selectionTakenArgs = arrayOf((sinceTimeMs - 10000L).toString())
            val sortOrderTaken = "${MediaStore.Images.Media.DATE_TAKEN} DESC"

            contentResolver.query(
                MediaStore.Images.Media.EXTERNAL_CONTENT_URI,
                projection,
                selectionTaken,
                selectionTakenArgs,
                sortOrderTaken
            )?.use { cursor ->
                if (cursor.moveToFirst()) {
                    val id = cursor.getLong(cursor.getColumnIndexOrThrow(MediaStore.Images.Media._ID))
                    return ContentUris.withAppendedId(
                        MediaStore.Images.Media.EXTERNAL_CONTENT_URI,
                        id
                    )
                }
            }
        } catch (e: Exception) {
            Log.e("MainActivity", "Erreur query DATE_TAKEN", e)
        }

        return null
    }

    private fun findPhotoFromTimestampDirectories(sinceTimeMs: Long): Uri? {
        try {
            val dirs = listOf(
                File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DCIM), "TimestampCamera"),
                File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_PICTURES), "TimestampCamera"),
                File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DCIM), "Camera"),
                File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_PICTURES), "Camera")
            )
            for (dir in dirs) {
                if (dir.exists() && dir.isDirectory) {
                    val candidate = dir.listFiles { f ->
                        f.isFile && f.length() > 1024L && f.lastModified() >= (sinceTimeMs - 20000L)
                    }?.maxByOrNull { it.lastModified() }
                    if (candidate != null) {
                        return Uri.fromFile(candidate)
                    }
                }
            }
        } catch (e: Exception) {
            Log.e("MainActivity", "Erreur scanning répertoires caméra", e)
        }
        return null
    }

    // Enregistre le fichier dans Téléchargements/Nokia PM/<subFolder> (Android 10 et plus)
    @RequiresApi(Build.VERSION_CODES.Q)
    private fun saveToDownloads(bytes: ByteArray, fileName: String, mimeType: String, subFolder: String = ""): Uri? {
        val cleanSub = subFolder.trim().replace(Regex("[\\\\/:*?\"<>|]"), "_").trim('/')
        val relPath = if (cleanSub.isNotBlank()) {
            "${Environment.DIRECTORY_DOWNLOADS}/Nokia PM/$cleanSub"
        } else {
            "${Environment.DIRECTORY_DOWNLOADS}/Nokia PM"
        }
        val values = ContentValues().apply {
            put(MediaStore.Downloads.DISPLAY_NAME, fileName)
            put(MediaStore.Downloads.MIME_TYPE, mimeType)
            put(MediaStore.Downloads.RELATIVE_PATH, relPath)
            put(MediaStore.Downloads.IS_PENDING, 1)
        }
        val uri = contentResolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values) ?: return null
        contentResolver.openOutputStream(uri)?.use { it.write(bytes) } ?: return null
        values.clear()
        values.put(MediaStore.Downloads.IS_PENDING, 0)
        contentResolver.update(uri, values, null, null)
        return uri
    }

    private fun saveToFallbackCache(bytes: ByteArray, fileName: String, subFolder: String = ""): Uri? {
        return try {
            val cleanSub = subFolder.trim().replace(Regex("[\\\\/:*?\"<>|]"), "_").trim('/')
            val folder = if (cleanSub.isNotBlank()) {
                File(cacheDir, "reports/$cleanSub").apply { mkdirs() }
            } else {
                File(cacheDir, "reports").apply { mkdirs() }
            }
            val targetFile = File(folder, fileName)
            FileOutputStream(targetFile).use { it.write(bytes) }
            FileProvider.getUriForFile(this, "${packageName}.fileprovider", targetFile)
        } catch (e: Exception) {
            Log.e("MainActivity", "saveToFallbackCache failed", e)
            null
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        licenseManager = LicenseManager(this)
        setupNetworkObserver()
        enableEdgeToEdge()

        setContent {
            MyApplicationTheme {
                Surface(
                    modifier = Modifier
                        .fillMaxSize()
                        .systemBarsPadding()
                ) {
                    AppWebView()
                }
            }
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        unregisterNetworkObserver()
    }

    private fun setupNetworkObserver() {
        try {
            val cm = getSystemService(Context.CONNECTIVITY_SERVICE) as? android.net.ConnectivityManager ?: return
            val request = android.net.NetworkRequest.Builder()
                .addCapability(android.net.NetworkCapabilities.NET_CAPABILITY_INTERNET)
                .build()

            networkCallback = object : android.net.ConnectivityManager.NetworkCallback() {
                override fun onAvailable(network: android.net.Network) {
                    // When network becomes available, trigger silent background sync if license exists
                    lifecycleScope.launch {
                        val currentInfo = licenseManager.getLicenseInfo()
                        if (currentInfo.status != LicenseStatus.UNLICENSED && currentInfo.status != LicenseStatus.REVOKED) {
                            Log.d("MainActivity", "Internet restored: attempting silent license sync...")
                            val syncRes = licenseManager.sync()
                            if (syncRes is LicenseResult.Success) {
                                Log.d("MainActivity", "Silent sync succeeded! 30 days offline renewed.")
                                runOnUiThread {
                                    notifyLicenseStatusToWeb(syncRes.info)
                                }
                            }
                        }
                    }
                }
            }
            cm.registerNetworkCallback(request, networkCallback!!)
        } catch (e: Exception) {
            Log.w("MainActivity", "Could not register network callback", e)
        }
    }

    private fun unregisterNetworkObserver() {
        try {
            networkCallback?.let {
                val cm = getSystemService(Context.CONNECTIVITY_SERVICE) as? android.net.ConnectivityManager
                cm?.unregisterNetworkCallback(it)
            }
            networkCallback = null
        } catch (_: Exception) {}
    }

    fun notifyLicenseStatusToWeb(info: LicenseInfo) {
        val json = formatLicenseInfoJson(info)
        val safeJson = json.replace("\\", "\\\\").replace("'", "\\'")
        val js = "if (window.onLicenseStatusUpdated) { window.onLicenseStatusUpdated(JSON.parse('$safeJson')); }"
        webViewRef?.post {
            webViewRef?.evaluateJavascript(js, null)
        }
    }

    private fun formatLicenseInfoJson(info: LicenseInfo): String {
        return org.json.JSONObject().apply {
            put("status", info.status.name)
            put("statusLabel", info.status.label)
            put("badgeColor", info.status.badgeColor)
            put("licenseKey", info.licenseKey)
            put("technicianName", info.technicianName)
            put("technicianCompany", info.technicianCompany)
            put("durationType", info.durationType)
            put("licenseExpiresAt", info.licenseExpiresAt ?: "")
            put("offlineValidUntil", info.offlineValidUntil ?: "")
            put("remainingOfflineDays", info.remainingOfflineDays)
            put("lastSyncFormatted", info.lastSyncFormatted)
            put("installationId", info.installationId)
            put("isOperationAllowed", info.isOperationAllowed)
            put("statusMessage", info.statusMessage)
        }.toString()
    }

    @SuppressLint("SetJavaScriptEnabled")
    @Composable
    fun AppWebView() {
        val context = this
        val webView = remember {
            WebView(context).apply {
                layoutParams = ViewGroup.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.MATCH_PARENT
                )

                settings.apply {
                    javaScriptEnabled = true
                    domStorageEnabled = true
                    databaseEnabled = true
                    allowFileAccess = true
                    allowContentAccess = true
                    setGeolocationEnabled(true)
                    mediaPlaybackRequiresUserGesture = false
                    cacheMode = WebSettings.LOAD_DEFAULT
                    useWideViewPort = true
                    loadWithOverviewMode = true
                    displayZoomControls = false
                    builtInZoomControls = false
                }

                webChromeClient = object : WebChromeClient() {
                    override fun onGeolocationPermissionsShowPrompt(
                        origin: String?,
                        callback: GeolocationPermissions.Callback?
                    ) {
                        val finePerm = ContextCompat.checkSelfPermission(
                            context,
                            Manifest.permission.ACCESS_FINE_LOCATION
                        )
                        val coarsePerm = ContextCompat.checkSelfPermission(
                            context,
                            Manifest.permission.ACCESS_COARSE_LOCATION
                        )

                        if (finePerm == PackageManager.PERMISSION_GRANTED || coarsePerm == PackageManager.PERMISSION_GRANTED) {
                            callback?.invoke(origin, true, false)
                        } else {
                            pendingGeoCallback = callback
                            pendingGeoOrigin = origin
                            locationPermissionLauncher.launch(
                                arrayOf(
                                    Manifest.permission.ACCESS_FINE_LOCATION,
                                    Manifest.permission.ACCESS_COARSE_LOCATION
                                )
                            )
                        }
                    }

                    override fun onShowFileChooser(
                        mWebView: WebView?,
                        filePathCallback: ValueCallback<Array<Uri>>?,
                        fileChooserParams: FileChooserParams?
                    ): Boolean {
                        this@MainActivity.filePathCallback?.onReceiveValue(null)
                        this@MainActivity.filePathCallback = filePathCallback

                        // Champ avec l'attribut "capture" : ouvrir exclusivement TimeStamp Camera Free
                        if (fileChooserParams?.isCaptureEnabled == true) {
                            startCameraFlow()
                            return true
                        }

                        // Sinon : galerie / sélecteur de fichiers
                        val intent = fileChooserParams?.createIntent() ?: Intent(Intent.ACTION_GET_CONTENT).apply {
                            addCategory(Intent.CATEGORY_OPENABLE)
                            type = "*/*"
                        }

                        try {
                            fileChooserLauncher.launch(intent)
                        } catch (e: Exception) {
                            this@MainActivity.filePathCallback = null
                            return false
                        }
                        return true
                    }

                    override fun onConsoleMessage(consoleMessage: ConsoleMessage?): Boolean {
                        Log.d("NokiaPM_Web", "${consoleMessage?.message()} -- From line ${consoleMessage?.lineNumber()} of ${consoleMessage?.sourceId()}")
                        return true
                    }
                }

                webViewClient = object : WebViewClient() {
                    override fun shouldOverrideUrlLoading(
                        view: WebView?,
                        request: WebResourceRequest?
                    ): Boolean {
                        val url = request?.url?.toString() ?: return false
                        if (url.startsWith("file://") || url.startsWith("data:") || url.startsWith("blob:")) {
                            return false
                        }
                        return try {
                            val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url))
                            context.startActivity(intent)
                            true
                        } catch (e: Exception) {
                            false
                        }
                    }
                }

                webViewRef = this
                addJavascriptInterface(AndroidBridge(context), "AndroidBridge")
                loadUrl("file:///android_asset/www/index.html")
            }
        }

        AndroidView(
            factory = { webView },
            modifier = Modifier.fillMaxSize()
        )
    }

    inner class AndroidBridge(private val context: Context) {

        @JavascriptInterface
        fun isAndroidBridge(): Boolean = true

        @JavascriptInterface
        fun showToast(message: String) {
            runOnUiThread {
                Toast.makeText(context, message, Toast.LENGTH_SHORT).show()
            }
        }

        @JavascriptInterface
        fun vibrate(ms: Long) {
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                    val vibratorManager = context.getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as? VibratorManager
                    vibratorManager?.defaultVibrator?.vibrate(
                        VibrationEffect.createOneShot(ms, VibrationEffect.DEFAULT_AMPLITUDE)
                    )
                } else {
                    @Suppress("DEPRECATION")
                    val vibrator = context.getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator
                    @Suppress("DEPRECATION")
                    vibrator?.vibrate(ms)
                }
            } catch (e: Exception) {
                Log.e("AndroidBridge", "Vibration failed", e)
            }
        }

        @JavascriptInterface
        fun getDeviceGps(): String {
            try {
                val locationManager = context.getSystemService(Context.LOCATION_SERVICE) as? LocationManager
                val finePerm = ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION)
                val coarsePerm = ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_COARSE_LOCATION)

                if (finePerm == PackageManager.PERMISSION_GRANTED || coarsePerm == PackageManager.PERMISSION_GRANTED) {
                    var bestLocation: Location? = null
                    val providers = locationManager?.getProviders(true) ?: emptyList()
                    for (provider in providers) {
                        val l = locationManager?.getLastKnownLocation(provider) ?: continue
                        if (bestLocation == null || l.accuracy < bestLocation.accuracy) {
                            bestLocation = l
                        }
                    }

                    if (bestLocation != null) {
                        val json = JSONObject().apply {
                            put("success", true)
                            put("latitude", bestLocation.latitude)
                            put("longitude", bestLocation.longitude)
                            put("altitude", bestLocation.altitude)
                            put("accuracy", bestLocation.accuracy.toDouble())
                        }
                        return json.toString()
                    }
                }
            } catch (e: Exception) {
                Log.e("AndroidBridge", "Error getting GPS", e)
            }

            return JSONObject().apply {
                put("success", false)
                put("error", "Location unavailable or permission not granted")
            }.toString()
        }

        private fun checkExportLicense(): Boolean {
            if (!licenseManager.isOperationAllowed("export")) {
                val info = licenseManager.getLicenseInfo()
                runOnUiThread {
                    AlertDialog.Builder(context)
                        .setTitle("Licence requise pour l'export")
                        .setMessage(
                            "${info.statusMessage}\n\n" +
                            "Rassurez-vous : toutes vos saisies et photos restent enregistrées intactes sur votre téléphone."
                        )
                        .setPositiveButton("Gérer la licence") { _, _ ->
                            webViewRef?.evaluateJavascript("if (window.openLicenseModal) window.openLicenseModal();", null)
                        }
                        .setNegativeButton("Fermer", null)
                        .show()
                }
                return false
            }
            return true
        }

        @JavascriptInterface
        fun saveAndShareFile(base64Data: String, fileName: String, mimeType: String) {
            if (!checkExportLicense()) return
            try {
                val cleanBase64 = if (base64Data.contains(",")) {
                    base64Data.substringAfter(",")
                } else {
                    base64Data
                }
                val bytes = Base64.decode(cleanBase64, Base64.DEFAULT)
                val safeName = fileName.replace(Regex("[\\\\/:*?\"<>|]"), "_")

                var shareUri: Uri? = null
                var savedMessage = "Rapport prêt : $safeName"

                // 1) Android 10+ : enregistrement dans Téléchargements/Nokia PM
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    try {
                        shareUri = saveToDownloads(bytes, safeName, mimeType)
                        if (shareUri != null) {
                            savedMessage = "Enregistré dans Téléchargements/Nokia PM : $safeName"
                        }
                    } catch (e: Exception) {
                        Log.e("AndroidBridge", "Save to Downloads failed", e)
                    }
                }

                // 2) Sinon : copie temporaire partagée via FileProvider
                if (shareUri == null) {
                    val cacheDir = File(context.cacheDir, "reports").apply { mkdirs() }
                    val targetFile = File(cacheDir, safeName)
                    FileOutputStream(targetFile).use { it.write(bytes) }
                    shareUri = FileProvider.getUriForFile(
                        context,
                        "${context.packageName}.fileprovider",
                        targetFile
                    )
                }

                val shareIntent = Intent(Intent.ACTION_SEND).apply {
                    type = mimeType
                    putExtra(Intent.EXTRA_STREAM, shareUri)
                    putExtra(Intent.EXTRA_SUBJECT, "Rapport PM - $safeName")
                    addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                }

                runOnUiThread {
                    Toast.makeText(context, savedMessage, Toast.LENGTH_LONG).show()
                    startActivity(Intent.createChooser(shareIntent, "Partager le rapport PM"))
                }
            } catch (e: Exception) {
                Log.e("AndroidBridge", "Failed to save/share file", e)
                runOnUiThread {
                    Toast.makeText(context, "Erreur export : ${e.message}", Toast.LENGTH_LONG).show()
                }
            }
        }

        @JavascriptInterface
        fun saveFileToDownloads(base64Data: String, fileName: String, mimeType: String, subFolder: String): String {
            if (!checkExportLicense()) return ""
            return try {
                val cleanBase64 = if (base64Data.contains(",")) {
                    base64Data.substringAfter(",")
                } else {
                    base64Data
                }
                val bytes = Base64.decode(cleanBase64, Base64.DEFAULT)
                val safeName = fileName.replace(Regex("[\\\\/:*?\"<>|]"), "_")

                var savedUri: Uri? = null

                // 1) Android 10+ (Q+) : MediaStore Téléchargements/Nokia PM/<subFolder>
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    try {
                        savedUri = saveToDownloads(bytes, safeName, mimeType, subFolder)
                    } catch (e: Exception) {
                        Log.e("AndroidBridge", "saveToDownloads MediaStore failed", e)
                    }
                }

                // 2) Fallback : FileProvider via cache
                if (savedUri == null) {
                    savedUri = saveToFallbackCache(bytes, safeName, subFolder)
                }

                savedUri?.toString() ?: ""
            } catch (e: Exception) {
                Log.e("AndroidBridge", "saveFileToDownloads failed", e)
                ""
            }
        }

        @JavascriptInterface
        fun shareFiles(urisJson: String, mimeType: String) {
            if (!checkExportLicense()) return
            try {
                val uriList = ArrayList<Uri>()
                val jsonArray = JSONArray(urisJson)
                for (i in 0 until jsonArray.length()) {
                    val uriStr = jsonArray.optString(i)
                    if (!uriStr.isNullOrBlank()) {
                        uriList.add(Uri.parse(uriStr))
                    }
                }

                if (uriList.isEmpty()) {
                    runOnUiThread {
                        Toast.makeText(context, "Aucun fichier à partager", Toast.LENGTH_SHORT).show()
                    }
                    return
                }

                val shareIntent = if (uriList.size == 1) {
                    Intent(Intent.ACTION_SEND).apply {
                        type = mimeType
                        putExtra(Intent.EXTRA_STREAM, uriList[0])
                        putExtra(Intent.EXTRA_SUBJECT, "Rapport PM")
                        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                    }
                } else {
                    Intent(Intent.ACTION_SEND_MULTIPLE).apply {
                        type = mimeType
                        putParcelableArrayListExtra(Intent.EXTRA_STREAM, uriList)
                        putExtra(Intent.EXTRA_SUBJECT, "Rapports PM (${uriList.size} link)")
                        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                        val clipData = ClipData.newUri(context.contentResolver, "Rapports PM", uriList[0])
                        for (i in 1 until uriList.size) {
                            clipData.addItem(ClipData.Item(uriList[i]))
                        }
                        this.clipData = clipData
                    }
                }

                runOnUiThread {
                    val title = if (uriList.size == 1) "Partager le rapport PM" else "Partager les ${uriList.size} rapports PM"
                    startActivity(Intent.createChooser(shareIntent, title))
                }
            } catch (e: Exception) {
                Log.e("AndroidBridge", "shareFiles failed", e)
                runOnUiThread {
                    Toast.makeText(context, "Erreur partage : ${e.message}", Toast.LENGTH_LONG).show()
                }
            }
        }

        // =====================================================================
        // GESTION DU SYSTÈME DE LICENCES NOKIA PM
        // =====================================================================

        @JavascriptInterface
        fun getLicenseInfo(): String {
            val info = licenseManager.getLicenseInfo()
            return formatLicenseInfoJson(info)
        }

        @JavascriptInterface
        fun isOperationAllowed(operation: String): Boolean {
            return licenseManager.isOperationAllowed(operation)
        }

        @JavascriptInterface
        fun getInstallationId(): String {
            return com.example.security.DeviceSecurityManager.getInstallationId(context)
        }

        @JavascriptInterface
        fun getLicenseServerUrl(): String {
            return licenseManager.getServerUrl()
        }

        @JavascriptInterface
        fun setLicenseServerUrl(serverUrl: String) {
            licenseManager.setServerUrl(serverUrl)
        }

        @JavascriptInterface
        fun activateLicense(licenseKey: String, serverUrl: String, callbackJs: String) {
            val customUrl = if (serverUrl.isNotBlank()) serverUrl.trim() else null
            lifecycleScope.launch {
                val result = licenseManager.activate(licenseKey, customUrl)
                val responseJson = when (result) {
                    is LicenseResult.Success -> {
                        JSONObject().apply {
                            put("success", true)
                            put("message", result.message)
                            put("info", JSONObject(formatLicenseInfoJson(result.info)))
                        }
                    }
                    is LicenseResult.Error -> {
                        JSONObject().apply {
                            put("success", false)
                            put("code", result.code)
                            put("error", result.message)
                        }
                    }
                }

                runOnUiThread {
                    val safeJson = responseJson.toString().replace("\\", "\\\\").replace("'", "\\'")
                    val script = if (callbackJs.isNotBlank()) {
                        "$callbackJs(JSON.parse('$safeJson'))"
                    } else {
                        "if (window.onLicenseActivated) window.onLicenseActivated(JSON.parse('$safeJson'))"
                    }
                    webViewRef?.evaluateJavascript(script, null)
                }
            }
        }

        @JavascriptInterface
        fun syncLicense(serverUrl: String, callbackJs: String) {
            val customUrl = if (serverUrl.isNotBlank()) serverUrl.trim() else null
            lifecycleScope.launch {
                val result = licenseManager.sync(customUrl)
                val responseJson = when (result) {
                    is LicenseResult.Success -> {
                        JSONObject().apply {
                            put("success", true)
                            put("message", result.message)
                            put("info", JSONObject(formatLicenseInfoJson(result.info)))
                        }
                    }
                    is LicenseResult.Error -> {
                        JSONObject().apply {
                            put("success", false)
                            put("code", result.code)
                            put("error", result.message)
                        }
                    }
                }

                runOnUiThread {
                    val safeJson = responseJson.toString().replace("\\", "\\\\").replace("'", "\\'")
                    val script = if (callbackJs.isNotBlank()) {
                        "$callbackJs(JSON.parse('$safeJson'))"
                    } else {
                        "if (window.onLicenseSynced) window.onLicenseSynced(JSON.parse('$safeJson'))"
                    }
                    webViewRef?.evaluateJavascript(script, null)
                }
            }
        }
    }
}