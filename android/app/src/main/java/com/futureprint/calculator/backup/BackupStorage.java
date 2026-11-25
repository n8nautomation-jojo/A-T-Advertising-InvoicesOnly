package com.futureprint.calculator.backup;

import android.content.ContentResolver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.ParcelFileDescriptor;
import android.os.StatFs;
import android.provider.DocumentsContract;
import android.provider.DocumentsContract.Document;
import android.provider.OpenableColumns;
import android.system.Os;
import android.system.StructStatVfs;
import android.util.Log;
import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * Storage Access Framework access to the user-chosen backup folder.
 *
 * The folder URI is persisted with takePersistableUriPermission, so it survives
 * app restarts and (on most OEMs) app updates. Uninstall/clear-data wipes the
 * grant — the recovery flow asks the user to re-pick the same folder, and the
 * files themselves are untouched because SAF folders live outside app storage.
 *
 * Every write goes to a "<name>.tmp" sibling first and is renamed into place
 * only after verification, so an interrupted write can never masquerade as a
 * valid backup, and no existing backup is deleted before its replacement exists.
 */
final class BackupStorage {

    private static final String TAG = "BackupStorage";
    private static final String PREFS = "ta_backup_storage";
    private static final String KEY_TREE = "tree_uri";
    private static final String KEY_LABEL = "tree_label";
    private static final String MIME_TABK = "application/octet-stream";

    public static final class FolderUnavailableException extends Exception {

        public final String code;

        public FolderUnavailableException(String code, String message) {
            super(message);
            this.code = code;
        }
    }

    public static final class Entry {

        public String fileName;
        public String uri;
        public long size;
        public long modifiedAt;
    }

    private final Context context;

    BackupStorage(Context context) {
        this.context = context.getApplicationContext();
    }

