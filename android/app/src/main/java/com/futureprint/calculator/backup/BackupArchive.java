package com.futureprint.calculator.backup;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.Locale;
import java.util.zip.GZIPInputStream;
import java.util.zip.GZIPOutputStream;
import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;

/**
 * The .tabk container: a self-describing, optionally AES-256-GCM sealed envelope.
 *
 * v1 Layout (must stay in sync with src/lib/backup/codec.ts):
 * <pre>
 *   "TABK"        4 bytes   magic
 *   version       1 byte    format version (1)
 *   flags         1 byte    bit0 = payload sealed
 *   keyIdLen      2 bytes   big-endian
 *   reserved      2 bytes   zero
 *   payloadLen    8 bytes   big-endian
 *   keyId         keyIdLen  ASCII (empty when unsealed)
 *   payload       payloadLen
 *   tagSlot       16 bytes  reserved when sealed, absent otherwise
 * </pre>
 *
 * v2 Layout (compressed binary + AAD-bound header & DB blocks, zero Base64):
 * <pre>
 *   "TABK"        4 bytes   magic
 *   version       1 byte    format version (2)
 *   flags         1 byte    bit0 = sealed, bit1 = db payload GZIP-compressed
 *   keyIdLen      2 bytes   big-endian
 *   headerLen     4 bytes   big-endian
 *   dbBlockLen    8 bytes   big-endian
 *   keyId         keyIdLen  ASCII (empty when unsealed)
 *   headerBlock   headerLen (sealed header JSON UTF-8 if sealed, else raw UTF-8)
 *   dbBlock       dbBlockLen (sealed with AAD=headerBlock if sealed, else raw/gzip DB)
 * </pre>
 * Sealed payloads are iv(12) || ciphertext || gcmTag(16).
 */
public final class BackupArchive {

    public static final String MAGIC = "TABK";
    public static final String FOLDER_NAME = "InvoiceBackups";
    public static final int FORMAT_VERSION = 1;
    public static final int FORMAT_VERSION_V2 = 2;
    public static final int PREFIX_LEN = 18;
    public static final int V2_PREFIX_LEN = 20;
    public static final int GCM_TAG_LEN = 16;
    public static final int GCM_IV_LEN = 12;
    public static final int SEALED_FLAG = 0x01;
    public static final int COMPRESSED_FLAG = 0x02;
    public static final int KEY_LEN = 32;
    public static final int MAX_HEADER_BYTES = 2 * 1024 * 1024;
    public static final int DEFAULT_MAX_GUNZIP_BYTES = 512 * 1024 * 1024;

    private static final String RECOVERY_PREFIX = "TAKEY";
    private static final String RECOVERY_CHECKSUM_DOMAIN = "ta-backup-recovery:";
    private static final SecureRandom RANDOM = new SecureRandom();

    private BackupArchive() {}

    public static final class FormatException extends Exception {

        public final String code;

        public FormatException(String code, String message) {
            super(message);
            this.code = code;
        }
    }

    public static final class Parsed {

        public int version;
        public boolean sealed;
        public String keyId;
        public byte[] payload;
        public int totalLength;
    }

    public static final class ParsedV2 {

        public int version;
        public boolean sealed;
        public boolean compressed;
        public String keyId;
        public byte[] headerBlock;
        public byte[] dbBlock;
        public long dbBlockLength;
        public long totalLength;
    }

    /** Thrown when AES-GCM authentication fails (wrong key or tampered bytes). */
    public static final class SealException extends Exception {

        public SealException(String message) {
            super(message);
        }
    }

    public static byte[] seal(byte[] plaintext, byte[] key) throws GeneralSecurityException {
        return sealWithAad(plaintext, key, null);
    }

