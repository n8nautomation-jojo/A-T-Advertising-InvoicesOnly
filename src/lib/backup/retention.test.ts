import { describe, expect, it } from "vitest";
import {
  localCalendar,
  dailyKey,
  weeklyKey,
  monthlyKey,
  planRetention,
  shouldCreateScheduledBackup,
  MAX_TRANSACTION_BACKUPS,
  MAX_SAFETY_BACKUPS,
} from "@/lib/backup/retention";
import {
  assessProtection,
  countBusinessRecords,
  decideDiscovery,
  newestVerified,
  newestWithData,
  validateManifest,
  evaluateBackupFile,
  isSchemaCompatible,
  hasStorageHeadroom,
} from "@/lib/backup/validation";
import {
  BACKUP_FORMAT_ID,
  DEFAULT_BACKUP_SETTINGS,
  type BackupFileInfo,
  type BackupKind,
  type BackupManifest,
  type RetentionPolicy,
  type StorageInfo,
} from "@/lib/backup/types";

const POLICY: RetentionPolicy = { daily: 7, weekly: 4, monthly: 12, keepMinimum: 2 };
const UTC = 0;

function manifest(overrides: Partial<BackupManifest>): BackupManifest {
  return {
    format: BACKUP_FORMAT_ID,
    manifestVersion: 1,
    backupId: "backup-fix-1",
    kind: "daily",
    createdAt: "2026-11-01T10:00:00.000Z",
    appVersion: "1.3.1",
    databaseSchemaVersion: 1,
    databaseSchemaCurrent: 1,
    databaseFilename: "ta_invoicing_dbSQLite.db",
    sha256: "a".repeat(64),
    sizeBytes: 100,
    payloadSha256: "a".repeat(64),
    encrypted: false,
    keyId: "",
    databaseMagic: "SQLite format 3\u0000",
    counts: { custom_invoices: 3 },
    quickCheck: "ok",
    integrity: "ok",
    invoiceCount: 3,
    installationId: "i",
    appId: "com.taadvertising.invoicing",
    device: "d",
    ...overrides,
  };
}

function file(kind: BackupKind, createdAt: string, id: string, status: BackupFileInfo["status"] = "verified"): BackupFileInfo {
  return {
    manifest: status === "unreadable" ? null : manifest({ kind, createdAt, backupId: id, invoiceCount: 3 }),
    fileName: `ta-backup-${id}.tabk`,
    uri: "file:///" + id,
    sizeBytes: 100,
    modifiedAt: 0,
    sha256Ok: status === "verified",
    quickCheckOk: status === "verified",
    status,
  };
}

