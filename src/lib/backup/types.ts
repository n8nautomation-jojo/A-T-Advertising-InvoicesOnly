/**
 * ═══════════════════════════════════════════════════════════════
 * Backup Domain Types — T.A Advertising Invoice System
 * ═══════════════════════════════════════════════════════════════
 * Pure type/constant module. No Capacitor, DOM, or Node imports so it can be
 * shared by the TypeScript layer, the Node test-suite and (by contract) the
 * native Android engine.
 *
 * On-disk format (produced and verified identically by
 * android/.../backup/BackupArchive.java and src/lib/backup/codec.ts):
 *
 *   "TABK"                         4 bytes  magic
 *   version                        1 byte   archive format version (1)
 *   flags                          1 byte   bit0 = payload is AES-256-GCM sealed
 *   keyIdLen                       2 bytes  big-endian
 *   reserved                       2 bytes  zero
 *   payloadLen                     8 bytes  big-endian
 *   keyId                          keyIdLen ASCII bytes ("" when not sealed)
 *   payload                        payloadLen bytes (sealed bytes when encrypted)
 *   sealSlot                       16 bytes reserved after a sealed payload
 *
 * Note: the field order and the 18-byte prefix length are asserted byte-for-byte
 * against the Java encoder in codec.test.ts — do not reorder without updating both.
 */

/** Archive magic bytes. */
export const BACKUP_ARCHIVE_MAGIC = "TABK";
/** Archive format version produced by v1 builds. */
export const BACKUP_ARCHIVE_FORMAT_VERSION = 1;
/** Archive format version produced by v2 builds (binary header + optional GZIP + AAD). */
export const BACKUP_ARCHIVE_FORMAT_VERSION_V2 = 2;
/** Fixed v1 prefix length before keyId: 4 magic + 1 version + 1 flags + 2 keyIdLen + 2 reserved + 8 payloadLen. */
export const BACKUP_ARCHIVE_PREFIX_LEN = 18;
/** Fixed v2 prefix length before keyId: 4 magic + 1 version + 1 flags + 2 keyIdLen + 4 headerLen + 8 dbBlockLen. */
export const BACKUP_ARCHIVE_V2_PREFIX_LEN = 20;
export const BACKUP_GCM_TAG_LEN = 16;
export const BACKUP_KEY_ID_LEN = 8;
export const BACKUP_SEALED_FLAG = 0x01;
export const BACKUP_COMPRESSED_FLAG = 0x02;

/** Manifest schema version (independent from the database schema version). */
export const BACKUP_MANIFEST_VERSION = 1;
export const BACKUP_FORMAT_ID = "TA-BACKUP";

/** File naming contract — restore discovery relies on it. */
export const BACKUP_FILE_PREFIX = "ta-backup-";
export const BACKUP_FILE_SUFFIX = ".tabk";
export const BACKUP_STAGING_SUFFIX = ".tmp";
export const BACKUP_KEY_FILE_NAME = "ta-backup-key.txt";
export const BACKUP_FOLDER_NAME = "InvoiceBackups";

/** Legacy (pre-engine) single-file JSON export produced by older builds. */
export const LEGACY_EXPORT_APP_ID = "com.taadvertising.invoicing";
export const LEGACY_APP_VERSION = "1.3.1-INVOICE";

export type BackupKind = "manual" | "transaction" | "daily" | "weekly" | "monthly" | "pre-update" | "pre-restore";

export const BACKUP_KINDS: BackupKind[] = [
  "manual",
  "transaction",
  "daily",
  "weekly",
  "monthly",
  "pre-update",
  "pre-restore",
];

export const BACKUP_KIND_LABELS: Record<BackupKind, string> = {
  manual: "يدوية",
  transaction: "تلقائية بعد العمليات",
  daily: "يومية",
  weekly: "أسبوعية",
  monthly: "شهرية",
  "pre-update": "قبل التحديث",
  "pre-restore": "قبل الاستعادة",
};

/** Tables the engine snapshots, in restore order (parents before children). */
export const BACKUP_TABLES = [
  "custom_invoices",
  "custom_invoice_items",
  "proforma_invoices",
  "proforma_lines",
  "print_invoices",
  "print_invoice_lines",
  "customers",
  "orders",
  "order_items",
  "projects",
  "suppliers",
  "financial_accounts",
  "customer_payments",
  "customer_payment_allocations",
  "supplier_payments",
  "supplier_payment_allocations",
  "expenses",
  "expense_payments",
  "financial_transactions",
  "official_letters",
  "document_sequences",
  "audit_log",
  "sequences",
  "settings",
  "db_meta",
] as const;

