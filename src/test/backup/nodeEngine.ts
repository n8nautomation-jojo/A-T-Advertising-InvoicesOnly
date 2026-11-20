/**
 * Node port of the native engine's external behaviour (test-only).
 *
 * It is NOT a second production implementation — the shipped engine is the
 * Java one. This harness exists so the acceptance scenarios (interrupted
 * backup, corrupted file, insufficient storage, retention, foreign device,
 * merge vs replace) can be executed against REAL SQLite files and REAL
 * archives in CI, using the same pure TypeScript format/verification modules
 * that the Java engine is validated against.
 *
 * Where it intentionally re-implements logic, the test asserts the two agree
 * by round-tripping archives produced in the "Java shape".
 */

import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { encodeArchive, encodeArchiveV2, openArchive, parseArchive } from "@/lib/backup/codec";
import { bytesToBase64, deriveKeyId, formatRecoveryKey, parseRecoveryKey, sha256Hex, utf8Encode } from "@/lib/backup/crypto";
import type { BackupFileInfo, BackupKind, BackupManifest, RetentionPolicy, TableCounts } from "@/lib/backup/types";
import { planRetention } from "@/lib/backup/retention";
import { countBusinessRecords } from "@/lib/backup/validation";
import { isSchemaCompatible, isValidRestoreCounts } from "./engineAssertions";
import { closeFixture, FixtureDatabase } from "./fixtureDb";

const TABLES = [
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
];

const RESTORE_ORDER = [
  "settings",
  "sequences",
  "db_meta",
  "financial_accounts",
  "customers",
  "suppliers",
  "projects",
  "orders",
  "order_items",
  "custom_invoices",
  "custom_invoice_items",
  "proforma_invoices",
  "proforma_lines",
  "print_invoices",
  "print_invoice_lines",
  "customer_payments",
  "customer_payment_allocations",
  "supplier_payments",
  "supplier_payment_allocations",
  "expenses",
  "expense_payments",
  "financial_transactions",
  "document_sequences",
  "audit_log",
  "official_letters",
];

function countsOf(db: FixtureDatabase): TableCounts {
  const counts: TableCounts = {};
  for (const table of TABLES) {
    try {
      counts[table as keyof TableCounts] = db.count(table);
    } catch {
      // table absent in an older snapshot
    }
  }
  return counts;
}

export interface EngineOptions {
  /** Directory acting as the SAF folder. */
  folderDir: string;
  dbDir: string;
  dbName?: string;
  currentSchema: number;
  key?: Uint8Array;
  retention?: RetentionPolicy;
  /** Simulates storage pressure: free bytes reported by the "device". */
  freeBytes?: number;
  appVersion?: string;
  /** Simulates a database written by a newer release (migration tests). */
  overrideSchemaVersion?: number;
  /** Archive format version to produce (defaults to v2 compressed, matching BackupEngine.java). */
  archiveVersion?: 1 | 2;
  /** Whether to GZIP-compress v2 archives (defaults to true). */
  compress?: boolean;
}

export interface CreateOptions {
  kind: BackupKind;
  skipIfUnchanged?: boolean;
  /** Test hook: throw after N bytes are written (interrupted write). */
  interruptAfterBytes?: number;
  /** Test hook: flip a byte after writing (silent corruption). */
  corruptAfterWrite?: boolean;
  /** Override archive version for a single backup run. */
  archiveVersion?: 1 | 2;
  /** Override compression for a single v2 backup run. */
  compress?: boolean;
}

const FILE_PREFIX = "ta-backup-";
const FILE_SUFFIX = ".tabk";

export class NodeBackupEngine {
  private activeKey: Uint8Array | undefined;
  private readonly keyRing = new Map<string, Uint8Array>();

  constructor(private readonly options: EngineOptions) {
    this.activeKey = options.key ? new Uint8Array(options.key) : undefined;
  }

  private async ensureActiveKeyIndexed(): Promise<void> {
    if (this.activeKey) {
      const id = await deriveKeyId(this.activeKey);
      if (!this.keyRing.has(id)) {
        this.keyRing.set(id, this.activeKey);
      }
    }
  }