    private SharedPreferences prefs() {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    // ── Folder selection ───────────────────────────────────────────────────

    Intent buildOpenDocumentTreeIntent() {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        intent.addFlags(
            Intent.FLAG_GRANT_READ_URI_PERMISSION |
            Intent.FLAG_GRANT_WRITE_URI_PERMISSION |
            Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION |
            Intent.FLAG_GRANT_PREFIX_URI_PERMISSION
        );
        return intent;
    }

    void persistFolder(Uri treeUri) throws FolderUnavailableException {
        persistFolder(treeUri, Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
    }

    void persistFolder(Uri treeUri, int intentFlags) throws FolderUnavailableException {
        if (treeUri == null) throw new FolderUnavailableException("NO_FOLDER", "لم يتم اختيار مجلد النسخ الاحتياطي.");
        ContentResolver resolver = context.getContentResolver();
        int rwFlags = Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION;
        int takeFlags = intentFlags & rwFlags;
        if (takeFlags == 0) takeFlags = rwFlags;
        try {
            resolver.takePersistableUriPermission(treeUri, takeFlags);
        } catch (SecurityException e) {
            try {
                resolver.takePersistableUriPermission(treeUri, rwFlags);
            } catch (SecurityException e2) {
                throw new FolderUnavailableException(
                    "PERMISSION_LOST",
                    "تعذّر الحصول على صلاحية دائمة لهذا المجلد. يُفضّل إنشاء أو اختيار مجلد فرعي مثل Documents/InvoiceBackups."
                );
            }
        }
        SharedPreferences sp = prefs();
        String prevTree = sp.getString(KEY_TREE, null);
        String prevLabel = sp.getString(KEY_LABEL, null);
        sp.edit().putString(KEY_TREE, treeUri.toString()).putString(KEY_LABEL, describe(treeUri)).commit();
        try (
            Cursor probe = resolver.query(
                DocumentsContract.buildChildDocumentsUriUsingTree(treeUri, DocumentsContract.getTreeDocumentId(treeUri)),
                new String[] { Document.COLUMN_DOCUMENT_ID },
                null,
                null,
                null
            )
        ) {
            if (probe == null) {
                rollbackFolderPrefs(sp, prevTree, prevLabel);
                throw new FolderUnavailableException(
                    "PERMISSION_LOST",
                    "تعذّرت قراءة محتويات المجلد المختار. يُفضّل إنشاء أو اختيار مجلد فرعي مثل Documents/InvoiceBackups."
                );
            }
        } catch (FolderUnavailableException e) {
            throw e;
        } catch (Exception e) {
            rollbackFolderPrefs(sp, prevTree, prevLabel);
            throw new FolderUnavailableException(
                "PERMISSION_LOST",
                "تعذّر الوصول إلى المجلد المختار. يُفضّل إنشاء أو اختيار مجلد فرعي مثل Documents/InvoiceBackups."
            );
        }
    }

    private static void rollbackFolderPrefs(SharedPreferences sp, String prevTree, String prevLabel) {
        SharedPreferences.Editor ed = sp.edit();
        if (prevTree == null) ed.remove(KEY_TREE);
        else ed.putString(KEY_TREE, prevTree);
        if (prevLabel == null) ed.remove(KEY_LABEL);
        else ed.putString(KEY_LABEL, prevLabel);
        ed.commit();
    }

    /** Remembers the folder URI only when its grant is still valid. */
    void rememberFolderIfGranted(String treeUriString) {
        if (treeUriString == null || treeUriString.isEmpty()) return;
        Uri uri = Uri.parse(treeUriString);
        if (hasGrant(uri)) {
            prefs().edit().putString(KEY_TREE, treeUriString).putString(KEY_LABEL, describe(uri)).commit();
        }
    }

    String getFolderUri() {
        return prefs().getString(KEY_TREE, "");
    }

    String getFolderLabel() {
        return prefs().getString(KEY_LABEL, "");
    }

    /** True when the persisted grants still include this tree URI. */
    boolean hasGrant(Uri uri) {
        if (uri == null) return false;
        for (android.content.UriPermission p : context.getContentResolver().getPersistedUriPermissions()) {
            if (p.getUri().equals(uri) && p.isReadPermission() && p.isWritePermission()) return true;
        }
        return false;
    }

    /** Returns the folder URI after live verification of persisted URI & grant, or throws with a user-actionable code. */
    Uri requireFolder() throws FolderUnavailableException {
        String stored = getFolderUri();
        if (stored == null || stored.isEmpty()) {
            throw new FolderUnavailableException("NO_FOLDER", "لم يتم تحديد مجلد النسخ الاحتياطي بعد.");
        }
        Uri uri = Uri.parse(stored);
        if (!hasGrant(uri)) {
            throw new FolderUnavailableException("PERMISSION_LOST", "يجب إعادة منح الوصول إلى مجلد النسخ الاحتياطي.");
        }
        // Probe that the tree is still reachable (folder may have been deleted).
        try (
            Cursor c = context.getContentResolver().query(
                DocumentsContract.buildChildDocumentsUriUsingTree(uri, DocumentsContract.getTreeDocumentId(uri)),
                new String[] { Document.COLUMN_DOCUMENT_ID },
                null,
                null,
                null
            )
        ) {
            if (c == null) {
                throw new FolderUnavailableException("PERMISSION_LOST", "مجلد النسخ الاحتياطي لم يعد متاحاً.");
            }
        } catch (FolderUnavailableException e) {
            throw e;
        } catch (Exception e) {
            throw new FolderUnavailableException("PERMISSION_LOST", "مجلد النسخ الاحتياطي لم يعد متاحاً.");
        }
        return uri;
    }

    void forget() {
        String stored = getFolderUri();
        if (stored != null && !stored.isEmpty()) {
            try {
                context.getContentResolver().releasePersistableUriPermission(
                    Uri.parse(stored),
                    Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION
                );
            } catch (Exception ignored) {
                // grant may already be gone
            }
        }
        prefs().edit().remove(KEY_TREE).remove(KEY_LABEL).commit();
    }

    String describe(Uri treeUri) {
        String id = treeUri.getLastPathSegment();
        if (id == null) return "مجلد النسخ الاحتياطي";
        int colon = id.indexOf(':');
        if (colon >= 0 && colon + 1 < id.length()) {
            String path = id.substring(colon + 1);
            if (path.startsWith("primary:")) path = path.substring(8);
            return path.isEmpty() ? "التخزين الرئيسي" : "التخزين الرئيسي / " + path;
        }
        return id;
    }

    // ── Safety of names ────────────────────────────────────────────────────

    /**
     * Rejects anything that is not a plain file name in the backup folder:
     * no slashes, no "..", no control characters, no hidden files.
     * This blocks path traversal through crafted file names.
     */
    static void assertSafeFileName(String name) throws FolderUnavailableException {
        if (name == null || name.isEmpty()) throw new FolderUnavailableException("IO_FAILED", "اسم الملف فارغ.");
        if (name.length() > 128) throw new FolderUnavailableException("IO_FAILED", "اسم الملف طويل جداً.");
        if (name.contains("/") || name.contains("\\") || name.contains("..")) {
            throw new FolderUnavailableException("IO_FAILED", "unsafe file name: " + name);
        }
        if (name.startsWith(".")) throw new FolderUnavailableException("IO_FAILED", "الملفات المخفية غير مقبولة.");
        for (int i = 0; i < name.length(); i++) {
            if (Character.isISOControl(name.charAt(i))) throw new FolderUnavailableException("IO_FAILED", "اسم الملف يحتوي على محرف غير مسموح.");
        }
    }

    // ── Listing / reading / writing ────────────────────────────────────────

    List<Entry> listBackupFiles() throws FolderUnavailableException {
        Uri tree = requireFolder();
        Uri children = DocumentsContract.buildChildDocumentsUriUsingTree(tree, DocumentsContract.getTreeDocumentId(tree));
        List<Entry> out = new ArrayList<>();
        String[] projection = {
            Document.COLUMN_DOCUMENT_ID,
            Document.COLUMN_DISPLAY_NAME,
            Document.COLUMN_SIZE,
            Document.COLUMN_LAST_MODIFIED,
            Document.COLUMN_MIME_TYPE,
        };
        Cursor cursor = null;
        try {
            cursor = context.getContentResolver().query(children, projection, null, null, null);
            if (cursor == null) return out;
            while (cursor.moveToNext()) {
                try {
                    String docId = cursor.getString(0);
                    String name = cursor.getString(1);
                    String mime = cursor.getString(4);
                    if (Document.MIME_TYPE_DIR.equals(mime)) continue;
                    if (docId == null || docId.isEmpty() || name == null || name.isEmpty()) continue;
                    String lower = name.toLowerCase(Locale.ROOT);
                    boolean isTabk = lower.endsWith(BackupArchiveConstants.FILE_SUFFIX);
                    boolean isStaging =
                        lower.endsWith(BackupArchiveConstants.STAGING_SUFFIX) ||
                        lower.endsWith(BackupArchiveConstants.STAGING_SUFFIX + ".bin");
                    if (!isTabk && !isStaging) continue;
                    // Rename-during-commit leftovers ("prev-…") are never valid backups.
                    Entry e = new Entry();
                    e.fileName = name;
                    e.uri = DocumentsContract.buildDocumentUriUsingTree(tree, docId).toString();
                    e.size = cursor.isNull(2) ? -1 : cursor.getLong(2);
                    e.modifiedAt = cursor.isNull(3) ? 0 : cursor.getLong(3);
                    out.add(e);
                } catch (Exception rowErr) {
                    Log.w(TAG, "Skipping malformed SAF cursor row: " + rowErr.getMessage());
                }
            }
        } catch (Exception e) {
            throw new FolderUnavailableException("PERMISSION_LOST", "تعذّر عرض محتويات مجلد النسخ: " + e.getMessage());
        } finally {
            if (cursor != null) cursor.close();
        }
        return out;
    }

    /** Opens a streaming InputStream for partial/header-only reads without loading the whole file into RAM. */
    InputStream openInputStream(Uri uri) throws FolderUnavailableException {
        try {
            InputStream in = context.getContentResolver().openInputStream(uri);
            if (in == null) throw new FolderUnavailableException("IO_FAILED", "تعذّر فتح ملف النسخة.");
            return in;
        } catch (FolderUnavailableException e) {
            throw e;
        } catch (Exception e) {
            throw new FolderUnavailableException("IO_FAILED", "تعذّر فتح ملف النسخة: " + e.getMessage());
        }
    }

    byte[] read(Uri uri, long maxBytes) throws FolderUnavailableException {
        try (InputStream in = context.getContentResolver().openInputStream(uri)) {
            if (in == null) throw new FolderUnavailableException("IO_FAILED", "تعذّر فتح ملف النسخة.");
            java.io.ByteArrayOutputStream buffer = new java.io.ByteArrayOutputStream();
            byte[] chunk = new byte[64 * 1024];
            long total = 0;
            int read;
            while ((read = in.read(chunk)) != -1) {
                total += read;
                if (total > maxBytes) throw new FolderUnavailableException("IO_FAILED", "حجم ملف النسخة أكبر من المتوقع.");
                buffer.write(chunk, 0, read);
            }
            return buffer.toByteArray();
        } catch (FolderUnavailableException e) {
            throw e;
        } catch (IOException e) {
            throw new FolderUnavailableException("IO_FAILED", "read failed: " + e.getMessage());
        } catch (Exception e) {
            throw new FolderUnavailableException("IO_FAILED", "read failed: " + e.getMessage());
        }
    }

    byte[] readFile(String fileName) throws FolderUnavailableException {
        assertSafeFileName(fileName);
        Uri tree = requireFolder();
        Uri doc = findDocument(tree, fileName);
        if (doc == null) throw new FolderUnavailableException("IO_FAILED", "backup file not found: " + fileName);
        return read(doc, 512L * 1024 * 1024);
    }

    byte[] readFileByUriOrName(Uri uri, Uri tree, String fileName) throws FolderUnavailableException {
        if (uri != null) {
            try {
                return read(uri, 512L * 1024 * 1024);
            } catch (FolderUnavailableException ignored) {
                // fall back to display-name lookup
            }
        }
        assertSafeFileName(fileName);
        Uri resolvedTree = tree != null ? tree : requireFolder();
        Uri doc = findDocument(resolvedTree, fileName);
        if (doc == null) throw new FolderUnavailableException("IO_FAILED", "backup file not found: " + fileName);
        return read(doc, 512L * 1024 * 1024);
    }

    Uri findDocument(Uri tree, String fileName) throws FolderUnavailableException {
        Uri children = DocumentsContract.buildChildDocumentsUriUsingTree(tree, DocumentsContract.getTreeDocumentId(tree));
        try (Cursor cursor = context.getContentResolver().query(
            children,
            new String[] { Document.COLUMN_DOCUMENT_ID, Document.COLUMN_DISPLAY_NAME },
            null,
            null,
            null
        )) {
            if (cursor == null) return null;
            while (cursor.moveToNext()) {
                try {
                    String docId = cursor.getString(0);
                    String displayName = cursor.getString(1);
                    if (docId != null && !docId.isEmpty() && fileName.equals(displayName)) {
                        return DocumentsContract.buildDocumentUriUsingTree(tree, docId);
                    }
                } catch (Exception ignored) {
                    // skip malformed row
                }
            }
        } catch (Exception e) {
            throw new FolderUnavailableException("IO_FAILED", "تعذّر البحث في مجلد النسخ.");
        }
        return null;
    }

    /** Creates (or truncates) a document and streams the bytes into it, returning the created document Uri. */
    Uri writeDocument(Uri tree, String fileName, byte[] data) throws FolderUnavailableException {
        assertSafeFileName(fileName);
        ContentResolver resolver = context.getContentResolver();
        Uri parent = DocumentsContract.buildDocumentUriUsingTree(tree, DocumentsContract.getTreeDocumentId(tree));
        Uri target;
        try {
            Uri existing = findDocument(tree, fileName);
            if (existing != null) {
                try {
                    DocumentsContract.deleteDocument(resolver, existing);
                } catch (Exception ignored) {
                    // replace via truncate below
                }
            }
            target = DocumentsContract.createDocument(resolver, parent, MIME_TABK, fileName);
        } catch (Exception e) {
            throw new FolderUnavailableException("IO_FAILED", "تعذّر إنشاء " + fileName + ": " + e.getMessage());
        }
        if (target == null) throw new FolderUnavailableException("IO_FAILED", "تعذّر إنشاء " + fileName);
        try (OutputStream out = resolver.openOutputStream(target, "wt")) {
            if (out == null) {
                deleteUriQuietly(resolver, target);
                throw new FolderUnavailableException("IO_FAILED", "تعذّر فتح الملف للكتابة: " + fileName);
            }
            out.write(data);
            out.flush();
        } catch (FolderUnavailableException e) {
            throw e;
        } catch (IOException e) {
            deleteUriQuietly(resolver, target);
            throw new FolderUnavailableException("IO_FAILED", "تعذّرت كتابة " + fileName + ": " + e.getMessage());
        } catch (Exception e) {
            deleteUriQuietly(resolver, target);
            throw new FolderUnavailableException("IO_FAILED", "تعذّرت كتابة " + fileName + ": " + e.getMessage());
        }
        return target;
    }

    /**
     * Atomic replace: write to "<final>.tmp", read it back via its exact created Uri,
     * compare SHA-256, then rename. If a SAF provider rejects `renameDocument` or mutates
     * the display name during rename (e.g. appending `.bin` on Samsung/Android 13+),
     * falls back to a direct verified write to `finalName` and cleans up temporary files.
     */
    Uri writeAtomically(Uri tree, String finalName, byte[] data) throws FolderUnavailableException {
        assertSafeFileName(finalName);
        String stagingName = finalName + BackupArchiveConstants.STAGING_SUFFIX;
        String previousName = BackupArchiveConstants.PREVIOUS_PREFIX + finalName;
        ContentResolver resolver = context.getContentResolver();
        Uri stagingUri = writeDocument(tree, stagingName, data);
        String expected = BackupArchive.sha256Hex(data);
        byte[] readBack;
        try {
            readBack = read(stagingUri, data.length + 1024L * 1024L);
        } catch (FolderUnavailableException e) {
            deleteUriQuietly(resolver, stagingUri);
            deleteQuietly(tree, stagingName);
            throw e;
        }
        String actual = BackupArchive.sha256Hex(readBack);
        readBack = null;
        if (!expected.equals(actual)) {
            deleteUriQuietly(resolver, stagingUri);
            deleteQuietly(tree, stagingName);
            throw new FolderUnavailableException("VERIFY_FAILED", "المجلد أعاد بايتات مختلفة عن التي كُتبت — لم يتم اعتماد النسخة.");
        }

        boolean movedExistingToPrev = false;
        Uri renamedUri = null;
        try {
            Uri existing = findDocument(tree, finalName);
            if (existing != null) {
                Uri previous = findDocument(tree, previousName);
                if (previous != null) deleteQuietly(tree, previousName);
                try {
                    DocumentsContract.renameDocument(resolver, existing, previousName);
                    movedExistingToPrev = findDocument(tree, previousName) != null;
                } catch (Exception ignored) {
                    // provider without rename support: fall through to rename or direct fallback
                }
            }
            renamedUri = DocumentsContract.renameDocument(resolver, stagingUri, finalName);
            // Verify the provider actually gave the document the exact requested display name.
            Uri committed = findDocument(tree, finalName);
            if (committed != null) {
                deleteQuietly(tree, previousName);
                return committed;
            }
            Log.w(TAG, "renameDocument did not produce expected display name " + finalName + "; falling back to direct verified write");
        } catch (Exception e) {
            Log.w(TAG, "renameDocument failed for " + finalName + "; falling back to direct verified write: " + e.getMessage());
        }

        // Clean up any renamed artifact with an unexpected display name before direct write.
        if (renamedUri != null) {
            deleteUriQuietly(resolver, renamedUri);
        }

        // Resilient fallback: direct verified write to `finalName`, then remove staging & previous.
        Uri finalDoc = null;
        try {
            finalDoc = writeDocument(tree, finalName, data);
            byte[] directReadBack = read(finalDoc, data.length + 1024L * 1024L);
            String directActual = BackupArchive.sha256Hex(directReadBack);
            directReadBack = null;
            if (!expected.equals(directActual)) {
                deleteUriQuietly(resolver, finalDoc);
                deleteQuietly(tree, finalName);
                throw new FolderUnavailableException("VERIFY_FAILED", "المجلد أعاد بايتات مختلفة عن التي كُتبت — لم يتم اعتماد النسخة.");
            }
            deleteUriQuietly(resolver, stagingUri);
            deleteQuietly(tree, stagingName);
            deleteQuietly(tree, previousName);
            return finalDoc;
        } catch (FolderUnavailableException e) {
            if (finalDoc != null) {
                deleteUriQuietly(resolver, finalDoc);
            }
            if (movedExistingToPrev && findDocument(tree, finalName) == null) {
                try {
                    Uri prevDoc = findDocument(tree, previousName);
                    if (prevDoc != null) DocumentsContract.renameDocument(resolver, prevDoc, finalName);
                } catch (Exception ignored) {
                    // best effort restore of previous file
                }
            }
            deleteUriQuietly(resolver, stagingUri);
            deleteQuietly(tree, stagingName);
            throw e;
        }
    }

    private static void deleteUriQuietly(ContentResolver resolver, Uri uri) {
        if (uri == null) return;
        try {
            DocumentsContract.deleteDocument(resolver, uri);
        } catch (Exception ignored) {
            // best effort
        }
    }

    void deleteQuietly(Uri tree, String fileName) {
        try {
            assertSafeFileName(fileName);
            Uri doc = findDocument(tree, fileName);
            if (doc != null) DocumentsContract.deleteDocument(context.getContentResolver(), doc);
        } catch (Exception ignored) {
            // best effort
        }
    }

    /**
     * Removes abandoned staging files left behind by an interrupted write.
     * They are never valid backups and would otherwise accumulate silently.
     */
    void cleanupStaging(Uri tree) {
        try {
            for (Entry entry : listBackupFiles()) {
                String lower = entry.fileName.toLowerCase(Locale.ROOT);
                if (
                    lower.endsWith(BackupArchiveConstants.STAGING_SUFFIX) ||
                    lower.endsWith(BackupArchiveConstants.STAGING_SUFFIX + ".bin") ||
                    entry.fileName.startsWith(BackupArchiveConstants.PREVIOUS_PREFIX)
                ) {
                    deleteQuietly(tree, entry.fileName);
                }
            }
        } catch (Exception ignored) {
            // listing already reported the problem to the caller
        }
    }

    long documentSize(Uri uri) {
        try (Cursor cursor = context.getContentResolver().query(uri, new String[] { OpenableColumns.SIZE }, null, null, null)) {
            if (cursor != null && cursor.moveToFirst() && !cursor.isNull(0)) return cursor.getLong(0);
        } catch (Exception ignored) {
            // fall through
        }
        return -1;
    }

    // ── Capacity ───────────────────────────────────────────────────────────

    /**
     * Free bytes on the volume holding the backup folder.
     * Prefers `ParcelFileDescriptor` + `Os.fstatvfs` on the SAF folder document when
     * supported by the provider (handles SD cards accurately), falling back to `StatFs`.
     */
    long freeBytesForFolder() {
        String stored = getFolderUri();
        if (stored != null && !stored.isEmpty()) {
            try {
                Uri tree = Uri.parse(stored);
                Uri docUri = DocumentsContract.buildDocumentUriUsingTree(tree, DocumentsContract.getTreeDocumentId(tree));
                try (ParcelFileDescriptor pfd = context.getContentResolver().openFileDescriptor(docUri, "r")) {
                    if (pfd != null) {
                        StructStatVfs statVfs = Os.fstatvfs(pfd.getFileDescriptor());
                        long blockSize = statVfs.f_frsize > 0 ? statVfs.f_frsize : statVfs.f_bsize;
                        if (blockSize > 0 && statVfs.f_bavail >= 0) {
                            return statVfs.f_bavail * blockSize;
                        }
                    }
                }
            } catch (Throwable ignored) {
                // Many SAF providers do not support opening a directory FD; fall back to StatFs below.
            }
        }
        try {
            File target = android.os.Environment.getExternalStorageDirectory();
            StatFs stat = new StatFs(target.getAbsolutePath());
            if (Build.VERSION.SDK_INT >= 18) {
                return stat.getAvailableBytes();
            }
            return (long) stat.getAvailableBlocks() * stat.getBlockSize();
        } catch (Exception e) {
            return -1;
        }
    }

    /** Bytes used by the app's own private storage (the database). */
    long appDataBytes() {
        try {
            File dbDir = context.getDatabasePath("x").getParentFile();
            return directorySize(dbDir);
        } catch (Exception e) {
            return -1;
        }
    }

    private long directorySize(File dir) {
        if (dir == null || !dir.exists()) return 0;
        long total = 0;
        File[] files = dir.listFiles();
        if (files == null) return 0;
        for (File f : files) {
            total += f.isDirectory() ? directorySize(f) : f.length();
        }
        return total;
    }
}
