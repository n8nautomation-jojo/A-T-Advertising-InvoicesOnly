package com.futureprint.calculator.backup;

import android.content.Context;
import android.content.SharedPreferences;
import android.util.Base64;
import android.util.Log;
import java.security.GeneralSecurityException;
import java.security.SecureRandom;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Owns the AES-256 backup key and keyring.
 *
 * Security decisions:
 *  - Every key lives ONLY in the app's private SharedPreferences, wrapped with
 *    an AndroidKeyStore AES-256-GCM key (never plaintext, never in the backup
 *    folder).
 *  - A bounded keyring (up to 16 entries) stores historical/imported keys by
 *    their non-secret `keyId`, allowing seamless decryption of backups from
 *    previous installs or devices after importing a Recovery Key.
 */
final class BackupKeyStore {

    private static final String TAG = "BackupKeyStore";
    private static final String PREFS = "ta_backup_keystore";
    private static final String KEY_WRAPPED = "wrapped_key";
    private static final String KEY_PLAIN = "plain_key";
    private static final String KEY_ID = "key_id";
    private static final String KEY_RING = "wrapped_keyring";
    private static final int MAX_KEYRING_SIZE = 16;
    private static final String ANDROID_KEY_ALIAS = "ta_backup_wrap_key_v1";
    private static final String TRANSFORMATION = "AES/GCM/NoPadding";

    private final Context context;
    private final SecureRandom random = new SecureRandom();

    BackupKeyStore(Context context) {
        this.context = context.getApplicationContext();
    }