  private async resolveKeyForArchive(bytes: Uint8Array): Promise<Uint8Array | undefined> {
    await this.ensureActiveKeyIndexed();
    try {
      const parsed = parseArchive(bytes);
      if (!parsed.sealed) return undefined;
      if (parsed.keyId && this.keyRing.has(parsed.keyId)) {
        return this.keyRing.get(parsed.keyId);
      }
      return this.activeKey;
    } catch {
      return this.activeKey;
    }
  }

  /** Exports the engine's active 256-bit key as a checksummed TAKEY-... Recovery Key. */
  async exportRecoveryKey(): Promise<{ ok: boolean; recoveryKey?: string; keyId?: string; message?: string }> {
    if (!this.activeKey) {
      return { ok: false, message: "لا يوجد مفتاح تشفير نشط على هذا الجهاز." };
    }
    await this.ensureActiveKeyIndexed();
    const recoveryKey = await formatRecoveryKey(this.activeKey);
    const keyId = await deriveKeyId(this.activeKey);
    return { ok: true, recoveryKey, keyId };
  }

  /** Imports a TAKEY-... Recovery Key into the engine's key ring (cross-device unlock). */
  async importRecoveryKey(code: string): Promise<{ ok: boolean; keyId?: string; message?: string }> {
    try {
      const rawKey = await parseRecoveryKey(code);
      const keyId = await deriveKeyId(rawKey);
      this.keyRing.set(keyId, rawKey);
      if (!this.activeKey) {
        this.activeKey = rawKey;
      }
      return { ok: true, keyId };
    } catch (err: any) {
      return { ok: false, message: String(err?.message ?? err) };
    }
  }

  private dbFile(): string {
    return join(this.options.dbDir, `${this.options.dbName ?? "ta_invoicing_db"}SQLite.db`);
  }

  private ensureFolder(): string {
    if (!existsSync(this.options.folderDir)) mkdirSync(this.options.folderDir, { recursive: true });
    return this.options.folderDir;
  }

  private backupId(kind: BackupKind): string {
    const stamp = new Date().toISOString().replace(/[-:T.]/g, "").slice(0, 14);
    return `${stamp}-${kind}-${Math.random().toString(16).slice(2, 8)}`;
  }

  private counts(): { counts: TableCounts; schema: number; invoiceCount: number; totalBusinessRecords: number } {
    const db = new FixtureDatabase(this.options.dbDir, this.options.dbName ?? "ta_invoicing_db");
    try {
      const counts = countsOf(db);
      const schemaRow = db.db.prepare("PRAGMA user_version").get() as any;
      let schema = Number(schemaRow?.user_version ?? 0);
      if (!Number.isFinite(schema) || schema <= 0) {
        try {
          const meta = db.db.prepare("SELECT value FROM db_meta WHERE key='schema_version'").get() as any;
          const parsed = Number(meta?.value ?? 1);
          schema = Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
        } catch {
          schema = 1;
        }
      }
      return {
        counts,
        schema,
        invoiceCount: (counts.custom_invoices ?? 0) + (counts.proforma_invoices ?? 0) + (counts.print_invoices ?? 0),
        totalBusinessRecords: countBusinessRecords(counts as Record<string, number>),
      };
    } finally {
      db.close();
    }
  }

  private probeLiveDatabase(): {
    exists: boolean;
    quickCheckOk: boolean;
    invoiceCount: number;
    totalBusinessRecords: number;
  } {
    if (!existsSync(this.dbFile())) {
      return { exists: false, quickCheckOk: true, invoiceCount: 0, totalBusinessRecords: 0 };
    }
    let db: FixtureDatabase | null = null;
    try {
      db = new FixtureDatabase(this.options.dbDir, this.options.dbName ?? "ta_invoicing_db");
      const quick = db.quickCheck();
      if (quick.toLowerCase() !== "ok") {
        return { exists: true, quickCheckOk: false, invoiceCount: 0, totalBusinessRecords: 0 };
      }
      const counts = countsOf(db);
      const invoiceCount = (counts.custom_invoices ?? 0) + (counts.proforma_invoices ?? 0) + (counts.print_invoices ?? 0);
      const totalBusinessRecords = countBusinessRecords(counts as Record<string, number>);
      return { exists: true, quickCheckOk: true, invoiceCount, totalBusinessRecords };
    } catch {
      return { exists: true, quickCheckOk: false, invoiceCount: 0, totalBusinessRecords: 0 };
    } finally {
      if (db) db.close();
    }
  }

  // ── create ────────────────────────────────────────────────────────────

