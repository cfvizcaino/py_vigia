package expo.modules.vigiacameraserver

import android.content.Context
import android.util.Base64
import java.security.KeyStore
import java.security.PrivateKey
import java.security.spec.MGF1ParameterSpec
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.OAEPParameterSpec
import javax.crypto.spec.PSource
import javax.crypto.SecretKey

/**
 * Reads what the Flutter app (1.4.0 and earlier) left on the phone, so an
 * update keeps the backend URL, the session and the edge credentials.
 *
 * - shared_preferences: `FlutterSharedPreferences`, keys prefixed `flutter.`.
 * - flutter_secure_storage 11 with its default options: values in
 *   `FlutterSecureStorage`, AES-GCM (12-byte IV first); the AES key sits in
 *   `FlutterSecureKeyStorage`, wrapped with an RSA-OAEP key of the Android
 *   KeyStore. The KeyStore entry survives the update because the package and
 *   the signing key are the same.
 */
internal object FlutterDataMigration {
  private const val preferencesFile = "FlutterSharedPreferences"
  private const val secureDataFile = "FlutterSecureStorage"
  private const val secureKeyFile = "FlutterSecureKeyStorage"
  private const val secureKeyPrefix = "VGhpcyBpcyB0aGUgcHJlZml4IGZvciBhIHNlY3VyZSBzdG9yYWdlCg"
  private const val wrappedAesKey = "AESVGhpcyBpcyB0aGUga2V5IGZvciBhIHNlY3VyZSBzdG9yYWdlIEFFUyBLZXkK"

  private val plainKeys = listOf("vigia_api_base_url", "vigia_edge_camera", "vigia_edge_server")
  private val secureKeys = listOf("vigia_session_token", "vigia_edge_token")

  /** Values found, by their Flutter key; a value that cannot be read is left out. */
  fun read(context: Context): Map<String, String> {
    val result = mutableMapOf<String, String>()
    val preferences = context.getSharedPreferences(preferencesFile, Context.MODE_PRIVATE)
    for (key in plainKeys) {
      preferences.getString("flutter.$key", null)?.takeIf { it.isNotBlank() }?.let { result[key] = it }
    }
    val secureData = context.getSharedPreferences(secureDataFile, Context.MODE_PRIVATE)
    if (secureKeys.none { secureData.contains("${secureKeyPrefix}_$it") }) return result
    val aesKey = try { unwrapAesKey(context) } catch (_: Exception) { null } ?: return result
    for (key in secureKeys) {
      val stored = secureData.getString("${secureKeyPrefix}_$key", null) ?: continue
      try {
        result[key] = decrypt(aesKey, Base64.decode(stored, Base64.DEFAULT))
      } catch (_: Exception) {
        // Unreadable (other cipher or a reset KeyStore): the user signs in again.
      }
    }
    return result
  }

  /** Removes the Flutter copies once the new storage holds them. */
  fun clear(context: Context) {
    for (name in listOf(preferencesFile, secureDataFile, secureKeyFile)) {
      context.getSharedPreferences(name, Context.MODE_PRIVATE).edit().clear().commit()
    }
    try {
      val keyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
      keyStore.deleteEntry("${context.packageName}.FlutterSecureStoragePluginKeyOAEP")
    } catch (_: Exception) {
      // Nothing to delete.
    }
  }

  private fun unwrapAesKey(context: Context): SecretKey? {
    val wrapped = context.getSharedPreferences(secureKeyFile, Context.MODE_PRIVATE)
      .getString(wrappedAesKey, null) ?: return null
    val keyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    val privateKey = keyStore.getKey("${context.packageName}.FlutterSecureStoragePluginKeyOAEP", null) as? PrivateKey
      ?: return null
    val cipher = Cipher.getInstance("RSA/ECB/OAEPPadding", "AndroidKeyStoreBCWorkaround")
    cipher.init(
      Cipher.UNWRAP_MODE,
      privateKey,
      OAEPParameterSpec("SHA-256", "MGF1", MGF1ParameterSpec.SHA1, PSource.PSpecified.DEFAULT),
    )
    return cipher.unwrap(Base64.decode(wrapped, Base64.DEFAULT), "AES", Cipher.SECRET_KEY) as SecretKey
  }

  private fun decrypt(key: SecretKey, data: ByteArray): String {
    require(data.size > 12) { "Valor cifrado incompleto." }
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(128, data, 0, 12))
    return String(cipher.doFinal(data, 12, data.size - 12), Charsets.UTF_8)
  }
}