describe("Retention planner", () => {
  it("keeps the 7 newest daily periods and prunes the rest", () => {
    const files: BackupFileInfo[] = [];
    for (let day = 1; day <= 12; day++) {
      files.push(file("daily", `2026-11-${String(day).padStart(2, "0")}T08:00:00.000Z`, `d${day}`));
    }
    const plan = planRetention(files, POLICY, UTC);
    expect(plan.prune.length).toBe(5);
    // Oldest days are pruned first.
    expect(plan.prune).toEqual(["ta-backup-d1.tabk", "ta-backup-d2.tabk", "ta-backup-d3.tabk", "ta-backup-d4.tabk", "ta-backup-d5.tabk"]);
    expect(plan.keep).not.toContain("ta-backup-d5.tabk");
  });

  it("keeps only the newest file per day, not every file of the day", () => {
    const files = [
      file("daily", "2026-11-10T06:00:00.000Z", "a"),
      file("daily", "2026-11-10T12:00:00.000Z", "b"),
      file("daily", "2026-11-10T18:00:00.000Z", "c"),
      file("daily", "2026-11-11T08:00:00.000Z", "d"),
    ];
    // The representative kept for a day must be its NEWEST file: keeping an
    // older copy of the same day would silently discard the freshest data.
    const plan = planRetention(files, { daily: 1, weekly: 1, monthly: 1, keepMinimum: 1 }, UTC);
    expect(plan.keep).not.toContain("ta-backup-c.tabk");
    expect(plan.keep).not.toContain("ta-backup-b.tabk");
    expect(plan.keep).toContain("ta-backup-d.tabk");
    expect(plan.prune).not.toContain("ta-backup-d.tabk");
  });

  it("NEVER prunes manual, transaction, pre-update or pre-restore copies", () => {
    const files = [
      file("manual", "2026-01-01T00:00:00.000Z", "m1"),
      file("transaction", "2026-01-02T00:00:00.000Z", "t1"),
      file("pre-update", "2026-01-03T00:00:00.000Z", "u1"),
      file("pre-restore", "2026-01-04T00:00:00.000Z", "r1"),
      ...Array.from({ length: 20 }, (_, i) => file("daily", `2026-02-${String(i + 1).padStart(2, "0")}T00:00:00.000Z`, `d${i}`)),
    ];
    const plan = planRetention(files, { daily: 3, weekly: 4, monthly: 12, keepMinimum: 1 }, UTC);
    for (const protectedName of ["ta-backup-m1.tabk", "ta-backup-t1.tabk", "ta-backup-u1.tabk", "ta-backup-r1.tabk"]) {
      expect(plan.prune).not.toContain(protectedName);
    }
  });

  it("never prunes unreadable files (they may still be recoverable)", () => {
    const files = [
      file("daily", "2026-01-01T00:00:00.000Z", "bad", "unreadable"),
      ...Array.from({ length: 10 }, (_, i) => file("daily", `2026-03-${String(i + 1).padStart(2, "0")}T00:00:00.000Z`, `g${i}`)),
    ];
    const plan = planRetention(files, { daily: 2, weekly: 4, monthly: 12, keepMinimum: 1 }, UTC);
    expect(plan.prune).not.toContain("ta-backup-bad.tabk");
  });

  it("honours keepMinimum even when the policy asks for zero", () => {
    const files = Array.from({ length: 5 }, (_, i) => file("daily", `2026-05-0${i + 1}T00:00:00.000Z`, `k${i}`));
    const plan = planRetention(files, { daily: 0, weekly: 0, monthly: 0, keepMinimum: 3 }, UTC);
    expect(plan.prune).toEqual(["ta-backup-k0.tabk", "ta-backup-k1.tabk"]);
  });

  it("keeps 4 weekly and 12 monthly periods", () => {
    const weeklyFiles = Array.from({ length: 8 }, (_, i) => {
      const d = new Date(Date.UTC(2026, 0, 5 + i * 7, 9));
      return file("weekly", d.toISOString(), `w${i}`);
    });
    expect(planRetention(weeklyFiles, POLICY, UTC).prune.length).toBe(4);

    const monthlyFiles = Array.from({ length: 15 }, (_, i) => file("monthly", `202${5 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}-01T00:00:00.000Z`, `mo${i}`));
    const months = new Set(monthlyFiles.map((f) => monthlyKey(localCalendar(f.manifest!.createdAt, UTC))));
    expect(planRetention(monthlyFiles, POLICY, UTC).prune.length).toBe(months.size - 12);
  });

  it("caps transaction backups at MAX_TRANSACTION_BACKUPS (10) and safety backups at MAX_SAFETY_BACKUPS (5) while keeping all manual backups", () => {
    const txFiles = Array.from({ length: MAX_TRANSACTION_BACKUPS + 4 }, (_, i) =>
      file("transaction", `2026-11-${String(i + 1).padStart(2, "0")}T10:00:00.000Z`, `tx${i + 1}`)
    );
    const preRestoreFiles = Array.from({ length: MAX_SAFETY_BACKUPS + 3 }, (_, i) =>
      file("pre-restore", `2026-10-${String(i + 1).padStart(2, "0")}T10:00:00.000Z`, `pr${i + 1}`)
    );
    const preUpdateFiles = Array.from({ length: MAX_SAFETY_BACKUPS + 2 }, (_, i) =>
      file("pre-update", `2026-09-${String(i + 1).padStart(2, "0")}T10:00:00.000Z`, `pu${i + 1}`)
    );
    const manualFiles = Array.from({ length: 15 }, (_, i) =>
      file("manual", `2026-08-${String(i + 1).padStart(2, "0")}T10:00:00.000Z`, `man${i + 1}`)
    );

    const plan = planRetention([...txFiles, ...preRestoreFiles, ...preUpdateFiles, ...manualFiles], POLICY, UTC);

    // Excess transaction backups pruned (oldest 4)
    expect(plan.prune).toContain("ta-backup-tx1.tabk");
    expect(plan.prune).toContain("ta-backup-tx4.tabk");
    expect(plan.prune).not.toContain("ta-backup-tx5.tabk");
    expect(plan.keep.filter((n) => n.includes("-tx")).length).toBe(MAX_TRANSACTION_BACKUPS);

    // Excess pre-restore & pre-update pruned
    expect(plan.keep.filter((n) => n.includes("-pr")).length).toBe(MAX_SAFETY_BACKUPS);
    expect(plan.keep.filter((n) => n.includes("-pu")).length).toBe(MAX_SAFETY_BACKUPS);

    // Manual snapshots are NEVER pruned
    expect(plan.keep.filter((n) => n.includes("-man")).length).toBe(15);
  });

  it("prunes automated backups older than maxAgeDays (30-day rolling window) while keeping manual snapshots intact", () => {
    const nowMs = Date.parse("2026-11-21T12:00:00.000Z");
    const files = [
      file("daily", "2026-11-20T08:00:00.000Z", "recent-daily"),
      file("transaction", "2026-11-18T10:00:00.000Z", "recent-tx"),
      file("daily", "2026-10-10T08:00:00.000Z", "old-daily"), // 42 days old
      file("weekly", "2026-09-25T08:00:00.000Z", "old-weekly"), // 57 days old
      file("transaction", "2026-10-05T08:00:00.000Z", "old-tx"), // 47 days old
      file("pre-update", "2026-10-01T08:00:00.000Z", "old-preup"), // 51 days old
      file("manual", "2026-06-01T08:00:00.000Z", "old-manual"), // 173 days old -> MUST stay!
    ];
    const plan = planRetention(files, { daily: 30, weekly: 4, monthly: 1, keepMinimum: 2, maxAgeDays: 30 }, UTC, nowMs);

    expect(plan.keep).toContain("ta-backup-recent-daily.tabk");
    expect(plan.keep).toContain("ta-backup-recent-tx.tabk");
    expect(plan.keep).toContain("ta-backup-old-manual.tabk");
    expect(plan.prune).toEqual([
      "ta-backup-old-weekly.tabk",
      "ta-backup-old-preup.tabk",
      "ta-backup-old-tx.tabk",
      "ta-backup-old-daily.tabk",
    ]);
  });

  it("still protects keepMinimum newest verified backups even when ALL backups are older than maxAgeDays", () => {
    const nowMs = Date.parse("2026-11-21T12:00:00.000Z");
    const files = [
      file("daily", "2026-09-01T08:00:00.000Z", "old1"),
      file("daily", "2026-09-10T08:00:00.000Z", "old2"),
      file("daily", "2026-09-20T08:00:00.000Z", "old3"),
      file("daily", "2026-09-30T08:00:00.000Z", "old4"),
    ];
    const plan = planRetention(files, { daily: 30, weekly: 4, monthly: 1, keepMinimum: 2, maxAgeDays: 30 }, UTC, nowMs);

    // Must never wipe the folder empty — newest 2 survive!
    expect(plan.keep).toEqual(["ta-backup-old4.tabk", "ta-backup-old3.tabk"]);
    expect(plan.prune).toEqual(["ta-backup-old1.tabk", "ta-backup-old2.tabk"]);
  });

  it("compacts past-day (>24h) transaction backups down to the newest 1 per day when maxAgeDays is active", () => {
    const nowMs = Date.parse("2026-11-21T12:00:00.000Z");
    const files = [
      // Today (<24h): both kept
      file("transaction", "2026-11-21T11:00:00.000Z", "today-2"),
      file("transaction", "2026-11-21T09:00:00.000Z", "today-1"),
      // 3 days ago (>24h): 3 copies on same calendar day -> keep newest only (past-3)
      file("transaction", "2026-11-18T18:00:00.000Z", "past-3"),
      file("transaction", "2026-11-18T14:00:00.000Z", "past-2"),
      file("transaction", "2026-11-18T08:00:00.000Z", "past-1"),
    ];
    const plan = planRetention(files, { daily: 30, weekly: 4, monthly: 1, keepMinimum: 2, maxAgeDays: 30 }, UTC, nowMs);

    expect(plan.keep).toContain("ta-backup-today-2.tabk");
    expect(plan.keep).toContain("ta-backup-today-1.tabk");
    expect(plan.keep).toContain("ta-backup-past-3.tabk");
    expect(plan.prune).toEqual(["ta-backup-past-1.tabk", "ta-backup-past-2.tabk"]);
  });
});