  async create(options: CreateOptions): Promise<{
    ok: boolean;
    backupId?: string;
    fileName?: string;
    sizeBytes?: number;
    manifest?: BackupManifest;
    skipped?: boolean;
    errorCode?: string;
    message?: string;
  }> {
    const folder = this.ensureFolder();
    if (!existsSync(this.dbFile())) {
      return { ok: false, errorCode: "DATABASE_UNREADABLE", message: "database does not exist" };
    }
    // Snapshot the database exactly like VACUUM INTO does on device.
    const snapshotPath = join(folder, `.snapshot-${Date.now()}-${Math.random().toString(16).slice(2, 6)}.db`);
    let image: Uint8Array;
    let schema: number;
    let quick: string;
    let live: FixtureDatabase | null = null;
    try {
      live = new FixtureDatabase(this.options.dbDir, this.options.dbName ?? "ta_invoicing_db");
      live.snapshotTo(snapshotPath);
      image = new Uint8Array(readFileSync(snapshotPath));
    } catch (err: any) {
      if (existsSync(snapshotPath)) rmSync(snapshotPath, { force: true });
      return { ok: false, errorCode: "DATABASE_UNREADABLE", message: String(err?.message ?? err) };
    } finally {
      if (live) live.close();
    }

    const { DatabaseSync } = await import("node:sqlite");
    let inspect: InstanceType<typeof DatabaseSync> | null = null;
    try {
      inspect = new DatabaseSync(snapshotPath);
      quick = String((inspect.prepare("PRAGMA quick_check").get() as any).quick_check);
      schema = Number((inspect.prepare("PRAGMA user_version").get() as any).user_version) || 1;
    } catch (err: any) {
      return { ok: false, errorCode: "INTEGRITY_FAILED", message: String(err?.message ?? err) };
    } finally {
      if (inspect) inspect.close();
      if (existsSync(snapshotPath)) unlinkSync(snapshotPath);
    }

    // A database created by a newer release keeps its schema marker; the test
    // hook lets us simulate that without inventing a fake schema.
    schema = this.options.overrideSchemaVersion ?? schema;
    if (quick.toLowerCase() !== "ok") {
      return { ok: false, errorCode: "INTEGRITY_FAILED", message: "snapshot failed quick_check: " + quick };
    }
    const meta = this.counts();
    const counts = meta.counts;
    const invoiceCount = meta.invoiceCount;
    const totalBusinessRecords = meta.totalBusinessRecords;

    const payloadSha = await sha256Hex(image);

    if (options.skipIfUnchanged) {
      const newest = (await this.list()).filter((b) => b.status === "verified")[0];
      if (newest?.manifest && newest.manifest.sha256 === payloadSha) {
        return { ok: true, skipped: true, backupId: newest.manifest.backupId };
      }
    }

    await this.ensureActiveKeyIndexed();
    const keyId = this.activeKey ? await deriveKeyId(this.activeKey) : "";

    const id = this.backupId(options.kind);
    const manifest: BackupManifest = {
      format: "TA-BACKUP",
      manifestVersion: 1,
      backupId: id,
      kind: options.kind,
      createdAt: new Date().toISOString(),
      appVersion: this.options.appVersion ?? "1.3.1-INVOICE",
      databaseSchemaVersion: schema,
      databaseSchemaCurrent: this.options.currentSchema,
      databaseFilename: `${this.options.dbName ?? "ta_invoicing_db"}SQLite.db`,
      sha256: payloadSha,
      sizeBytes: image.length,
      payloadSha256: payloadSha,
      encrypted: Boolean(this.activeKey),
      keyId,
      databaseMagic: "SQLite format 3\0",
      counts,
      quickCheck: "ok",
      integrity: "ok",
      invoiceCount,
      totalBusinessRecords,
      installationId: "test-install",
      appId: "com.taadvertising.invoicing",
      device: "node-test",
    };

    const archiveVersion = options.archiveVersion ?? this.options.archiveVersion ?? 2;
    const compress = options.compress ?? this.options.compress ?? true;
    let archive: Uint8Array;
    if (archiveVersion === 1) {
      const envelope = utf8Encode(JSON.stringify({ header: manifest, databaseBase64: bytesToBase64(image) }));
      archive = await encodeArchive(envelope, { rawKey: this.activeKey, keyId: keyId || undefined });
    } else {
      archive = await encodeArchiveV2(manifest, image, {
        rawKey: this.activeKey,
        keyId: keyId || undefined,
        compress,
      });
    }

    const free = this.options.freeBytes ?? Number.MAX_SAFE_INTEGER;
    const required = Math.ceil(archive.length * 1.35) + 8 * 1024 * 1024;
    if (free < required) {
      return { ok: false, errorCode: "INSUFFICIENT_STORAGE", message: `need ${required} have ${free}` };
    }

    const fileName = `${FILE_PREFIX}${id}${FILE_SUFFIX}`;
    const staging = join(folder, fileName + ".tmp");
    let bytes = archive;
    if (options.corruptAfterWrite) {
      bytes = new Uint8Array(archive);
      bytes[bytes.length - 20] ^= 0xff;
    }
    if (options.interruptAfterBytes != null) {
      writeFileSync(staging, bytes.subarray(0, options.interruptAfterBytes));
      // Interrupted write leaves a .tmp file and NO final file — the engine must
      // not treat it as a backup, and must never delete anything before this.
      return { ok: false, errorCode: "IO_FAILED", message: "interrupted write" };
    }
    writeFileSync(staging, bytes);
    const stored = new Uint8Array(readFileSync(staging));
    if ((await sha256Hex(stored)) !== (await sha256Hex(bytes))) {
      unlinkSync(staging);
      return { ok: false, errorCode: "VERIFY_FAILED", message: "write verification failed" };
    }
    renameSync(staging, join(folder, fileName));

    if (options.corruptAfterWrite) {
      return { ok: false, errorCode: "VERIFY_FAILED", message: "stored archive failed verification" };
    }

    // Prune only after the new file is committed and verified.
    const policy = this.options.retention ?? { daily: 7, weekly: 4, monthly: 12, keepMinimum: 2 };
    const records = await this.list();
    const decision = planRetention(records, policy, new Date().getTimezoneOffset());
    for (const name of decision.prune) {
      if (name === fileName) continue;
      const p = join(folder, name);
      if (existsSync(p)) unlinkSync(p);
    }

    return { ok: true, backupId: id, fileName, sizeBytes: archive.length, manifest };
  }