    public static byte[] sealWithAad(byte[] plaintext, byte[] key, byte[] aad) throws GeneralSecurityException {
        byte[] iv = new byte[GCM_IV_LEN];
        RANDOM.nextBytes(iv);
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, new SecretKeySpec(key, "AES"), new GCMParameterSpec(128, iv));
        if (aad != null && aad.length > 0) {
            cipher.updateAAD(aad);
        }
        byte[] body = cipher.doFinal(plaintext);
        byte[] out = new byte[iv.length + body.length];
        System.arraycopy(iv, 0, out, 0, iv.length);
        System.arraycopy(body, 0, out, iv.length, body.length);
        return out;
    }

    public static byte[] open(byte[] sealed, byte[] key) throws SealException {
        return openWithAad(sealed, key, null);
    }

    public static byte[] openWithAad(byte[] sealed, byte[] key, byte[] aad) throws SealException {
        if (sealed == null || sealed.length < GCM_IV_LEN + GCM_TAG_LEN) {
            throw new SealException("بيانات النسخة المشفّرة أقصر من المتوقع.");
        }
        try {
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            GCMParameterSpec spec = new GCMParameterSpec(128, sealed, 0, GCM_IV_LEN);
            cipher.init(Cipher.DECRYPT_MODE, new SecretKeySpec(key, "AES"), spec);
            if (aad != null && aad.length > 0) {
                cipher.updateAAD(aad);
            }
            return cipher.doFinal(sealed, GCM_IV_LEN, sealed.length - GCM_IV_LEN);
        } catch (GeneralSecurityException e) {
            throw new SealException("فشل فك التشفير: المفتاح غير مطابق أو الملف معدّل.");
        }
    }

    /** Compresses raw bytes using standard GZIP. */
    public static byte[] gzip(byte[] raw) throws IOException {
        if (raw == null) raw = new byte[0];
        ByteArrayOutputStream out = new ByteArrayOutputStream(Math.max(256, raw.length / 3));
        try (GZIPOutputStream gz = new GZIPOutputStream(out)) {
            gz.write(raw);
        }
        return out.toByteArray();
    }

    /** Decompresses GZIP bytes with a decompression bomb limit (`maxBytes`). */
    public static byte[] gunzip(byte[] gz, int maxBytes) throws IOException {
        if (gz == null || gz.length == 0) {
            throw new IOException("البيانات المضغوطة فارغة.");
        }
        int limit = maxBytes > 0 ? maxBytes : DEFAULT_MAX_GUNZIP_BYTES;
        try (GZIPInputStream in = new GZIPInputStream(new ByteArrayInputStream(gz))) {
            ByteArrayOutputStream out = new ByteArrayOutputStream(Math.min(limit, Math.max(1024, gz.length * 2)));
            byte[] buf = new byte[64 * 1024];
            long total = 0;
            int read;
            while ((read = in.read(buf)) != -1) {
                total += read;
                if (total > limit) {
                    throw new IOException("تجاوز حجم البيانات بعد فك الضغط الحد المسموح (" + limit + " بايت).");
                }
                out.write(buf, 0, read);
            }
            return out.toByteArray();
        }
    }

    /** SHA-256 hex, matching the TypeScript implementation. */
    public static String sha256Hex(byte[] data) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] hash = digest.digest(data);
            StringBuilder sb = new StringBuilder(hash.length * 2);
            for (byte b : hash) {
                sb.append(Character.forDigit((b >> 4) & 0xf, 16));
                sb.append(Character.forDigit(b & 0xf, 16));
            }
            return sb.toString();
        } catch (GeneralSecurityException e) {
            throw new IllegalStateException("SHA-256 unavailable", e);
        }
    }

    /** Non-secret identifier derived from the key; lets us tell which key sealed a file. */
    public static String deriveKeyId(byte[] key) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            digest.update("ta-backup-keyid:".getBytes(StandardCharsets.UTF_8));
            byte[] hash = digest.digest(key);
            StringBuilder sb = new StringBuilder(16);
            for (int i = 0; i < 8; i++) {
                sb.append(Character.forDigit((hash[i] >> 4) & 0xf, 16));
                sb.append(Character.forDigit(hash[i] & 0xf, 16));
            }
            return sb.toString();
        } catch (GeneralSecurityException e) {
            throw new IllegalStateException("SHA-256 unavailable", e);
        }
    }

    /**
     * Formats a 32-byte key into a human-friendly recovery key with 2-byte SHA-256 checksum:
     * `TAKEY-XXXX-XXXX-...` (17 groups of 4 uppercase hex chars = 68 hex chars = 34 bytes).
     */
    public static String formatRecoveryKey(byte[] key) {
        if (key == null || key.length != KEY_LEN) {
            throw new IllegalArgumentException("مفتاح التشفير يجب أن يكون بطول 32 بايت.");
        }
        byte[] checksum = recoveryChecksum(key);
        byte[] combined = new byte[KEY_LEN + 2];
        System.arraycopy(key, 0, combined, 0, KEY_LEN);
        combined[KEY_LEN] = checksum[0];
        combined[KEY_LEN + 1] = checksum[1];

        StringBuilder hex = new StringBuilder(combined.length * 2);
        for (byte b : combined) {
            hex.append(Character.toUpperCase(Character.forDigit((b >> 4) & 0xf, 16)));
            hex.append(Character.toUpperCase(Character.forDigit(b & 0xf, 16)));
        }

        StringBuilder formatted = new StringBuilder(RECOVERY_PREFIX.length() + 1 + hex.length() + (hex.length() / 4));
        formatted.append(RECOVERY_PREFIX);
        for (int i = 0; i < hex.length(); i += 4) {
            formatted.append('-');
            formatted.append(hex, i, Math.min(i + 4, hex.length()));
        }
        return formatted.toString();
    }

    /**
     * Parses and checksum-verifies a recovery key string (`TAKEY-XXXX-...`) back into 32 raw bytes.
     */
    public static byte[] parseRecoveryKey(String code) {
        if (code == null || code.trim().isEmpty()) {
            throw new IllegalArgumentException("يرجى إدخال مفتاح الاسترداد.");
        }
        String cleaned = code.replaceAll("[\\s-]+", "").toUpperCase(Locale.ROOT);
        if (cleaned.startsWith(RECOVERY_PREFIX)) {
            cleaned = cleaned.substring(RECOVERY_PREFIX.length());
        }
        if (cleaned.length() != (KEY_LEN + 2) * 2) {
            throw new IllegalArgumentException("طول مفتاح الاسترداد غير صالح — تأكد من نسخ المفتاح بالكامل (17 مجموعة).");
        }
        byte[] combined = new byte[KEY_LEN + 2];
        for (int i = 0; i < combined.length; i++) {
            int hi = Character.digit(cleaned.charAt(i * 2), 16);
            int lo = Character.digit(cleaned.charAt(i * 2 + 1), 16);
            if (hi < 0 || lo < 0) {
                throw new IllegalArgumentException("مفتاح الاسترداد يحتوي على أحرف غير صالحة (المسموح 0-9 و A-F فقط).");
            }
            combined[i] = (byte) ((hi << 4) | lo);
        }
        byte[] key = new byte[KEY_LEN];
        System.arraycopy(combined, 0, key, 0, KEY_LEN);
        byte[] expected = recoveryChecksum(key);
        int diff = (expected[0] ^ combined[KEY_LEN]) | (expected[1] ^ combined[KEY_LEN + 1]);
        if (diff != 0) {
            throw new IllegalArgumentException("رمز التحقق في مفتاح الاسترداد غير صحيح — راجع الأحرف المدخلة وأعد المحاولة.");
        }
        return key;
    }

    private static byte[] recoveryChecksum(byte[] key) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            digest.update(RECOVERY_CHECKSUM_DOMAIN.getBytes(StandardCharsets.UTF_8));
            byte[] hash = digest.digest(key);
            return new byte[] { hash[0], hash[1] };
        } catch (GeneralSecurityException e) {
            throw new IllegalStateException("SHA-256 unavailable", e);
        }
    }

    // ── v1 container (byte-for-byte parity with TS codec) ──────────────────

    public static byte[] encode(byte[] plaintext, byte[] key) throws GeneralSecurityException {
        boolean sealed = key != null;
        byte[] payload = sealed ? seal(plaintext, key) : plaintext;
        String keyId = sealed ? deriveKeyId(key) : "";
        byte[] keyIdBytes = keyId.getBytes(StandardCharsets.UTF_8);

        ByteArrayOutputStream out = new ByteArrayOutputStream(payload.length + PREFIX_LEN + keyIdBytes.length + GCM_TAG_LEN);
        out.write(MAGIC.getBytes(StandardCharsets.UTF_8), 0, 4);
        out.write(FORMAT_VERSION);
        out.write(sealed ? SEALED_FLAG : 0);
        // keyIdLen follows flags; the two reserved bytes come after it.
        out.write((keyIdBytes.length >> 8) & 0xff);
        out.write(keyIdBytes.length & 0xff);
        out.write(0);
        out.write(0);
        for (int shift = 56; shift >= 0; shift -= 8) {
            out.write((int) (((long) payload.length >> shift) & 0xff));
        }
        out.write(keyIdBytes, 0, keyIdBytes.length);
        out.write(payload, 0, payload.length);
        if (sealed) {
            out.write(new byte[GCM_TAG_LEN], 0, GCM_TAG_LEN);
        }
        return out.toByteArray();
    }

    /** Parses and length-validates a v1 container without decrypting. */
    public static Parsed parse(byte[] bytes) throws FormatException {
        if (bytes == null || bytes.length < PREFIX_LEN) {
            throw new FormatException("TRUNCATED", "الملف أصغر من ترويسة النسخة (ملف غير مكتمل).");
        }
        String magic = new String(bytes, 0, 4, StandardCharsets.UTF_8);
        if (!MAGIC.equals(magic)) {
            throw new FormatException("BAD_MAGIC", "الملف ليس نسخة احتياطية من هذا التطبيق.");
        }
        int version = bytes[4] & 0xff;
        if (version != FORMAT_VERSION) {
            throw new FormatException("UNSUPPORTED_VERSION", "إصدار صيغة النسخة (" + version + ") غير مدعوم.");
        }
        boolean sealed = (bytes[5] & SEALED_FLAG) != 0;
        int keyIdLen = ((bytes[6] & 0xff) << 8) | (bytes[7] & 0xff);
        if (keyIdLen > 128) {
            throw new FormatException("BAD_LENGTHS", "ترويسة النسخة تحتوي على طول مفتاح غير صالح.");
        }
        long payloadLen = 0;
        for (int i = 10; i < 18; i++) {
            payloadLen = (payloadLen << 8) | (bytes[i] & 0xff);
        }
        if (payloadLen < 0 || payloadLen > Integer.MAX_VALUE - 1024) {
            throw new FormatException("BAD_LENGTHS", "حجم البيانات داخل النسخة أكبر من قدرة الجهاز.");
        }
        long expected = (long) PREFIX_LEN + keyIdLen + payloadLen + (sealed ? GCM_TAG_LEN : 0);
        if (bytes.length != (int) expected) {
            throw new FormatException(
                "TRUNCATED",
                "حجم الملف (" + bytes.length + " بايت) لا يطابق الترويسة (" + expected + " بايت) — النسخة غير مكتملة."
            );
        }
        Parsed parsed = new Parsed();
        parsed.version = version;
        parsed.sealed = sealed;
        parsed.keyId = new String(bytes, PREFIX_LEN, keyIdLen, StandardCharsets.UTF_8);
        int payloadStart = PREFIX_LEN + keyIdLen;
        parsed.payload = new byte[(int) payloadLen];
        System.arraycopy(bytes, payloadStart, parsed.payload, 0, (int) payloadLen);
        parsed.totalLength = bytes.length;
        return parsed;
    }

    // ── v2 container (binary + optional GZIP + AAD-bound DB block) ─────────

    public static byte[] encodeV2(byte[] headerJsonUtf8, byte[] rawDbBytes, byte[] key, boolean compress)
        throws GeneralSecurityException, IOException {
        boolean sealed = key != null;
        String keyId = sealed ? deriveKeyId(key) : "";
        byte[] keyIdBytes = keyId.getBytes(StandardCharsets.UTF_8);

        byte[] headerBlock = sealed ? seal(headerJsonUtf8, key) : headerJsonUtf8;
        byte[] dbPayload = compress ? gzip(rawDbBytes) : rawDbBytes;
        byte[] dbBlock = sealed ? sealWithAad(dbPayload, key, headerBlock) : dbPayload;
        int flags = (sealed ? SEALED_FLAG : 0) | (compress ? COMPRESSED_FLAG : 0);

        ByteArrayOutputStream out = new ByteArrayOutputStream(V2_PREFIX_LEN + keyIdBytes.length + headerBlock.length + dbBlock.length);
        out.write(MAGIC.getBytes(StandardCharsets.UTF_8), 0, 4);
        out.write(FORMAT_VERSION_V2);
        out.write(flags);
        out.write((keyIdBytes.length >> 8) & 0xff);
        out.write(keyIdBytes.length & 0xff);
        out.write((headerBlock.length >> 24) & 0xff);
        out.write((headerBlock.length >> 16) & 0xff);
        out.write((headerBlock.length >> 8) & 0xff);
        out.write(headerBlock.length & 0xff);
        long dbLen = dbBlock.length;
        for (int shift = 56; shift >= 0; shift -= 8) {
            out.write((int) ((dbLen >> shift) & 0xff));
        }
        out.write(keyIdBytes, 0, keyIdBytes.length);
        out.write(headerBlock, 0, headerBlock.length);
        out.write(dbBlock, 0, dbBlock.length);
        return out.toByteArray();
    }

    /** Parses and length-validates a complete v2 container without decrypting. */
    public static ParsedV2 parseV2(byte[] bytes) throws FormatException {
        if (bytes == null || bytes.length < V2_PREFIX_LEN) {
            throw new FormatException("TRUNCATED", "الملف أصغر من ترويسة النسخة (ملف غير مكتمل).");
        }
        String magic = new String(bytes, 0, 4, StandardCharsets.UTF_8);
        if (!MAGIC.equals(magic)) {
            throw new FormatException("BAD_MAGIC", "الملف ليس نسخة احتياطية من هذا التطبيق.");
        }
        int version = bytes[4] & 0xff;
        if (version != FORMAT_VERSION_V2) {
            throw new FormatException("UNSUPPORTED_VERSION", "إصدار صيغة النسخة (" + version + ") غير مدعوم.");
        }
        int flags = bytes[5] & 0xff;
        boolean sealed = (flags & SEALED_FLAG) != 0;
        boolean compressed = (flags & COMPRESSED_FLAG) != 0;
        int keyIdLen = ((bytes[6] & 0xff) << 8) | (bytes[7] & 0xff);
        if (keyIdLen > 128) {
            throw new FormatException("BAD_LENGTHS", "ترويسة النسخة تحتوي على طول مفتاح غير صالح.");
        }
        long headerLen =
            ((bytes[8] & 0xffL) << 24) |
            ((bytes[9] & 0xffL) << 16) |
            ((bytes[10] & 0xffL) << 8) |
            (bytes[11] & 0xffL);
        if (headerLen <= 0 || headerLen > MAX_HEADER_BYTES) {
            throw new FormatException("BAD_LENGTHS", "حجم ترويسة النسخة غير صالح.");
        }
        long dbBlockLen = 0;
        for (int i = 12; i < 20; i++) {
            dbBlockLen = (dbBlockLen << 8) | (bytes[i] & 0xff);
        }
        if (dbBlockLen < 0 || dbBlockLen > Integer.MAX_VALUE - 1024) {
            throw new FormatException("BAD_LENGTHS", "حجم البيانات داخل النسخة أكبر من قدرة الجهاز.");
        }
        long expected = (long) V2_PREFIX_LEN + keyIdLen + headerLen + dbBlockLen;
        if (bytes.length != expected) {
            throw new FormatException(
                "TRUNCATED",
                "حجم الملف (" + bytes.length + " بايت) لا يطابق الترويسة (" + expected + " بايت) — النسخة غير مكتملة."
            );
        }
        ParsedV2 parsed = new ParsedV2();
        parsed.version = version;
        parsed.sealed = sealed;
        parsed.compressed = compressed;
        parsed.keyId = new String(bytes, V2_PREFIX_LEN, keyIdLen, StandardCharsets.UTF_8);
        int headerStart = V2_PREFIX_LEN + keyIdLen;
        parsed.headerBlock = new byte[(int) headerLen];
        System.arraycopy(bytes, headerStart, parsed.headerBlock, 0, (int) headerLen);
        int dbStart = headerStart + (int) headerLen;
        parsed.dbBlock = new byte[(int) dbBlockLen];
        System.arraycopy(bytes, dbStart, parsed.dbBlock, 0, (int) dbBlockLen);
        parsed.dbBlockLength = dbBlockLen;
        parsed.totalLength = expected;
        return parsed;
    }

    /**
     * Streaming header-only v2 parser: reads ONLY `V2_PREFIX_LEN + keyIdLen + headerLen`
     * bytes from `in`, never loading the database block into RAM.
     */
    public static ParsedV2 parseV2HeaderOnly(InputStream in) throws FormatException, IOException {
        if (in == null) {
            throw new FormatException("TRUNCATED", "تعذّرت قراءة تدفق النسخة الاحتياطية.");
        }
        byte[] prefix = new byte[V2_PREFIX_LEN];
        if (readExact(in, prefix) < V2_PREFIX_LEN) {
            throw new FormatException("TRUNCATED", "الملف أصغر من ترويسة النسخة (ملف غير مكتمل).");
        }
        String magic = new String(prefix, 0, 4, StandardCharsets.UTF_8);
        if (!MAGIC.equals(magic)) {
            throw new FormatException("BAD_MAGIC", "الملف ليس نسخة احتياطية من هذا التطبيق.");
        }
        int version = prefix[4] & 0xff;
        if (version != FORMAT_VERSION_V2) {
            throw new FormatException("UNSUPPORTED_VERSION", "إصدار صيغة النسخة (" + version + ") غير مدعوم.");
        }
        int flags = prefix[5] & 0xff;
        boolean sealed = (flags & SEALED_FLAG) != 0;
        boolean compressed = (flags & COMPRESSED_FLAG) != 0;
        int keyIdLen = ((prefix[6] & 0xff) << 8) | (prefix[7] & 0xff);
        if (keyIdLen > 128) {
            throw new FormatException("BAD_LENGTHS", "ترويسة النسخة تحتوي على طول مفتاح غير صالح.");
        }
        long headerLen =
            ((prefix[8] & 0xffL) << 24) |
            ((prefix[9] & 0xffL) << 16) |
            ((prefix[10] & 0xffL) << 8) |
            (prefix[11] & 0xffL);
        if (headerLen <= 0 || headerLen > MAX_HEADER_BYTES) {
            throw new FormatException("BAD_LENGTHS", "حجم ترويسة النسخة غير صالح.");
        }
        long dbBlockLen = 0;
        for (int i = 12; i < 20; i++) {
            dbBlockLen = (dbBlockLen << 8) | (prefix[i] & 0xff);
        }
        if (dbBlockLen < 0 || dbBlockLen > Integer.MAX_VALUE - 1024) {
            throw new FormatException("BAD_LENGTHS", "حجم البيانات داخل النسخة أكبر من قدرة الجهاز.");
        }

        byte[] keyIdBytes = new byte[keyIdLen];
        if (keyIdLen > 0 && readExact(in, keyIdBytes) < keyIdLen) {
            throw new FormatException("TRUNCATED", "ترويسة معرف المفتاح غير مكتملة.");
        }
        byte[] headerBlock = new byte[(int) headerLen];
        if (readExact(in, headerBlock) < headerLen) {
            throw new FormatException("TRUNCATED", "بيانات ترويسة النسخة غير مكتملة.");
        }

        ParsedV2 parsed = new ParsedV2();
        parsed.version = version;
        parsed.sealed = sealed;
        parsed.compressed = compressed;
        parsed.keyId = new String(keyIdBytes, StandardCharsets.UTF_8);
        parsed.headerBlock = headerBlock;
        parsed.dbBlock = null;
        parsed.dbBlockLength = dbBlockLen;
        parsed.totalLength = (long) V2_PREFIX_LEN + keyIdLen + headerLen + dbBlockLen;
        return parsed;
    }

    private static int readExact(InputStream in, byte[] target) throws IOException {
        int offset = 0;
        while (offset < target.length) {
            int n = in.read(target, offset, target.length - offset);
            if (n < 0) break;
            offset += n;
        }
        return offset;
    }

    /** Detects archive format version from the first 5+ bytes, or -1 if not a TABK archive. */
    public static int detectVersion(byte[] head) {
        if (head == null || head.length < 5) return -1;
        if (!MAGIC.equals(new String(head, 0, 4, StandardCharsets.UTF_8))) return -1;
        return head[4] & 0xff;
    }

    public static boolean looksLikeArchive(byte[] head) {
        return head != null && head.length >= 4 && MAGIC.equals(new String(head, 0, 4, StandardCharsets.UTF_8));
    }
}