    private SharedPreferences prefs() {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    /** Returns the active key, creating one on first use. */
    synchronized byte[] getOrCreateKey() {
        byte[] existing = getExistingKey();
        if (existing != null) return existing;
        byte[] fresh = new byte[BackupArchive.KEY_LEN];
        random.nextBytes(fresh);
        storeKey(fresh);
        return fresh;
    }

    /** Returns the active key, or null when this install has no active key yet. */
    synchronized byte[] getExistingKey() {
        SharedPreferences p = prefs();
        String wrapped = p.getString(KEY_WRAPPED, null);
        if (wrapped != null) {
            try {
                byte[] unwrapped = unwrap(Base64.decode(wrapped, Base64.NO_WRAP));
                return unwrapped.length == BackupArchive.KEY_LEN ? unwrapped : null;
            } catch (Exception e) {
                Log.e(TAG, "Stored backup key could not be unwrapped; treating as missing", e);
                return null;
            }
        }
        String plain = p.getString(KEY_PLAIN, null);
        if (plain != null) {
            try {
                byte[] legacy = Base64.decode(plain, Base64.NO_WRAP);
                if (legacy.length != BackupArchive.KEY_LEN) return null;
                // Transparently migrate legacy plaintext key to AndroidKeyStore wrapping and delete KEY_PLAIN.
                try {
                    storeKey(legacy);
                } catch (Exception migrateErr) {
                    Log.w(TAG, "Failed to re-wrap legacy backup key with AndroidKeyStore", migrateErr);
                }
                return legacy;
            } catch (Exception e) {
                return null;
            }
        }
        return null;
    }

    /** Wraps `key` with the Android Keystore key and persists it atomically as the active key (and in keyring). */
    synchronized String storeKey(byte[] key) {
        if (key == null || key.length != BackupArchive.KEY_LEN) throw new IllegalArgumentException("backup key must be 32 bytes");
        String keyId = BackupArchive.deriveKeyId(key);
        byte[] sealed = wrapOrFail(key);
        String wrappedB64 = Base64.encodeToString(sealed, Base64.NO_WRAP);

        JSONArray updatedRing = upsertKeyringArray(loadRawKeyring(), keyId, wrappedB64, keyId);
        SharedPreferences.Editor editor = prefs().edit();
        editor.putString(KEY_WRAPPED, wrappedB64).remove(KEY_PLAIN);
        editor.putString(KEY_ID, keyId);
        editor.putString(KEY_RING, updatedRing.toString());
        if (!editor.commit()) throw new IllegalStateException("تعذّر حفظ مفتاح التشفير.");
        return keyId;
    }

    /** Exports the active key (creating one if absent) as a checksummed Recovery Key string. */
    synchronized String exportRecoveryKey() {
        byte[] key = getOrCreateKey();
        return BackupArchive.formatRecoveryKey(key);
    }

    /**
     * Parses, checksum-verifies, wraps via AndroidKeyStore, and stores a Recovery Key.
     * Sets it as the active key if no active key exists; otherwise stores it in the keyring
     * for decrypting historical/cross-device archives.
     */
    synchronized String importRecoveryKey(String recoveryCode) {
        byte[] key = BackupArchive.parseRecoveryKey(recoveryCode);
        String keyId = BackupArchive.deriveKeyId(key);
        byte[] existingActive = getExistingKey();
        if (existingActive == null) {
            return storeKey(key);
        }
        String activeId = BackupArchive.deriveKeyId(existingActive);
        if (keyId.equals(activeId)) {
            // Already active; ensure it is also present in the keyring.
            byte[] sealed = wrapOrFail(key);
            JSONArray updatedRing = upsertKeyringArray(
                loadRawKeyring(),
                keyId,
                Base64.encodeToString(sealed, Base64.NO_WRAP),
                activeId
            );
            prefs().edit().putString(KEY_RING, updatedRing.toString()).commit();
            return keyId;
        }
        byte[] sealed = wrapOrFail(key);
        String wrappedB64 = Base64.encodeToString(sealed, Base64.NO_WRAP);
        JSONArray updatedRing = upsertKeyringArray(loadRawKeyring(), keyId, wrappedB64, activeId);
        if (!prefs().edit().putString(KEY_RING, updatedRing.toString()).commit()) {
            throw new IllegalStateException("تعذّر حفظ مفتاح الاسترداد في مخزن المفاتيح.");
        }
        return keyId;
    }

    /** Finds a decryption key matching `keyId`: checks active key first, then all keyring entries. */
    synchronized byte[] getKeyForId(String keyId) {
        byte[] active = getExistingKey();
        if (active != null) {
            if (keyId == null || keyId.isEmpty()) return active;
            if (keyId.equals(BackupArchive.deriveKeyId(active))) return active;
        }
        if (keyId == null || keyId.isEmpty()) return null;
        JSONArray ring = loadRawKeyring();
        for (int i = 0; i < ring.length(); i++) {
            JSONObject entry = ring.optJSONObject(i);
            if (entry == null) continue;
            if (!keyId.equals(entry.optString("keyId", ""))) continue;
            String wrappedB64 = entry.optString("wrapped", "");
            if (wrappedB64.isEmpty()) continue;
            try {
                byte[] unwrapped = unwrap(Base64.decode(wrappedB64, Base64.NO_WRAP));
                if (unwrapped.length == BackupArchive.KEY_LEN && keyId.equals(BackupArchive.deriveKeyId(unwrapped))) {
                    return unwrapped;
                }
            } catch (Exception e) {
                Log.w(TAG, "Failed to unwrap keyring entry " + keyId, e);
            }
        }
        return null;
    }

    synchronized boolean hasKey() {
        return getExistingKey() != null || keyCount() > 0;
    }

    synchronized int keyCount() {
        Set<String> ids = new HashSet<>();
        byte[] active = getExistingKey();
        if (active != null) {
            ids.add(BackupArchive.deriveKeyId(active));
        }
        JSONArray ring = loadRawKeyring();
        for (int i = 0; i < ring.length(); i++) {
            JSONObject entry = ring.optJSONObject(i);
            if (entry == null) continue;
            String id = entry.optString("keyId", "");
            String wrapped = entry.optString("wrapped", "");
            if (!id.isEmpty() && !wrapped.isEmpty()) {
                ids.add(id);
            }
        }
        return ids.size();
    }

    synchronized String getKeyId() {
        return prefs().getString(KEY_ID, null);
    }

    synchronized void clear() {
        prefs().edit().clear().commit();
    }

    private byte[] wrapOrFail(byte[] key) {
        try {
            return wrap(key);
        } catch (Exception e) {
            Log.e(TAG, "AndroidKeyStore wrapping failed; refusing plaintext fallback", e);
            throw new SecurityException("AndroidKeyStore wrapping unavailable", e);
        }
    }

    private JSONArray loadRawKeyring() {
        String raw = prefs().getString(KEY_RING, null);
        if (raw == null || raw.isEmpty()) return new JSONArray();
        try {
            return new JSONArray(raw);
        } catch (Exception e) {
            Log.w(TAG, "Corrupt keyring metadata; resetting keyring index", e);
            return new JSONArray();
        }
    }

    private JSONArray upsertKeyringArray(JSONArray existing, String keyId, String wrappedB64, String protectedActiveId) {
        List<JSONObject> entries = new ArrayList<>();
        for (int i = 0; i < existing.length(); i++) {
            JSONObject item = existing.optJSONObject(i);
            if (item == null) continue;
            String id = item.optString("keyId", "");
            if (id.isEmpty() || id.equals(keyId)) continue;
            entries.add(item);
        }
        try {
            JSONObject fresh = new JSONObject();
            fresh.put("keyId", keyId);
            fresh.put("wrapped", wrappedB64);
            entries.add(fresh);
        } catch (Exception ignored) {
            // unreachable for String values
        }
        while (entries.size() > MAX_KEYRING_SIZE) {
            int evictIdx = 0;
            if (protectedActiveId != null && protectedActiveId.equals(entries.get(0).optString("keyId", "")) && entries.size() > 1) {
                evictIdx = 1;
            }
            entries.remove(evictIdx);
        }
        JSONArray out = new JSONArray();
        for (JSONObject item : entries) out.put(item);
        return out;
    }

    private SecretKey getOrCreateWrappingKey() throws GeneralSecurityException {
        java.security.KeyStore ks = java.security.KeyStore.getInstance("AndroidKeyStore");
        try {
            ks.load(null);
            if (ks.containsAlias(ANDROID_KEY_ALIAS)) {
                java.security.Key k = ks.getKey(ANDROID_KEY_ALIAS, null);
                if (k instanceof SecretKey) return (SecretKey) k;
            }
            KeyGenerator generator = KeyGenerator.getInstance("AES", "AndroidKeyStore");
            generator.init(new android.security.keystore.KeyGenParameterSpec.Builder(
                ANDROID_KEY_ALIAS,
                android.security.keystore.KeyProperties.PURPOSE_ENCRYPT | android.security.keystore.KeyProperties.PURPOSE_DECRYPT
            )
                .setBlockModes(android.security.keystore.KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(android.security.keystore.KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build());
            return generator.generateKey();
        } catch (Exception e) {
            throw new GeneralSecurityException("AndroidKeyStore unavailable", e);
        }
    }

    private byte[] wrap(byte[] key) throws Exception {
        SecretKey wrappingKey = getOrCreateWrappingKey();
        Cipher cipher = Cipher.getInstance(TRANSFORMATION);
        // Do NOT pass a caller-generated IV: AndroidKeyStore AES-GCM keys enforce
        // randomizedEncryptionRequired=true and generate their own fresh IV.
        cipher.init(Cipher.ENCRYPT_MODE, wrappingKey);
        byte[] iv = cipher.getIV();
        if (iv == null || iv.length != BackupArchive.GCM_IV_LEN) {
            throw new GeneralSecurityException("Unexpected GCM IV length from AndroidKeyStore");
        }
        byte[] body = cipher.doFinal(key);
        byte[] out = new byte[iv.length + body.length];
        System.arraycopy(iv, 0, out, 0, iv.length);
        System.arraycopy(body, 0, out, iv.length, body.length);
        return out;
    }

    private byte[] unwrap(byte[] wrapped) throws Exception {
        if (wrapped == null || wrapped.length <= BackupArchive.GCM_IV_LEN + BackupArchive.GCM_TAG_LEN) {
            throw new GeneralSecurityException("Wrapped backup key is truncated or malformed");
        }
        SecretKey wrappingKey = getOrCreateWrappingKey();
        Cipher cipher = Cipher.getInstance(TRANSFORMATION);
        cipher.init(
            Cipher.DECRYPT_MODE,
            wrappingKey,
            new GCMParameterSpec(128, wrapped, 0, BackupArchive.GCM_IV_LEN)
        );
        return cipher.doFinal(wrapped, BackupArchive.GCM_IV_LEN, wrapped.length - BackupArchive.GCM_IV_LEN);
    }

    /** True when the platform Keystore can actually initialize a GCM cipher with the wrapping key. */
    boolean isKeystoreAvailable() {
        try {
            SecretKey wrappingKey = getOrCreateWrappingKey();
            Cipher cipher = Cipher.getInstance(TRANSFORMATION);
            cipher.init(Cipher.ENCRYPT_MODE, wrappingKey);
            byte[] iv = cipher.getIV();
            return iv != null && iv.length == BackupArchive.GCM_IV_LEN;
        } catch (Exception e) {
            Log.w(TAG, "AndroidKeyStore cipher verification failed", e);
            return false;
        }
    }
}