  // ── import external (including renamed) archives ──────────────────────

  async importArchiveBytes(
    bytes: Uint8Array,
    originalFileName: string
  ): Promise<{
    ok: boolean;
    fileName?: string;
    manifest?: BackupManifest;
    needsRecoveryKey?: boolean;
    keyId?: string;
    errorCode?: string;
    message?: string;
  }> {
    const folder = this.ensureFolder();
    let parsed;
    try {
      parsed = parseArchive(bytes);
    } catch (err: any) {
      return { ok: false, errorCode: "CORRUPT_ARCHIVE", message: String(err?.message ?? err) };
    }

    const safeName =
      originalFileName.startsWith(FILE_PREFIX) && originalFileName.endsWith(FILE_SUFFIX)
        ? originalFileName
        : `${FILE_PREFIX}imported-${Date.now()}${FILE_SUFFIX}`;

    const key = await this.resolveKeyForArchive(bytes);
    if (parsed.sealed && !key) {
      writeFileSync(join(folder, safeName), bytes);
      return {
        ok: true,
        fileName: safeName,
        needsRecoveryKey: true,
        keyId: parsed.keyId,
      };
    }

    try {
      const opened = await openArchive(bytes, key);
      const sha = await sha256Hex(opened.database);
      if (sha !== opened.manifest.sha256) {
        return { ok: false, errorCode: "CORRUPT_ARCHIVE", message: "sha256 mismatch on import" };
      }
      writeFileSync(join(folder, safeName), bytes);
      return { ok: true, fileName: safeName, manifest: opened.manifest, needsRecoveryKey: false };
    } catch (err: any) {
      const msg = String(err?.message ?? err);
      if (/ENCRYPTED_NEEDS_KEY|BAD_SEAL/.test(msg) && parsed.sealed) {
        writeFileSync(join(folder, safeName), bytes);
        return { ok: true, fileName: safeName, needsRecoveryKey: true, keyId: parsed.keyId };
      }
      return { ok: false, errorCode: "CORRUPT_ARCHIVE", message: msg };
    }
  }

  // ── list / verify ─────────────────────────────────────────────────────