describe("Scheduled backup de-duplication", () => {
  it("does not create a second daily backup for the same local day", () => {
    const now = Date.parse("2026-11-11T20:00:00.000Z");
    const files = [file("daily", "2026-11-11T02:00:00.000Z", "today")];
    expect(shouldCreateScheduledBackup("daily", now, files, UTC)).toBe(false);
    expect(shouldCreateScheduledBackup("daily", now, [file("daily", "2026-11-10T02:00:00.000Z", "y")], UTC)).toBe(true);
  });

  it("uses local calendar days, not UTC days", () => {
    // 22:30 UTC on Nov 10 is already Nov 11 in Khartoum (UTC+2).
    const now = Date.parse("2026-11-10T22:30:00.000Z");
    const files = [file("daily", "2026-11-10T23:00:00.000Z", "khartoum-today")];
    expect(shouldCreateScheduledBackup("daily", now, files, -120)).toBe(false);
    expect(shouldCreateScheduledBackup("daily", now, files, 0)).toBe(false); // same UTC day too
    const nextDay = Date.parse("2026-11-11T23:00:00.000Z");
    expect(shouldCreateScheduledBackup("daily", nextDay, files, -120)).toBe(true);
  });

  it("computes ISO week keys matching the ISO-8601 calendar", () => {
    expect(weeklyKey(localCalendar("2026-01-01T12:00:00.000Z", 0), 0)).toBe("2026-W01");
    expect(weeklyKey(localCalendar("2025-12-29T12:00:00.000Z", 0), 0)).toBe("2026-W01");
    expect(dailyKey(localCalendar("2026-11-11T12:00:00.000Z", 0), 0)).toBe("2026-11-11");
    expect(monthlyKey(localCalendar("2026-11-30T23:00:00.000Z", 120), 120)).toBe("2026-11");
  });
});

