/**
 * ═══════════════════════════════════════════════════════════════
 * Backup validation, discovery ranking & protection status
 * ═══════════════════════════════════════════════════════════════
 * Pure functions that decide:
 *  - whether a backup may be restored (integrity + compatibility + identity),
 *  - which backup to offer for recovery (newest VALID one, never the newest
 *    file blindly — a corrupt newest file must not hide a good older one),
 *  - how protected the user's data currently is (the UI warning level).
 */

import type {
  BackupFileInfo,
  BackupFileStatus,
  BackupManifest,
  BackupSettings,
  ProtectionStatus,
  StorageInfo,
} from "./types";
import { BACKUP_FORMAT_ID, BACKUP_MANIFEST_VERSION, BACKUP_TABLES } from "./types";
import { ArchiveFormatError, parseArchive } from "./codec";
import { bytesToBase64, sha256Hex, utf8Encode } from "./crypto";

export interface ManifestValidation {
  ok: boolean;
  status: BackupFileStatus;
  issue?: string;
}

/** Structural validation of an untrusted manifest (defends against crafted files). */
export function validateManifest(input: unknown): ManifestValidation {
  const m = input as Partial<BackupManifest> | null;
  if (!m || typeof m !== "object") return { ok: false, status: "corrupt", issue: "البيانات الوصفية للنسخة مفقودة." };
  if (m.format !== BACKUP_FORMAT_ID) return { ok: false, status: "incompatible", issue: "الملف ليس نسخة احتياطية صادرة عن هذا التطبيق." };
  if (typeof m.manifestVersion !== "number" || m.manifestVersion > BACKUP_MANIFEST_VERSION) {
    return { ok: false, status: "incompatible", issue: "إصدار النسخة أحدث من إصدار التطبيق الحالي." };
  }
  if (typeof m.backupId !== "string" || !/^[a-z0-9-]{6,64}$/i.test(m.backupId)) {
    return { ok: false, status: "corrupt", issue: "معرّف النسخة غير صالح." };
  }
  if (typeof m.createdAt !== "string" || !Number.isFinite(Date.parse(m.createdAt))) {
    return { ok: false, status: "corrupt", issue: "تاريخ إنشاء النسخة غير صالح." };
  }
  if (typeof m.sha256 !== "string" || !/^[0-9a-f]{64}$/i.test(m.sha256)) {
    return { ok: false, status: "corrupt", issue: "بصمة SHA-256 مفقودة أو غير صالحة." };
  }
  if (typeof m.sizeBytes !== "number" || m.sizeBytes <= 0) {
    return { ok: false, status: "corrupt", issue: "حجم قاعدة البيانات داخل النسخة غير صالح." };
  }
  if (typeof m.databaseSchemaVersion !== "number" || m.databaseSchemaVersion < 1) {
    return { ok: false, status: "corrupt", issue: "إصدار قاعدة البيانات داخل النسخة غير صالح." };
  }
  if (typeof m.counts !== "object" || m.counts === null) {
    return { ok: false, status: "corrupt", issue: "إحصاءات السجلات مفقودة." };
  }
  for (const [key, value] of Object.entries(m.counts)) {
    if (key === "total") continue;
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
      return { ok: false, status: "corrupt", issue: "إحصاءات الجداول غير صالحة." };
    }
  }
  if (m.databaseMagic !== "SQLite format 3\0") {
    return { ok: false, status: "corrupt", issue: "الملف الداخلي ليس قاعدة بيانات SQLite صالحة." };
  }
  return { ok: true, status: "verified" };
}

/** Schema compatibility: the current build must understand the snapshot. */
export function isSchemaCompatible(snapshotSchema: number, currentSchema: number): boolean {
  // Backups are always created from a build <= current schema; anything newer
  // was produced by a future release and cannot be downgraded safely.
  return snapshotSchema >= 1 && snapshotSchema <= currentSchema;
}

export interface VerifyInput {
  fileName: string;
  uri: string;
  sizeBytes: number;
  modifiedAt: number;
  manifest: BackupManifest | null;
  currentSchema: number;
  /** SHA-256 of the database recovered from the payload (null when not checked). */
  payloadSha256?: string | null;
  quickCheckOk?: boolean;
  sealed: boolean;
}