  async list(): Promise<BackupFileInfo[]> {
    const folder = this.ensureFolder();
    const names = readdirSync(folder).filter((n) => n.startsWith(FILE_PREFIX) && n.endsWith(FILE_SUFFIX));
    const out: BackupFileInfo[] = [];
    for (const name of names) {
      out.push(await this.inspect(join(folder, name), name));
    }
    return out.sort((a, b) => Date.parse(b.manifest?.createdAt ?? "0") - Date.parse(a.manifest?.createdAt ?? "0"));
  }

  private async inspect(path: string, name: string): Promise<BackupFileInfo> {
    const size = statSync(path).size;
    const base: BackupFileInfo = {
      manifest: null,
      fileName: name,
      uri: "file://" + path,
      sizeBytes: size,
      modifiedAt: statSync(path).mtimeMs,
      sha256Ok: false,
      quickCheckOk: false,
      status: "corrupt",
    };
    try {
      const bytes = new Uint8Array(readFileSync(path));
      const key = await this.resolveKeyForArchive(bytes);
      const opened = await openArchive(bytes, key);
      const manifest = opened.manifest;
      if (!isSchemaCompatible(manifest.databaseSchemaVersion, this.options.currentSchema)) {
        return { ...base, manifest, status: "incompatible", issue: "schema newer than app" };
      }
      const sha = await sha256Hex(opened.database);
      if (sha !== manifest.sha256) {
        return { ...base, manifest, status: "corrupt", issue: "sha256 mismatch" };
      }
      return { ...base, manifest, status: "verified", sha256Ok: true, quickCheckOk: true };
    } catch (err: any) {
      const encrypted = /ENCRYPTED_NEEDS_KEY/.test(String(err?.message));
      return { ...base, status: encrypted ? "encrypted" : "corrupt", issue: String(err?.message ?? err) };
    }
  }

  // ── restore ───────────────────────────────────────────────────────────

  async restore(fileName: string, mode: "replace" | "merge"): Promise<{
    ok: boolean;
    safetyBackupId?: string;
    safetyBackupSkippedReason?: string;
    corruptCopyPath?: string;
    counts?: TableCounts;
    errorCode?: string;
    message?: string;
  }> {
    const folder = this.ensureFolder();
    const path = join(folder, fileName);
    if (!existsSync(path)) return { ok: false, errorCode: "IO_FAILED", message: "missing file" };
    const bytes = new Uint8Array(readFileSync(path));
    let opened;
    try {
      const key = await this.resolveKeyForArchive(bytes);
      opened = await openArchive(bytes, key);
    } catch (err: any) {
      return { ok: false, errorCode: "CORRUPT_ARCHIVE", message: String(err?.message ?? err) };
    }
    const image = opened.database;
    const sha = await sha256Hex(image);
    if (sha !== opened.manifest.sha256) {
      return { ok: false, errorCode: "CORRUPT_ARCHIVE", message: "sha mismatch before restore" };
    }
    if (!isSchemaCompatible(opened.manifest.databaseSchemaVersion, this.options.currentSchema)) {
      return { ok: false, errorCode: "INCOMPATIBLE_BACKUP", message: "schema newer than app" };
    }

    // Smart pre-restore safety backup (matching BackupEngine.java).
    const liveProbe = this.probeLiveDatabase();
    const liveHasData = liveProbe.exists && (liveProbe.invoiceCount > 0 || liveProbe.totalBusinessRecords > 0);
    let safetyBackupId = "";
    let safetyBackupSkippedReason: string | undefined;
    let corruptCopyPath: string | undefined;

    if (!liveProbe.exists || (liveProbe.quickCheckOk && !liveHasData)) {
      safetyBackupSkippedReason = "empty-database";
    } else {
      const safety = await this.create({ kind: "pre-restore" });
      if (safety.ok) {
        safetyBackupId = safety.backupId ?? "";
      } else {
        const liveCorrupt =
          safety.errorCode === "INTEGRITY_FAILED" || safety.errorCode === "DATABASE_UNREADABLE";
        if (liveCorrupt && mode === "replace") {
          const rawRescue = join(this.options.dbDir, `.corrupt-rescue-${Date.now()}.db`);
          try {
            copyFileSync(this.dbFile(), rawRescue);
            corruptCopyPath = rawRescue;
          } catch {
            // best-effort raw copy
          }
          safetyBackupSkippedReason = "live-db-corrupt";
        } else {
          return { ok: false, errorCode: "RESTORE_FAILED", message: "safety backup failed" };
        }
      }
    }

    let counts: TableCounts;
    try {
      if (mode === "replace") {
        counts = this.replaceWith(image);
      } else {
        counts = await this.merge(image);
      }
    } catch (err: any) {
      return { ok: false, errorCode: "RESTORE_FAILED", message: String(err?.message ?? err) };
    }

    if (!isValidRestoreCounts(counts)) {
      return { ok: false, errorCode: "RESTORE_FAILED", message: "restored counts inconsistent" };
    }
    return {
      ok: true,
      safetyBackupId: safetyBackupId || undefined,
      safetyBackupSkippedReason,
      corruptCopyPath,
      counts,
    };
  }