describe("Discovery & recovery decision", () => {
  const storage: StorageInfo = {
    state: "ok",
    folderUri: "content://tree/x",
    folderLabel: "Documents/InvoiceBackups",
    totalBytes: -1,
    freeBytes: 1e12,
    appDataBytes: 0,
    backupBytes: 100,
    backupCount: 1,
  };
  const settings = { ...DEFAULT_BACKUP_SETTINGS, dismissedRecoveryBackupId: null };
  const now = Date.parse("2026-11-11T10:00:00.000Z");

  it("offers the newest VERIFIED backup even when a newer file is corrupt", () => {
    const files = [
      file("daily", "2026-11-11T09:00:00.000Z", "corrupt-newest", "corrupt"),
      file("daily", "2026-11-10T09:00:00.000Z", "good-older"),
    ];
    expect(newestVerified(files)?.manifest?.backupId).toBe("good-older");
    const decision = decideDiscovery({ storage, backups: files, currentInvoiceCount: 0, settings }, now);
    expect(decision.newest?.manifest?.backupId).toBe("good-older");
    expect(decision.shouldPrompt).toBe(true);
    expect(decision.corruptCount).toBe(1);
  });

  it("prompts only when the folder is reachable and something is worth restoring", () => {
    const none = decideDiscovery({ storage, backups: [], currentInvoiceCount: 0, settings }, now);
    expect(none.shouldPrompt).toBe(false);
    expect(none.reason).toBe("no-backups");

    const locked = decideDiscovery(
      { storage: { ...storage, state: "permission-lost" }, backups: [file("daily", "2026-11-10T09:00:00.000Z", "x")], currentInvoiceCount: 0, settings },
      now
    );
    expect(locked.shouldPrompt).toBe(false);
    expect(locked.reason).toBe("folder-not-selected");
  });

  it("does not prompt again once the user dismissed that backup", () => {
    const files = [file("daily", "2026-11-10T09:00:00.000Z", "dismissed")];
    const decision = decideDiscovery(
      { storage, backups: files, currentInvoiceCount: 0, settings: { ...settings, dismissedRecoveryBackupId: "dismissed" } },
      now
    );
    expect(decision.shouldPrompt).toBe(false);
    expect(decision.reason).toBe("already-prompted");
  });

  it("does not prompt when the device already holds more data than the old backup", () => {
    const files = [file("daily", "2026-01-10T09:00:00.000Z", "old")];
    const decision = decideDiscovery({ storage, backups: files, currentInvoiceCount: 50, settings }, now);
    expect(decision.shouldPrompt).toBe(false);
    expect(decision.reason).toBe("nothing-to-recover");
  });

  it("discovers and prompts for a backup containing only customers & official_letters (0 invoices)", () => {
    const emptyPreUpdate: BackupFileInfo = {
      ...file("pre-update", "2026-11-11T09:30:00.000Z", "empty-pre"),
      manifest: manifest({
        kind: "pre-update",
        createdAt: "2026-11-11T09:30:00.000Z",
        backupId: "empty-pre",
        invoiceCount: 0,
        totalBusinessRecords: 0,
        counts: {},
      }),
    };
    const lettersOnlyBackup: BackupFileInfo = {
      ...file("manual", "2026-06-01T09:00:00.000Z", "letters-only"),
      manifest: manifest({
        kind: "manual",
        createdAt: "2026-06-01T09:00:00.000Z",
        backupId: "letters-only",
        invoiceCount: 0,
        totalBusinessRecords: 5,
        counts: { customers: 2, official_letters: 3 },
      }),
    };
    expect(countBusinessRecords(lettersOnlyBackup.manifest!.counts)).toBe(5);
    expect(newestWithData([emptyPreUpdate, lettersOnlyBackup])?.manifest?.backupId).toBe("letters-only");

    const decision = decideDiscovery(
      { storage, backups: [emptyPreUpdate, lettersOnlyBackup], currentInvoiceCount: 0, currentBusinessRecordCount: 0, settings },
      now
    );
    expect(decision.shouldPrompt).toBe(true);
    expect(decision.newest?.manifest?.backupId).toBe("letters-only");
  });
});