/** Produces the user-facing status of one backup file. */
export function evaluateBackupFile(input: VerifyInput): BackupFileInfo {
  const base: BackupFileInfo = {
    manifest: input.manifest,
    fileName: input.fileName,
    uri: input.uri,
    sizeBytes: input.sizeBytes,
    modifiedAt: input.modifiedAt,
    sha256Ok: false,
    quickCheckOk: false,
    status: "corrupt",
  };

  if (!input.manifest) {
    return { ...base, status: "unreadable", issue: "تعذّر قراءة بيانات النسخة." };
  }

  const structure = validateManifest(input.manifest);
  if (!structure.ok) {
    return {
      ...base,
      status: structure.status,
      issue: structure.issue,
      sha256Ok: false,
      quickCheckOk: false,
      manifest: {
        ...input.manifest,
      },
    };
  }

  if (!isSchemaCompatible(input.manifest.databaseSchemaVersion, input.currentSchema)) {
    return {
      ...base,
      status: "incompatible",
      issue: "قاعدة البيانات داخل النسخة أحدث من التطبيق الحالي (" + input.manifest.databaseSchemaVersion + ").",
    };
  }

  if (input.payloadSha256 == null) {
    return { ...base, status: "unreadable", issue: "لم يتم التحقق من بصمة SHA-256 للنسخة." };
  }

  const match = input.payloadSha256.toLowerCase() === input.manifest.sha256.toLowerCase();
  if (!match) {
    return { ...base, status: "corrupt", issue: "فشل التحقق من البصمة SHA-256 — الملف تالف." };
  }
  base.sha256Ok = true;

  if (input.quickCheckOk === false) {
    return { ...base, status: "corrupt", issue: "فحص سلامة قاعدة البيانات داخلها فشل." };
  }
  base.quickCheckOk = input.quickCheckOk === true;

  return { ...base, status: "verified" };
}

/** Returns true when a backup may be used to restore. */
export function isRestorable(info: BackupFileInfo | null | undefined): boolean {
  return Boolean(info && info.status === "verified" && info.sha256Ok && info.manifest);
}

/** Newest verified backup, independent of list ordering. */
export function newestVerified(backups: BackupFileInfo[]): BackupFileInfo | null {
  let best: BackupFileInfo | null = null;
  for (const b of backups) {
    if (b.status !== "verified" || !b.sha256Ok || !b.manifest) continue;
    if (!best || Date.parse(b.manifest.createdAt) > Date.parse(best.manifest!.createdAt)) best = b;
  }
  return best;
}

export const BUSINESS_RECORD_TABLES = [
  "custom_invoices",
  "proforma_invoices",
  "print_invoices",
  "customers",
  "suppliers",
  "orders",
  "financial_accounts",
  "customer_payments",
  "supplier_payments",
  "expenses",
  "expense_payments",
  "official_letters",
] as const;

export function countBusinessRecords(counts: Record<string, number> | undefined): number {
  if (!counts) return 0;
  let total = 0;
  for (const table of BUSINESS_RECORD_TABLES) {
    const n = Number(counts[table] ?? 0);
    if (Number.isFinite(n) && n > 0) total += n;
  }
  return total;
}

/**
 * Newest verified backup that actually contains data (invoices or business records),
 * falling back to the newest verified backup if none have data.
 * This prevents picking an empty pre-update safety backup over real historical backups.
 */
export function newestWithData(backups: BackupFileInfo[]): BackupFileInfo | null {
  const verified = backups.filter((b) => b.status === "verified" && b.sha256Ok && b.manifest);
  if (verified.length === 0) return null;

  const withData = verified.filter((b) => {
    const invCount = b.manifest!.invoiceCount ?? countInvoices(b.manifest!.counts);
    const businessCount = b.manifest!.totalBusinessRecords ?? countBusinessRecords(b.manifest!.counts);
    const totalCount = b.manifest!.counts?.total ?? 0;
    return invCount > 0 || businessCount > 0 || totalCount > 0;
  });

  const pool = withData.length > 0 ? withData : verified;
  let best: BackupFileInfo | null = null;
  for (const b of pool) {
    if (!best || Date.parse(b.manifest!.createdAt) > Date.parse(best.manifest!.createdAt)) {
      best = b;
    }
  }
  return best;
}

export function countInvoices(counts: Record<string, number> | undefined): number {
  if (!counts) return 0;
  return (counts.custom_invoices ?? 0) + (counts.proforma_invoices ?? 0) + (counts.print_invoices ?? 0);
}

export interface ProtectionContext {
  storage: StorageInfo;
  backups: BackupFileInfo[];
  settings: BackupSettings;
  databaseInvoiceCount: number;
  now: number;
  databaseBusinessRecordCount?: number;
  nativeLastBackupAt?: string | null;
  nativeLastBackupStatus?: "ok" | "failed" | "never";
  nativeLastBackupMessage?: string | null;
}

export interface ProtectionAssessment {
  status: ProtectionStatus;
  reason: string | null;
  newest: BackupFileInfo | null;
  ageHours: number | null;
  staleAt: number | null;
}

/**
 * The protection level shown in the UI.
 * "protected" requires a *verified* backup that is recent enough AND covers at
 * least the invoices and business records currently in the database — a backup
 * taken before the last 40 invoices or recent edits is not protection, it is a near miss.
 */