export type BackupTableName = (typeof BACKUP_TABLES)[number];

/** Rows per table, used for manifest statistics and restore verification. */
export type TableCounts = Partial<Record<BackupTableName, number>> & { total?: number };

export interface BackupManifest {
  format: typeof BACKUP_FORMAT_ID;
  /** Manifest schema version — bump when the structure changes. */
  manifestVersion: number;
  backupId: string;
  kind: BackupKind;
  createdAt: string;
  /** App release that created the backup (informational / cross-device diagnostics). */
  appVersion: string;
  /** SQLite physical schema version stored in `PRAGMA user_version`. */
  databaseSchemaVersion: number;
  /** Latest logical schema version this build can read (used for compatibility checks). */
  databaseSchemaCurrent: number;
  databaseFilename: string;
  /** SHA-256 of the plaintext SQLite snapshot. */
  sha256: string;
  /** Bytes of the plaintext SQLite snapshot. */
  sizeBytes: number;
  /** SHA-256 of the final payload exactly as stored (plaintext, or sealed bytes when encrypted). */
  payloadSha256: string;
  encrypted: boolean;
  /** Non-secret identifier of the key that sealed the payload. */
  keyId: string;
  /** Plaintext header of the SQLite file, lets us detect non-database payloads early. */
  databaseMagic: string;
  counts: TableCounts;
  /** Integrity of the SQLite snapshot itself (PRAGMA quick_check). */
  quickCheck: "ok";
  integrity: "ok";
  /** Total invoice-related records (custom + proforma + print). */
  invoiceCount: number;
  /** Total business records across all core modules (invoices, customers, orders, finance, letters). */
  totalBusinessRecords?: number;
  installationId: string;
  appId: string;
  device: string;
  notes?: string;
}

/**
 * The JSON document embedded inside the payload.
 * Header fields are inside the authenticated payload so AES-GCM also
 * authenticates them — tampering with `databaseSchemaVersion` breaks the seal.
 */
export interface BackupPayloadEnvelope {
  header: BackupManifest;
  databaseBase64: string;
}

export type BackupFileStatus = "verified" | "unreadable" | "corrupt" | "incompatible" | "encrypted";

export interface BackupFileInfo {
  manifest: BackupManifest | null;
  fileName: string;
  uri: string;
  sizeBytes: number;
  modifiedAt: number;
  sha256Ok: boolean;
  quickCheckOk: boolean;
  status: BackupFileStatus;
  /** Human readable reason when status !== "verified". */
  issue?: string;
}

export interface RetentionPolicy {
  daily: number;
  weekly: number;
  monthly: number;
  keepMinimum: number;
  /** 0 or undefined = no hard day cutoff; > 0 = rolling smart retention window in days (e.g. 30 = last month). */
  maxAgeDays?: number;
}

export const DEFAULT_RETENTION: RetentionPolicy = {
  daily: 30,
  weekly: 4,
  monthly: 1,
  keepMinimum: 2,
  maxAgeDays: 30,
};

/** Auto-backup cadence settings persisted in the settings table. */
export interface BackupSettings {
  /** Folder URI persisted by the native engine (kept here for diagnostics/UI). */
  folderUri: string;
  folderLabel: string;
  encryptionEnabled: boolean;
  /** Base64 raw 256-bit key. Never transmitted; stored in the device keystore. */
  encryptionKey: string;
  autoDaily: boolean;
  afterTransaction: boolean;
  retention: RetentionPolicy;
  /** Minimum minutes between two transaction-triggered backups (throttle). */
  transactionThrottleMinutes: number;
  /** Warn when the newest verified backup is older than this. */
  staleAfterHours: number;
  lastBackupAt: string | null;
  lastBackupStatus: "ok" | "failed" | "never";
  lastBackupMessage: string | null;
  /** Newest database content changed at this timestamp; used to skip no-op backups. */
  lastDataChangeAt: string | null;
  onboardingCompletedAt: string | null;
  dismissedRecoveryBackupId: string | null;
  /** Key of the last app version for which a pre-update backup was attempted. */
  lastPreUpdateVersion: string | null;
  /** Timestamp when the user last exported or confirmed saving their recovery key. */
  recoveryKeyExportedAt?: string | null;
}