describe("Manifest & file validation", () => {
  it("accepts a well-formed manifest and rejects crafted ones", () => {
    expect(validateManifest(manifest({})).ok).toBe(true);
    expect(validateManifest(null).ok).toBe(false);
    expect(validateManifest(manifest({ format: "OTHER" as any })).status).toBe("incompatible");
    expect(validateManifest(manifest({ manifestVersion: 99 })).status).toBe("incompatible");
    expect(validateManifest(manifest({ sha256: "zz" })).status).toBe("corrupt");
    expect(validateManifest(manifest({ sizeBytes: 0 })).status).toBe("corrupt");
    expect(validateManifest(manifest({ databaseMagic: "PK\x03\x04" as any })).status).toBe("corrupt");
    expect(validateManifest(manifest({ backupId: "../../etc/passwd" })).status).toBe("corrupt");
    expect(validateManifest(manifest({ counts: { custom_invoices: -5 } })).status).toBe("corrupt");
  });

  it("marks a hash mismatch as corrupt, and a future schema as incompatible", () => {
    const base = {
      fileName: "ta-backup-x.tabk",
      uri: "file:///x",
      sizeBytes: 10,
      modifiedAt: 0,
      currentSchema: 1,
      sealed: false,
    };
    const good = evaluateBackupFile({ ...base, manifest: manifest({}), payloadSha256: "a".repeat(64), quickCheckOk: true });
    expect(good.status).toBe("verified");

    const hashMismatch = evaluateBackupFile({ ...base, manifest: manifest({}), payloadSha256: "b".repeat(64), quickCheckOk: true });
    expect(hashMismatch.status).toBe("corrupt");

    const future = evaluateBackupFile({ ...base, manifest: manifest({ databaseSchemaVersion: 7 }), payloadSha256: "a".repeat(64), quickCheckOk: true });
    expect(future.status).toBe("incompatible");

    const failedCheck = evaluateBackupFile({ ...base, manifest: manifest({}), payloadSha256: "a".repeat(64), quickCheckOk: false });
    expect(failedCheck.status).toBe("corrupt");

    // Missing payloadSha256 must NEVER be marked verified (SEC-13)
    const unverifiedHash = evaluateBackupFile({ ...base, manifest: manifest({}), payloadSha256: null, quickCheckOk: true });
    expect(unverifiedHash.status).toBe("unreadable");
    expect(unverifiedHash.sha256Ok).toBe(false);
  });

  it("only maps schemas the running build understands", () => {
    expect(isSchemaCompatible(1, 1)).toBe(true);
    expect(isSchemaCompatible(1, 3)).toBe(true);
    expect(isSchemaCompatible(4, 3)).toBe(false);
    expect(isSchemaCompatible(0, 3)).toBe(false);
  });

  it("refuses a backup when free space is below snapshot + margin", () => {
    expect(hasStorageHeadroom(1000, 10_000).ok).toBe(false);
    expect(hasStorageHeadroom(100 * 1024 * 1024, 10_000).ok).toBe(true);
  });
});