  /**
   * Atomically swaps the database image in.
   * On device the WebView connection is closed first; here we close the test
   * fixture (the app-side handle), on every platform, before touching the file.
   */
  private replaceWith(image: Uint8Array): TableCounts {
    closeFixture(this.options.dbDir, this.options.dbName ?? "ta_invoicing_db");
    const target = this.dbFile();
    const staging = target + ".restore-new";
    writeFileSync(staging, image);
    if (existsSync(target)) rmSync(target, { force: true });
    for (const suffix of ["-wal", "-shm", "-journal"]) {
      if (existsSync(target + suffix)) rmSync(target + suffix, { force: true });
    }
    renameSync(staging, target);
    const check = new FixtureDatabase(this.options.dbDir, this.options.dbName ?? "ta_invoicing_db");
    try {
      const quick = check.quickCheck();
      if (quick.toLowerCase() !== "ok") throw new Error(quick);
      return countsOf(check);
    } finally {
      check.close();
    }
  }

  private sharedColumns(live: FixtureDatabase, table: string): string[] {
    const liveCols = (live.db.prepare(`PRAGMA main.table_info("${table}")`).all() as any[]).map((c) => String(c.name));
    const bkCols = new Set((live.db.prepare(`PRAGMA bk.table_info("${table}")`).all() as any[]).map((c) => String(c.name)));
    return liveCols.filter((c) => bkCols.has(c));
  }

  /** Pre-merge UNIQUE reference/serial conflict detection across DIFFERENT IDs (mirrors BackupEngine.java). */
  private checkMergeConflicts(live: FixtureDatabase, existingBk: Set<string>): void {
    const checks: [string, string, string][] = [
      ["custom_invoices", "reference", "الفواتير المخصصة"],
      ["customer_payments", "reference", "مدفوعات العملاء"],
      ["supplier_payments", "reference", "مدفوعات الموردين"],
      ["expense_payments", "reference", "مدفوعات المصروفات"],
      ["proforma_invoices", "serial", "عروض الأسعار"],
      ["print_invoices", "serial", "فواتير الطباعة"],
    ];
    for (const [table, col, label] of checks) {
      if (!existingBk.has(table)) continue;
      const shared = this.sharedColumns(live, table);
      if (!shared.includes("id") || !shared.includes(col)) continue;
      const row = live.db
        .prepare(
          `SELECT b."${col}" AS conflicting FROM bk."${table}" b
           JOIN main."${table}" m ON m."${col}" = b."${col}"
           WHERE b."${col}" IS NOT NULL AND b."${col}" <> '' AND m."id" <> b."id"
           LIMIT 1`
        )
        .get() as any;
      if (row?.conflicting) {
        throw new Error(
          `تعارض في الأرقام المرجعية أثناء الدمج في جدول ${label} (الرقم: ${row.conflicting}). يرجى استخدام الاستبدال الكامل لحماية توازن الحسابات.`
        );
      }
    }
  }