export const DEFAULT_BACKUP_SETTINGS: BackupSettings = {
  folderUri: "",
  folderLabel: "",
  encryptionEnabled: false,
  encryptionKey: "",
  autoDaily: true,
  afterTransaction: true,
  retention: { ...DEFAULT_RETENTION },
  transactionThrottleMinutes: 2,
  staleAfterHours: 48,
  lastBackupAt: null,
  lastBackupStatus: "never",
  lastBackupMessage: null,
  lastDataChangeAt: null,
  onboardingCompletedAt: null,
  dismissedRecoveryBackupId: null,
  lastPreUpdateVersion: null,
  recoveryKeyExportedAt: null,
};

export type StorageState =
  | "ok"
  | "folder-not-selected"
  | "permission-lost"
  | "unsupported"
  | "unavailable"
  | "browser";

export type ProtectionStatus = "protected" | "outdated" | "stale" | "unproven" | "unprotected" | "browser";

export interface StorageInfo {
  state: StorageState;
  folderUri: string;
  folderLabel: string;
  totalBytes: number;
  freeBytes: number;
  appDataBytes: number;
  backupBytes: number;
  backupCount: number;
  message?: string;
}

export interface DatabaseStatus {
  exists: boolean;
  schemaVersion: number;
  quickCheckOk: boolean;
  integrityDetail: string;
  counts: TableCounts;
  invoiceCount: number;
  totalBusinessRecords?: number;
  fileBytes: number;
  walBytes: number;
  journalMode: string;
}

export interface EngineStatus {
  storage: StorageInfo;
  database: DatabaseStatus;
  settings: BackupSettings;
  backups: BackupFileInfo[];
  newestVerified: BackupFileInfo | null;
  oldestVerifiedAt: string | null;
  protection: ProtectionStatus;
  /** Reason the protection is not "protected". */
  protectionReason: string | null;
  encryptionAvailable: boolean;
  engineVersion: string;
  lastNativeBackupAt?: string | null;
  lastNativeBackupStatus?: "ok" | "failed" | "never";
  lastNativeBackupMessage?: string | null;
  hasEncryptionKey?: boolean;
  encryptionKeyId?: string;
}

export interface BackupRunResult {
  ok: boolean;
  backupId?: string;
  fileName?: string;
  sizeBytes?: number;
  manifest?: BackupManifest;
  verified?: boolean;
  skipped?: boolean;
  skipReason?: string;
  errorCode?: BackupErrorCode;
  message?: string;
  durationMs?: number;
  pruned?: string[];
}

export type BackupErrorCode =
  | "NO_FOLDER"
  | "PERMISSION_LOST"
  | "INSUFFICIENT_STORAGE"
  | "ENCRYPTION_UNAVAILABLE"
  | "DATABASE_UNREADABLE"
  | "INTEGRITY_FAILED"
  | "CORRUPT_ARCHIVE"
  | "INCOMPATIBLE_BACKUP"
  | "RESTORE_FAILED"
  | "VERIFY_FAILED"
  | "ALREADY_RUNNING"
  | "UNSUPPORTED"
  | "IO_FAILED";

export type RestoreMode = "replace" | "merge";

export interface RestoreRequest {
  fileName: string;
  mode: RestoreMode;
  encryptionPassphrase?: string;
}

export interface RestoreResult {
  ok: boolean;
  mode: RestoreMode;
  backupId?: string;
  fileName?: string;
  /** Pre-restore safety copy created automatically before any write. */
  safetyBackupId?: string;
  /** Explanation if pre-restore safety backup was skipped (e.g. empty database). */
  safetyBackupSkippedReason?: string;
  counts: TableCounts;
  verifying?: {
    countsMatch: boolean;
    relationsOk: boolean;
    quickCheckOk: boolean;
    invoiceNumbersIntact: boolean;
  };
  migratedFromSchema?: number;
  message?: string;
  errorCode?: BackupErrorCode;
}

export interface BackupPreview {
  info: BackupFileInfo;
  /** Plaintext database stats (counts derived from the backup snapshot). */
  databaseCreatedAt?: string;
  currentInvoiceCount: number;
  currentSchemaVersion: number;
  /** True when the snapshot restores without a schema upgrade step. */
  compatible: boolean;
  encrypted: boolean;
  message?: string;
}

export interface DiscoveryResult {
  storage: StorageInfo;
  found: BackupFileInfo[];
  newest: BackupFileInfo | null;
  currentInvoiceCount: number;
  shouldPromptRecovery: boolean;
  reason: "no-backups" | "folder-not-selected" | "already-prompted" | "nothing-to-recover" | "prompt";
}