export function assessProtection(ctx: ProtectionContext): ProtectionAssessment {
  const { storage, backups, settings, databaseInvoiceCount, now } = ctx;

  if (storage.state === "browser" || storage.state === "unsupported") {
    return { status: "browser", reason: "النسخ التلقائي يعمل داخل تطبيق أندرويد فقط.", newest: null, ageHours: null, staleAt: null };
  }
  if (storage.state === "folder-not-selected") {
    return {
      status: "unprotected",
      reason: "لم يتم تحديد مجلد النسخ الاحتياطي بعد — بياناتك محفوظة على الجهاز فقط.",
      newest: null,
      ageHours: null,
      staleAt: null,
    };
  }
  if (storage.state === "permission-lost") {
    return {
      status: "unprotected",
      reason: "فُقد الوصول إلى مجلد النسخ الاحتياطي — أعد ربط المجلد لحماية بياناتك.",
      newest: null,
      ageHours: null,
      staleAt: null,
    };
  }
  if (storage.state === "unavailable") {
    return { status: "unprotected", reason: storage.message || "مساحة التخزين غير متاحة.", newest: null, ageHours: null, staleAt: null };
  }

  const newest = newestVerified(backups);
  if (!newest) {
    return {
      status: "unprotected",
      reason:
        backups.length > 0
          ? "النسخ الموجودة في المجلد غير سليمة ولم تُعتمد — أنشئ نسخة جديدة."
          : "لا توجد أي نسخة احتياطية سليمة بعد.",
      newest: null,
      ageHours: null,
      staleAt: null,
    };
  }

  const createdMs = Date.parse(newest.manifest!.createdAt);
  const ageHours = Math.max(0, (now - createdMs) / 3_600_000);
  const staleAt = settings.staleAfterHours * 3_600_000;
  const backupInvoices = newest.manifest!.invoiceCount ?? countInvoices(newest.manifest!.counts);
  const backupBusinessRecords = newest.manifest!.totalBusinessRecords ?? countBusinessRecords(newest.manifest!.counts);

  // Merge native WorkManager last backup status if newer than settings (or if settings has none).
  const settingsLastMs = settings.lastBackupAt ? Date.parse(settings.lastBackupAt) : NaN;
  const nativeLastMs = ctx.nativeLastBackupAt ? Date.parse(ctx.nativeLastBackupAt) : NaN;
  const useNativeStatus =
    Boolean(ctx.nativeLastBackupStatus) &&
    ctx.nativeLastBackupStatus !== "never" &&
    Number.isFinite(nativeLastMs) &&
    (!Number.isFinite(settingsLastMs) || nativeLastMs >= settingsLastMs);

  const effectiveLastStatus = useNativeStatus ? ctx.nativeLastBackupStatus! : settings.lastBackupStatus;
  const effectiveLastAt = useNativeStatus ? ctx.nativeLastBackupAt! : settings.lastBackupAt;
  const effectiveLastMessage = useNativeStatus ? (ctx.nativeLastBackupMessage ?? null) : settings.lastBackupMessage;

  if (effectiveLastStatus === "failed" && effectiveLastAt && Date.parse(effectiveLastAt) >= createdMs - 1000) {
    return {
      status: "outdated",
      reason: "فشلت آخر محاولة نسخ احتياطي: " + (effectiveLastMessage || "خطأ غير معروف"),
      newest,
      ageHours,
      staleAt,
    };
  }

  if (backupInvoices < databaseInvoiceCount) {
    return {
      status: "unproven",
      reason:
        "أحدث نسخة سليمة تحتوي " + backupInvoices + " فاتورة بينما الجهاز يحتوي " + databaseInvoiceCount + " — لم تُؤمَّن كل الفواتير بعد.",
      newest,
      ageHours,
      staleAt,
    };
  }

  if (ctx.databaseBusinessRecordCount != null && backupBusinessRecords < ctx.databaseBusinessRecordCount) {
    return {
      status: "unproven",
      reason:
        "أحدث نسخة سليمة تحتوي " +
        backupBusinessRecords +
        " سجلاً بينما الجهاز يحتوي " +
        ctx.databaseBusinessRecordCount +
        " — توجد سجلات جديدة (عملاء أو خطابات أو مدفوعات أو مصروفات) لم تُنسخ احتياطياً بعد.",
      newest,
      ageHours,
      staleAt,
    };
  }

  if (settings.lastDataChangeAt) {
    const lastChangeMs = Date.parse(settings.lastDataChangeAt);
    if (Number.isFinite(lastChangeMs) && lastChangeMs > createdMs + 2000) {
      return {
        status: "unproven",
        reason: "حدثت تعديلات حديثة على البيانات بعد آخر نسخة احتياطية — أنشئ نسخة جديدة لتأمين آخر التغييرات.",
        newest,
        ageHours,
        staleAt,
      };
    }
  }

  if (ageHours * 3_600_000 > staleAt) {
    return {
      status: "stale",
      reason: "مرّ أكثر من " + settings.staleAfterHours + " ساعة بدون نسخة احتياطية سليمة.",
      newest,
      ageHours,
      staleAt,
    };
  }

  return { status: "protected", reason: null, newest, ageHours, staleAt };
}