  /** Logical parent guards so orphan child rows are never inserted (mirrors BackupEngine.java). */
  private childParentGuard(table: string, columns: string[]): string {
    const guards: string[] = [];
    if (table === "custom_invoices") {
      if (columns.includes("customer_id")) {
        guards.push(`(b."customer_id" IS NULL OR b."customer_id" = '' OR EXISTS (SELECT 1 FROM main."customers" c WHERE c.id = b."customer_id"))`);
      }
      if (columns.includes("supplier_id")) {
        guards.push(`(b."supplier_id" IS NULL OR b."supplier_id" = '' OR EXISTS (SELECT 1 FROM main."suppliers" s WHERE s.id = b."supplier_id"))`);
      }
    } else if (table === "custom_invoice_items" && columns.includes("invoice_id")) {
      guards.push(`EXISTS (SELECT 1 FROM main."custom_invoices" p WHERE p.id = b."invoice_id")`);
    } else if (table === "proforma_lines" && columns.includes("proforma_id")) {
      guards.push(`EXISTS (SELECT 1 FROM main."proforma_invoices" p WHERE p.id = b."proforma_id")`);
    } else if (table === "print_invoice_lines" && columns.includes("invoice_id")) {
      guards.push(`EXISTS (SELECT 1 FROM main."print_invoices" p WHERE p.id = b."invoice_id")`);
    } else if (table === "order_items" && columns.includes("order_id")) {
      guards.push(`EXISTS (SELECT 1 FROM main."orders" p WHERE p.id = b."order_id")`);
    } else if (table === "customer_payments") {
      if (columns.includes("customer_id")) {
        guards.push(`EXISTS (SELECT 1 FROM main."customers" c WHERE c.id = b."customer_id")`);
      }
      if (columns.includes("account_id")) {
        guards.push(`(b."account_id" IS NULL OR b."account_id" = '' OR EXISTS (SELECT 1 FROM main."financial_accounts" a WHERE a.id = b."account_id"))`);
      }
    } else if (table === "customer_payment_allocations" && columns.includes("payment_id") && columns.includes("invoice_id")) {
      guards.push(`EXISTS (SELECT 1 FROM main."customer_payments" p WHERE p.id = b."payment_id")`);
      guards.push(`EXISTS (SELECT 1 FROM main."custom_invoices" i WHERE i.id = b."invoice_id")`);
    } else if (table === "supplier_payments") {
      if (columns.includes("supplier_id")) {
        guards.push(`EXISTS (SELECT 1 FROM main."suppliers" s WHERE s.id = b."supplier_id")`);
      }
      if (columns.includes("account_id")) {
        guards.push(`(b."account_id" IS NULL OR b."account_id" = '' OR EXISTS (SELECT 1 FROM main."financial_accounts" a WHERE a.id = b."account_id"))`);
      }
    } else if (table === "supplier_payment_allocations" && columns.includes("payment_id") && columns.includes("invoice_id")) {
      guards.push(`EXISTS (SELECT 1 FROM main."supplier_payments" p WHERE p.id = b."payment_id")`);
      guards.push(`EXISTS (SELECT 1 FROM main."custom_invoices" i WHERE i.id = b."invoice_id")`);
    } else if (table === "expenses") {
      if (columns.includes("supplier_id")) {
        guards.push(`(b."supplier_id" IS NULL OR b."supplier_id" = '' OR EXISTS (SELECT 1 FROM main."suppliers" s WHERE s.id = b."supplier_id"))`);
      }
      if (columns.includes("account_id")) {
        guards.push(`(b."account_id" IS NULL OR b."account_id" = '' OR EXISTS (SELECT 1 FROM main."financial_accounts" a WHERE a.id = b."account_id"))`);
      }
    } else if (table === "expense_payments") {
      if (columns.includes("expense_id")) {
        guards.push(`EXISTS (SELECT 1 FROM main."expenses" p WHERE p.id = b."expense_id")`);
      }
      if (columns.includes("account_id")) {
        guards.push(`(b."account_id" IS NULL OR b."account_id" = '' OR EXISTS (SELECT 1 FROM main."financial_accounts" a WHERE a.id = b."account_id"))`);
      }
    } else if (table === "financial_transactions" && columns.includes("account_id")) {
      guards.push(`EXISTS (SELECT 1 FROM main."financial_accounts" p WHERE p.id = b."account_id")`);
    }
    return guards.length > 0 ? ` WHERE ${guards.join(" AND ")}` : "";
  }

