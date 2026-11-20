package com.futureprint.calculator.backup;

/** Shared file-naming constants (mirrors src/lib/backup/types.ts). */
final class BackupArchiveConstants {

    static final String FILE_PREFIX = "ta-backup-";
    static final String FILE_SUFFIX = ".tabk";
    static final String STAGING_SUFFIX = ".tmp";
    static final String PREVIOUS_PREFIX = "prev-";
    static final String DB_NAME = "ta_invoicing_db";
    static final String DB_FILE_NAME = DB_NAME + "SQLite.db";
    static final String FORMAT_ID = "TA-BACKUP";
    static final int MANIFEST_VERSION = 1;
    static final int ARCHIVE_FORMAT_VERSION_V2 = 2;

    private BackupArchiveConstants() {}

    /** MediaStore folder used for user-visible backup copies (export). */
    static final String EXPORT_RELATIVE_DIR = "Documents/" + BackupArchive.FOLDER_NAME;
}