/**
 * Discovery used at first launch after (re)install and on every folder reconnect.
 * Only verified backups are offered; corrupt files are reported separately so
 * the user understands that an older good copy is being offered instead.
 */
export interface DiscoveryContext {
  storage: StorageInfo;
  backups: BackupFileInfo[];
  currentInvoiceCount: number;
  currentBusinessRecordCount?: number;
  settings: BackupSettings;
}

export interface DiscoveryDecision {
  newest: BackupFileInfo | null;
  shouldPrompt: boolean;
  reason: "no-backups" | "folder-not-selected" | "already-prompted" | "nothing-to-recover" | "prompt";
  corruptCount: number;
}

export function decideDiscovery(ctx: DiscoveryContext, nowMs: number): DiscoveryDecision {
  const corruptCount = ctx.backups.filter((b) => b.status !== "verified").length;
  if (ctx.storage.state === "folder-not-selected" || ctx.storage.state === "permission-lost") {
    return { newest: null, shouldPrompt: false, reason: "folder-not-selected", corruptCount };
  }
  if (ctx.backups.length === 0) {
    return { newest: null, shouldPrompt: false, reason: "no-backups", corruptCount };
  }
  const newest = newestWithData(ctx.backups);
  if (!newest) {
    return { newest: null, shouldPrompt: false, reason: "no-backups", corruptCount };
  }
  const ageDays = (nowMs - Date.parse(newest.manifest!.createdAt)) / 86_400_000;
  // Prompt only when there is genuinely something worth restoring: either the
  // device has less data than the backup (invoices or other business records),
  // or the backup is recent enough that the user almost certainly wants it back.
  const backupInvoices = newest.manifest!.invoiceCount ?? countInvoices(newest.manifest!.counts);
  const backupBusinessRecords = newest.manifest!.totalBusinessRecords ?? countBusinessRecords(newest.manifest!.counts);
  const currentBusinessRecords = ctx.currentBusinessRecordCount ?? ctx.currentInvoiceCount;
  const worthRestoring =
    backupInvoices > ctx.currentInvoiceCount ||
    backupBusinessRecords > currentBusinessRecords ||
    ageDays <= 45;
  if (!worthRestoring) {
    return { newest, shouldPrompt: false, reason: "nothing-to-recover", corruptCount };
  }
  if (ctx.settings.dismissedRecoveryBackupId === newest.manifest!.backupId) {
    return { newest, shouldPrompt: false, reason: "already-prompted", corruptCount };
  }
  return { newest, shouldPrompt: true, reason: "prompt", corruptCount };
}

/**
 * Pre-flight check for storage pressure.
 * We require headroom for the new archive plus a safety margin, because a
 * half-written backup must never fill the volume that holds the database.
 */
export function hasStorageHeadroom(freeBytes: number, estimatedArchiveBytes: number, minimumFreeBytes = 8 * 1024 * 1024): {
  ok: boolean;
  required: number;
} {
  const required = Math.ceil(estimatedArchiveBytes * 1.35) + minimumFreeBytes;
  return { ok: freeBytes >= required, required };
}

/** Names every table the manifest claims and flags unknown ones (forward compat). */
export function unexpectedTables(counts: Record<string, number>): string[] {
  const known = new Set<string>([...BACKUP_TABLES, "total"]);
  return Object.keys(counts).filter((k) => !known.has(k));
}

/** Re-exported for callers that build manifests in the browser (diagnostics). */
export async function fingerprintDatabase(bytes: Uint8Array): Promise<string> {
  return sha256Hex(bytes);
}

export function isLikelyBackupFileName(name: string): boolean {
  return /^ta-backup-.*\.tabk$/i.test(name);
}

export function describeArchiveFailure(err: unknown): string {
  if (err instanceof ArchiveFormatError) return err.message;
  return err instanceof Error ? err.message : String(err);
}

export function peekArchiveHeader(bytes: Uint8Array): { sealed: boolean; keyId: string } | null {
  try {
    const parsed = parseArchive(bytes);
    return { sealed: parsed.sealed, keyId: parsed.keyId };
  } catch {
    return null;
  }
}

export { bytesToBase64, utf8Encode };