  /** Merge: inserts only missing rows, in one transaction, never overwrites. */
  private async merge(image: Uint8Array): Promise<TableCounts> {
    closeFixture(this.options.dbDir, this.options.dbName ?? "ta_invoicing_db");
    const staging = join(this.options.dbDir, ".merge-source.db");
    writeFileSync(staging, image);
    const live = new FixtureDatabase(this.options.dbDir, this.options.dbName ?? "ta_invoicing_db");
    try {
      live.db.exec("PRAGMA foreign_keys = ON;");
      // ATTACH with an alias: the schema-qualified statements below need "bk".
      live.db.prepare("ATTACH DATABASE ? AS bk").run(staging);
      const existingBk = new Set<string>(
        (live.db.prepare("SELECT name FROM bk.sqlite_master WHERE type='table'").all() as any[]).map((r) => String(r.name))
      );
      try {
        this.checkMergeConflicts(live, existingBk);
        live.db.exec("BEGIN");
        try {
          for (const table of RESTORE_ORDER) {
            if (!existingBk.has(table)) continue;
            if (table === "settings" || table === "sequences" || table === "db_meta") {
              live.db.exec(
                `INSERT OR IGNORE INTO main."${table}"(key, value) SELECT key, value FROM bk."${table}" WHERE key NOT IN (SELECT key FROM main."${table}")`
              );
              if (table === "sequences") {
                live.db.exec(
                  `UPDATE main."sequences" SET value = (SELECT b.value FROM bk."sequences" b WHERE b.key = main."sequences".key) WHERE EXISTS (SELECT 1 FROM bk."sequences" b WHERE b.key = main."sequences".key AND CAST(b.value AS INTEGER) > CAST(main."sequences".value AS INTEGER))`
                );
              }
            } else {
              const shared = this.sharedColumns(live, table);
              if (shared.length === 0) continue;
              const colList = shared.map((c) => `"${c}"`).join(",");
              const selectList = shared.map((c) => `b."${c}"`).join(",");
              const whereClause = this.childParentGuard(table, shared);
              live.db.exec(`INSERT OR IGNORE INTO main."${table}" (${colList}) SELECT ${selectList} FROM bk."${table}" b${whereClause}`);
              if (table === "document_sequences") {
                live.db.exec(
                  `UPDATE main."document_sequences" SET last_number = (SELECT b.last_number FROM bk."document_sequences" b WHERE b.scope = main."document_sequences".scope AND b.date_key = main."document_sequences".date_key) WHERE EXISTS (SELECT 1 FROM bk."document_sequences" b WHERE b.scope = main."document_sequences".scope AND b.date_key = main."document_sequences".date_key AND b.last_number > main."document_sequences".last_number)`
                );
              }
            }
          }
          const fkViolations = live.db.prepare("PRAGMA foreign_key_check").all() as any[];
          if (fkViolations.length > 0) {
            throw new Error(`foreign_key_check failed after merge: ${JSON.stringify(fkViolations[0])}`);
          }
          live.db.exec("COMMIT");
        } catch (err) {
          live.db.exec("ROLLBACK");
          throw err;
        }
      } finally {
        live.db.exec("DETACH DATABASE bk");
      }
      return countsOf(live);
    } finally {
      live.close();
      rmSync(staging, { force: true });
    }
  }

  /** Reads one invoice with its items, proving full content round-trip. */
  readInvoice(serial: string): { serial: string; party: string; total: number; items: { description: string; dimensions: string | null; qty: number; total: number }[] } | null {
    const db = new FixtureDatabase(this.options.dbDir, this.options.dbName ?? "ta_invoicing_db");
    try {
      const row = db.db.prepare("SELECT * FROM custom_invoices WHERE serial = ?").get(serial) as any;
      if (!row) return null;
      const items = db.db
        .prepare("SELECT description, dimensions, qty, total FROM custom_invoice_items WHERE invoice_id = ? ORDER BY sort_order")
        .all(row.id) as any[];
      return {
        serial: row.serial,
        party: row.party_name,
        total: Number(row.total_amount),
        items: items.map((i) => ({ description: i.description, dimensions: i.dimensions, qty: Number(i.qty), total: Number(i.total) })),
      };
    } finally {
      db.close();
    }
  }

  getSequence(key: string): string {
    const db = new FixtureDatabase(this.options.dbDir, this.options.dbName ?? "ta_invoicing_db");
    try {
      const row = db.db.prepare("SELECT value FROM sequences WHERE key = ?").get(key) as any;
      return row ? String(row.value) : "";
    } finally {
      db.close();
    }
  }

  getSetting(key: string): string {
    const db = new FixtureDatabase(this.options.dbDir, this.options.dbName ?? "ta_invoicing_db");
    try {
      const row = db.db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as any;
      return row ? String(row.value) : "";
    } finally {
      db.close();
    }
  }
}