describe("Protection assessment", () => {
  const storage: StorageInfo = {
    state: "ok",
    folderUri: "content://tree/x",
    folderLabel: "f",
    totalBytes: -1,
    freeBytes: 1e9,
    appDataBytes: 0,
    backupBytes: 0,
    backupCount: 1,
  };
  const now = Date.parse("2026-11-11T10:00:00.000Z");
  const settings = { ...DEFAULT_BACKUP_SETTINGS };

  it("reports unprotected when no folder is selected", () => {
    const r = assessProtection({ storage: { ...storage, state: "folder-not-selected" }, backups: [], settings, databaseInvoiceCount: 0, now });
    expect(r.status).toBe("unprotected");
    expect(r.reason).toContain("مجلد");
  });

  it("reports unprotected when the permission was lost", () => {
    const r = assessProtection({ storage: { ...storage, state: "permission-lost" }, backups: [], settings, databaseInvoiceCount: 3, now });
    expect(r.status).toBe("unprotected");
  });

  it("reports unproven when the newest backup has fewer invoices than the device", () => {
    const files = [file("daily", "2026-11-11T09:00:00.000Z", "b")]; // 3 invoices
    const r = assessProtection({ storage, backups: files, settings, databaseInvoiceCount: 10, now });
    expect(r.status).toBe("unproven");
    expect(r.reason).toContain("10");
  });

  it("reports stale after the configured age and protected otherwise", () => {
    const fresh = [file("daily", "2026-11-11T08:00:00.000Z", "fresh")];
    expect(assessProtection({ storage, backups: fresh, settings, databaseInvoiceCount: 3, now }).status).toBe("protected");

    const old = [file("daily", "2026-11-01T08:00:00.000Z", "old")];
    expect(assessProtection({ storage, backups: old, settings, databaseInvoiceCount: 3, now }).status).toBe("stale");
  });

  it("reports outdated after a failed last run", () => {
    const files = [file("daily", "2026-11-11T09:30:00.000Z", "b")];
    const r = assessProtection({
      storage,
      backups: files,
      settings: { ...settings, lastBackupStatus: "failed", lastBackupAt: "2026-11-11T09:45:00.000Z", lastBackupMessage: "disk full" },
      databaseInvoiceCount: 3,
      now,
    });
    expect(r.status).toBe("outdated");
    expect(r.reason).toContain("disk full");
  });

  it("transitions to unproven when non-invoice business records (customers/letters/payments) or lastDataChangeAt outpace the newest backup", () => {
    const files: BackupFileInfo[] = [
      {
        ...file("daily", "2026-11-11T08:00:00.000Z", "synced"),
        manifest: manifest({
          backupId: "synced",
          createdAt: "2026-11-11T08:00:00.000Z",
          invoiceCount: 3,
          totalBusinessRecords: 6,
          counts: { custom_invoices: 3, customers: 2, official_letters: 1 },
        }),
      },
    ];
    expect(
      assessProtection({ storage, backups: files, settings, databaseInvoiceCount: 3, databaseBusinessRecordCount: 6, now }).status
    ).toBe("protected");

    // Adding 1 official letter (still 3 invoices, now 7 business records) -> unproven
    const addedLetter = assessProtection({
      storage,
      backups: files,
      settings,
      databaseInvoiceCount: 3,
      databaseBusinessRecordCount: 7,
      now,
    });
    expect(addedLetter.status).toBe("unproven");
    expect(addedLetter.reason).toContain("7");

    // In-place edit (same counts, newer lastDataChangeAt) -> unproven
    const edited = assessProtection({
      storage,
      backups: files,
      settings: { ...settings, lastDataChangeAt: "2026-11-11T08:05:00.000Z" },
      databaseInvoiceCount: 3,
      databaseBusinessRecordCount: 6,
      now,
    });
    expect(edited.status).toBe("unproven");

    // Newer native WorkManager failure overrides stale settings "ok"
    const nativeFail = assessProtection({
      storage,
      backups: files,
      settings: { ...settings, lastBackupStatus: "ok", lastBackupAt: "2026-11-11T08:00:00.000Z" },
      databaseInvoiceCount: 3,
      databaseBusinessRecordCount: 6,
      nativeLastBackupAt: "2026-11-11T09:00:00.000Z",
      nativeLastBackupStatus: "failed",
      nativeLastBackupMessage: "permission denied",
      now,
    });
    expect(nativeFail.status).toBe("outdated");
    expect(nativeFail.reason).toContain("permission denied");
  });
});
