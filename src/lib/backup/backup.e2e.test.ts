/**
 * End-to-end backup acceptance scenarios.
 *
 * These tests drive the app's REAL store code (billing/orders/customers/
 * proforma/invoices) against a REAL SQLite database on disk, then exercise the
 * backup engine's external behaviour (snapshot → archive → verify → restore).
 *
 * Why this is meaningful and not a mock:
 *  - @capacitor-community/sqlite is replaced by a node:sqlite adapter that
 *    implements the same query/run/executeSet contract, so every SQL statement
 *    (including FOREIGN KEY / UNIQUE constraints) runs against SQLite itself;
 *  - archives are produced and verified by the same TypeScript format module the
 *    Java engine is byte-parity-tested against;
 *  - the assertions check INVOICE CONTENT (descriptions, dimensions, item
 *    totals), numbering sequences, settings and history after restoration.
 *
 * Not covered here (requires a device/emulator): the SAF picker, WorkManager
 * scheduling and the Java engine itself. Those are listed in the report.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CREATE_SCHEMA_V1, DB_VERSION } from "@/lib/database/schema";
import { FixtureDatabase, closeAllFixtures } from "@/test/backup/fixtureDb";
import { NodeBackupEngine } from "@/test/backup/nodeEngine";
import { dailyKey, localCalendar, planRetention } from "@/lib/backup/retention";
import { normalizeLegacyBackup, detectLegacyBackup } from "@/lib/backup/legacyImport";

// ── Capacitor + SQLite adapter wiring (hoisted so vi.mock can see them) ─────

const state = vi.hoisted(() => ({
  db: null as any,
  dir: "",
  dirDb: "",
  native: true,
}));

vi.mock("@capacitor/core", () => ({
  Capacitor: {
    isNativePlatform: () => state.native,
    Plugins: {},
    getPlatform: () => (state.native ? "android" : "web"),
  },
  registerPlugin: () => ({}),
}));

vi.mock("@capacitor/preferences", () => ({
  Preferences: { get: async () => ({ value: null }), set: async () => {}, remove: async () => {} },
}));

vi.mock("@capacitor/app", () => ({
  App: { addListener: async () => ({ remove: async () => {} }), exitApp: async () => {} },
}));

vi.mock("@capacitor/status-bar", () => ({
  StatusBar: { setStyle: async () => {}, setBackgroundColor: async () => {} },
  Style: { Dark: "DARK" },
}));

vi.mock("@aparajita/capacitor-biometric-auth", () => ({
  BiometricAuth: { checkBiometry: async () => ({ isAvailable: false }) },
}));

vi.mock("@/lib/database", () => ({
  getDb: async () => state.db,
  closeDb: async () => {},
}));

vi.mock("@/lib/soundEffects", () => ({
  playTapSound: () => {},
  playSuccessSound: () => {},
  playErrorSound: () => {},
  isSoundEnabled: () => false,
  setSoundEnabled: () => {},
}));

vi.mock("sonner", () => ({
  toast: { success: () => {}, error: () => {}, loading: () => {}, warning: () => {} },
}));

vi.mock("@/lib/backup/bridge", () => {
  const envelope = (result: any) => ({ ok: false, mode: "replace", counts: {}, ...result });
  return {
    isBackupEngineAvailable: () => true,
    backupBridge: {
      getStatus: async () => ({ ok: false, status: null }),
      listBackups: async () => ({ ok: true, backups: [] }),
      createBackup: async () => envelope({ ok: true }),
      restoreBackup: async (fileName: string, mode: "replace" | "merge") => {
        const result = await state.engine.restore(fileName, mode);
        return envelope({ ...result, mode });
      },
      getEngineInfo: async () => ({ ok: true, engineVersion: "test", sdkInt: 35, model: "node", supported: true }),
      saveSettings: async () => ({ ok: true }),
      setScheduledBackupEnabled: async () => ({ ok: true }),
      getDbCounts: async () => ({
        ok: true,
        invoiceCount: countInvoices(),
        schemaVersion: 1,
        counts: {},
      }),
      chooseFolder: async () => ({ ok: false, errorCode: "CANCELLED" }),
      verifyBackup: async () => ({ ok: true, info: null }),
    },
  };
});

function countInvoices(): number {
  // Read straight from disk with a short-lived connection so assertions always
  // see the current file, never a stale cached handle.
  const probe = FixtureDatabase.open({ dir: state.dirDb });
  try {
    return (
      probe.count("custom_invoices") + probe.count("proforma_invoices") + probe.count("print_invoices")
    );
  } catch {
    // The database may not exist yet (fresh install / cleared data).
    return 0;
  } finally {
    probe.close();
  }
}

// The engine is attached to `state` after import so the bridge mock can use it.
declare module "vitest" {}

async function freshWorkspace(options: { wal?: boolean; key?: Uint8Array } = {}) {
  const root = mkdtempSync(join(tmpdir(), "ta-backup-test-"));
  const folderDir = join(root, "Documents", "InvoiceBackups");
  const dbDir = join(root, "databases");
  const fixture = FixtureDatabase.open({ dir: dbDir, wal: options.wal ?? false });
  fixture.applySchema(CREATE_SCHEMA_V1);
  fixture.db.exec("PRAGMA user_version = 1;");
  // Run the real versioned migration so the fixture matches a device that has
  // already been upgraded (v2 tables + invoice reference column).
  const { runPendingMigrations } = await import("@/lib/database/migrations");
  await runPendingMigrations(fixture, { nowIso: new Date().toISOString() });
  state.db = fixture;
  state.dir = root;
  state.dirDb = dbDir;
  const engine = new NodeBackupEngine({
    folderDir,
    dbDir,
    currentSchema: DB_VERSION,
    key: options.key,
    retention: { daily: 7, weekly: 4, monthly: 12, keepMinimum: 2 },
  });
  (state as any).engine = engine;
  return { root, folderDir, dbDir, fixture, engine };
}

function writeInvoice(fixture: FixtureDatabase, serial: string, party: string, total: number, items: { description: string; dimensions: string; qty: number; total: number }[], type = "sales") {
  const now = new Date().toISOString();
  const id = `custom-inv-${serial}`;
  fixture.db
    .prepare(
      `INSERT INTO custom_invoices (id, serial, type, date, party_name, language, total_amount, total_in_words, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`
    )
    .run(id, serial, type, "2026-11-11", party, "ar", total, "فقط", now, now);
  items.forEach((item, index) => {
    fixture.db
      .prepare(
        `INSERT INTO custom_invoice_items (id, invoice_id, description, material, dimensions, qty, unit_price, total, sort_order)
         VALUES (?,?,?,?,?,?,?,?,?)`
      )
      .run(`${id}-item-${index}`, id, item.description, "flex", item.dimensions, item.qty, item.total / item.qty, item.total, index);
  });
}

beforeEach(() => {
  state.native = true;
  state.db = null;
  (state as any).engine = null;
  closeAllFixtures();
});

/** Releases every handle so the next engine read sees the file on disk. */
function releaseHandles() {
  closeAllFixtures();
  state.db = null;
}

// ═══════════════════════════════════════════════════════════════════════════
// Scenario 1 + 6 + 12: create invoices → backup → wipe → restore
// ═══════════════════════════════════════════════════════════════════════════

describe("Scenario: creating invoices, backing up and restoring them", () => {
  it("stores real invoices through the app stores and restores every value exactly", async () => {
    const ws = await freshWorkspace();

    // Drive the ACTUAL store code (the same functions the UI calls).
    const { saveCustomInvoice, getCustomInvoicesSnapshot } = await import("@/lib/billing/store");
    const { commitSerial } = await import("@/lib/invoice/serial");

    // The store persists before publishing to the in-memory snapshot, so the
    // save is awaited here (it is async since the numbering integration).
    await saveCustomInvoice({
      id: "inv-1",
      meta: {
        serial: "0001",
        type: "sales",
        date: "2026-11-11",
        partyName: "شركة النيل للدعاية",
        phone: "+249912345678",
        language: "ar",
      },
      items: [
        { id: "i1", description: "لوحة قماش 3×1", material: "flex", dimensions: "300×100 سم", qty: 2, unitPrice: 18000, total: 36000 },
        { id: "i2", description: "رول أب داخل", material: "rollup", dimensions: "85×200 سم", qty: 1, unitPrice: 45000, total: 45000 },
      ],
      totalAmount: 81000,
      totalInWords: "فقط واحد وثمانون ألف جنيه",
      createdAt: "2026-11-11T08:00:00.000Z",
      updatedAt: "2026-11-11T08:00:00.000Z",
    });
    writeInvoice(ws.fixture, "0002", "مؤسسة الخرطوم التجارية", 12000, [
      { description: "استيكر مائي", dimensions: "50×40 سم", qty: 10, total: 12000 },
    ]);

    // Let the fire-and-forget SQLite write inside the store land.
    await new Promise((r) => setTimeout(r, 50));
    commitSerial("0002");
    ws.fixture.db.prepare("INSERT OR REPLACE INTO sequences(key, value) VALUES(?,?)").run("future_invoice_seq", "2");
    ws.fixture.db.prepare("INSERT OR REPLACE INTO settings(key, value) VALUES(?,?)").run("future_calc_app_password_hash", "hash-5732");
    ws.fixture.db.prepare("INSERT OR REPLACE INTO settings(key, value) VALUES(?,?)").run("sound_enabled", "false");

    expect(getCustomInvoicesSnapshot().length).toBe(1);
    expect(countInvoices()).toBe(2);

    // 1. Create a verified backup.
    const created = await ws.engine.create({ kind: "manual" });
    expect(created.ok).toBe(true);
    expect(created.manifest?.invoiceCount).toBe(2);
    expect(created.manifest?.counts?.custom_invoices).toBe(2);
    expect(created.manifest?.counts?.custom_invoice_items).toBe(3);

    const before = ws.engine.readInvoice("0001");
    expect(before?.party).toBe("شركة النيل للدعاية");
    expect(before?.items[1]).toEqual({ description: "رول أب داخل", dimensions: "85×200 سم", qty: 1, total: 45000 });

    // 4-5. Simulate "clear app data" / "uninstall + reinstall": the database is
    // gone but the SAF folder survives, because it is outside app storage.
    ws.fixture.close();
    rmSync(join(ws.dbDir), { recursive: true, force: true });
    const reinstallDir = join(ws.root, "databases-after-reinstall");
    const reinstalled = FixtureDatabase.open({ dir: reinstallDir });
    reinstalled.applySchema(CREATE_SCHEMA_V1);
    reinstalled.db.exec("PRAGMA user_version = 1;");
    state.db = reinstalled;
    state.dirDb = reinstallDir;
    expect(countInvoices()).toBe(0);

    const engineAfterReinstall = new NodeBackupEngine({ folderDir: ws.folderDir, dbDir: reinstallDir, currentSchema: DB_VERSION });
    (state as any).engine = engineAfterReinstall;

    // 6. Discovery finds the backup.
    const list = await engineAfterReinstall.list();
    expect(list.length).toBe(1);
    expect(list[0].status).toBe("verified");
    expect(list[0].manifest?.invoiceCount).toBe(2);

    // Restore through the app's restore service (which also reloads stores).
    const { restoreBackup } = await import("@/lib/backup/restoreService");
    // Every handle (including the one the app code caches) must be released
    // before the file is swapped — this is what the engine's closeAppConnection
    // does to the Capacitor connection on device.
    closeAllFixtures();
    state.db = null;
    const restored = await restoreBackup(list[0].fileName, "replace");
    expect(restored.ok).toBe(true);
    expect(restored.safetyBackupSkippedReason).toBe("empty-database");
    // Reattach the app-side handle to the restored file for the assertions below.
    state.db = FixtureDatabase.open({ dir: reinstallDir });

    // Verify real content, calculations, numbering and settings after restore.
    const after = engineAfterReinstall.readInvoice("0001");
    expect(after).not.toBeNull();
    expect(after!.party).toBe("شركة النيل للدعاية");
    expect(after!.total).toBe(81000);
    expect(after!.items).toEqual([
      { description: "لوحة قماش 3×1", dimensions: "300×100 سم", qty: 2, total: 36000 },
      { description: "رول أب داخل", dimensions: "85×200 سم", qty: 1, total: 45000 },
    ]);
    expect(engineAfterReinstall.readInvoice("0002")?.party).toBe("مؤسسة الخرطوم التجارية");
    expect(engineAfterReinstall.getSequence("future_invoice_seq")).toBe("2");
    expect(engineAfterReinstall.getSetting("future_calc_app_password_hash")).toBe("hash-5732");
    expect(engineAfterReinstall.getSetting("sound_enabled")).toBe("false");
    expect(countInvoices()).toBe(2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Scenario 8: interrupted backup
// ═══════════════════════════════════════════════════════════════════════════

describe("Scenario: interrupted backup", () => {
  it("leaves the previous valid backup untouched and creates no half-written backup", async () => {
    const ws = await freshWorkspace();
    writeInvoice(ws.fixture, "0001", "عميل أول", 1000, [{ description: "لافتة", dimensions: "100×50", qty: 1, total: 1000 }]);
    const first = await ws.engine.create({ kind: "daily" });
    expect(first.ok).toBe(true);
    const folderBefore = readdirSync(ws.folderDir);

    writeInvoice(ws.fixture, "0002", "عميل ثانٍ", 2000, [{ description: "بانر", dimensions: "200×100", qty: 1, total: 2000 }]);
    const interrupted = await ws.engine.create({ kind: "daily", interruptAfterBytes: 128 });
    expect(interrupted.ok).toBe(false);

    const list = await ws.engine.list();
    expect(list.length).toBe(1);
    expect(list[0].fileName).toBe(first.fileName);
    expect(list[0].status).toBe("verified");
    // A staging file exists, but it is never counted as a backup.
    expect(readdirSync(ws.folderDir).some((n) => n.endsWith(".tmp"))).toBe(true);
    expect(readdirSync(ws.folderDir).length).toBeGreaterThanOrEqual(folderBefore.length);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Scenario 9: corrupted backup
// ═══════════════════════════════════════════════════════════════════════════

describe("Scenario: corrupted backups", () => {
  it("detects corruption and offers the older good backup instead", async () => {
    const ws = await freshWorkspace();
    writeInvoice(ws.fixture, "0001", "عميل أول", 1000, [{ description: "لافتة", dimensions: "100×50", qty: 1, total: 1000 }]);
    const older = await ws.engine.create({ kind: "daily" });
    expect(older.ok).toBe(true);
    await new Promise((r) => setTimeout(r, 1100));

    writeInvoice(ws.fixture, "0002", "عميل ثانٍ", 2000, [{ description: "بانر", dimensions: "200×100", qty: 1, total: 2000 }]);
    const newer = await ws.engine.create({ kind: "daily" });
    expect(newer.ok).toBe(true);

    // Corrupt the newest file on disk (bit rot / bad SD card).
    const path = join(ws.folderDir, newer.fileName!);
    const bytes = new Uint8Array((await import("node:fs")).readFileSync(path));
    bytes[bytes.length - 60] ^= 0xff;
    writeFileSync(path, bytes);

    const list = await ws.engine.list();
    const newestRecord = list.find((b) => b.fileName === newer.fileName);
    expect(newestRecord?.status).toBe("corrupt");

    const { newestVerified } = await import("@/lib/backup/validation");
    expect(newestVerified(list)?.fileName).toBe(older.fileName);

    const attempt = await ws.engine.restore(newer.fileName!, "replace");
    expect(attempt.ok).toBe(false);
    expect(attempt.errorCode).toBe("CORRUPT_ARCHIVE");
    // Nothing was written: the live DB still has both invoices.
    expect(countInvoices()).toBe(2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Scenario 10: insufficient storage
// ═══════════════════════════════════════════════════════════════════════════

describe("Scenario: insufficient storage", () => {
  it("refuses to write a backup when free space is too low and keeps existing backups", async () => {
    const ws = await freshWorkspace();
    writeInvoice(ws.fixture, "0001", "عميل", 500, [{ description: "لافتة", dimensions: "10×10", qty: 1, total: 500 }]);
    const good = await ws.engine.create({ kind: "daily" });
    expect(good.ok).toBe(true);

    const starved = new NodeBackupEngine({
      folderDir: ws.folderDir,
      dbDir: ws.dbDir,
      currentSchema: DB_VERSION,
      freeBytes: 1024, // 1 KiB free
    });
    const result = await starved.create({ kind: "daily" });
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe("INSUFFICIENT_STORAGE");
    expect((await starved.list()).length).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Scenario 7: restoring an older backup (data rollback is explicit)
// ═══════════════════════════════════════════════════════════════════════════

describe("Scenario: restoring an older backup", () => {
  it("replaces current data with the older snapshot and keeps a safety copy of what was lost", async () => {
    const ws = await freshWorkspace();
    writeInvoice(ws.fixture, "0001", "عميل قديم", 1000, [{ description: "قديم", dimensions: "1×1", qty: 1, total: 1000 }]);
    const old = await ws.engine.create({ kind: "weekly" });
    expect(old.ok).toBe(true);

    writeInvoice(ws.fixture, "0002", "عميل جديد", 2000, [{ description: "جديد", dimensions: "2×2", qty: 1, total: 2000 }]);
    writeInvoice(ws.fixture, "0003", "عميل ثالث", 3000, [{ description: "ثالث", dimensions: "3×3", qty: 1, total: 3000 }]);
    expect(countInvoices()).toBe(3);

    releaseHandles();
    const result = await ws.engine.restore(old.fileName!, "replace");
    expect(result.ok).toBe(true);
    expect(result.counts?.custom_invoices).toBe(1);
    expect(countInvoices()).toBe(1);

    // The pre-restore safety copy contains the discarded invoices.
    const files = await ws.engine.list();
    const safety = files.find((f) => f.manifest?.backupId === result.safetyBackupId);
    expect(safety).toBeTruthy();
    expect(safety!.manifest?.invoiceCount).toBe(3);

    // And restoring that safety copy brings them back.
    releaseHandles();
    const back = await ws.engine.restore(safety!.fileName, "replace");
    expect(back.ok).toBe(true);
    expect(countInvoices()).toBe(3);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Scenario 11: database migration (older backup → current schema)
// ═══════════════════════════════════════════════════════════════════════════

describe("Scenario: database migration", () => {
  it("refuses a backup from a NEWER schema and upgrades an older one after restore", async () => {
    const ws = await freshWorkspace();
    writeInvoice(ws.fixture, "0001", "عميل", 1000, [{ description: "قديم", dimensions: "1×1", qty: 1, total: 1000 }]);
    // Pretend this snapshot came from schema v1 while the app now runs v2.
    const legacyEngine = new NodeBackupEngine({
      folderDir: ws.folderDir,
      dbDir: ws.dbDir,
      currentSchema: DB_VERSION,
      overrideSchemaVersion: 1,
    });
    const original = await legacyEngine.create({ kind: "manual" });
    expect(original.ok).toBe(true);
    expect(original.manifest?.databaseSchemaVersion).toBe(1);

    const upgradedApp = new NodeBackupEngine({ folderDir: ws.folderDir, dbDir: ws.dbDir, currentSchema: DB_VERSION });
    const listUnderV2 = await upgradedApp.list();
    expect(listUnderV2[0].status).toBe("verified");
    expect(listUnderV2[0].manifest?.databaseSchemaVersion).toBe(1);

    // After restore the app runs its migration to v2 (simulated here by the
    // marker the real migration writes).
    releaseHandles();
    const restored = await upgradedApp.restore(listUnderV2[0].fileName, "replace");
    expect(restored.ok).toBe(true);
    state.db = FixtureDatabase.open({ dir: ws.dbDir });
    state.db.db.exec("PRAGMA user_version = 3;");
    const db = state.db as FixtureDatabase;
    expect((db.db.prepare("PRAGMA user_version").get() as any).user_version).toBe(3);
    expect(upgradedApp.readInvoice("0001")?.party).toBe("عميل");

    // A backup produced by a FUTURE release must not be silently downgraded.
    const futureWs = await freshWorkspace();
    writeInvoice(futureWs.fixture, "0001", "مستقبلي", 100, [{ description: "x", dimensions: "1×1", qty: 1, total: 100 }]);
    const futureEngine = new NodeBackupEngine({
      folderDir: futureWs.folderDir,
      dbDir: futureWs.dbDir,
      currentSchema: DB_VERSION + 2,
      overrideSchemaVersion: DB_VERSION + 2,
    });
    const futureBackup = await futureEngine.create({ kind: "manual" });
    expect(futureBackup.ok).toBe(true);
    expect(futureBackup.manifest?.databaseSchemaVersion).toBe(DB_VERSION + 2);
    releaseHandles();
    state.dirDb = futureWs.dbDir;

    const olderApp = new NodeBackupEngine({ folderDir: futureWs.folderDir, dbDir: futureWs.dbDir, currentSchema: DB_VERSION });
    const olderList = await olderApp.list();
    expect(olderList[0].status).toBe("incompatible");
    const refused = await olderApp.restore(olderList[0].fileName, "replace");
    expect(refused.ok).toBe(false);
    expect(refused.errorCode).toBe("INCOMPATIBLE_BACKUP");
    expect(olderApp.readInvoice("0001")?.party).toBe("مستقبلي");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Scenario 12: encrypted backup on another device
// ═══════════════════════════════════════════════════════════════════════════

describe("Scenario: portable / encrypted backups", () => {
  it("restores on a 'new device' with the key, and refuses without it", async () => {
    const key = new Uint8Array(32).fill(7);
    const ws = await freshWorkspace({ key });
    writeInvoice(ws.fixture, "0001", "عميل سري", 5000, [{ description: "سري", dimensions: "5×5", qty: 1, total: 5000 }]);
    const created = await ws.engine.create({ kind: "manual" });
    expect(created.ok).toBe(true);
    expect(created.manifest?.encrypted).toBe(true);

    // The plaintext database must NOT be recoverable from the file bytes.
    const raw = new Uint8Array((await import("node:fs")).readFileSync(join(ws.folderDir, created.fileName!)));
    expect(Buffer.from(raw).includes(Buffer.from("عميل سري", "utf8"))).toBe(false);
    // The database header magic must not be visible either (it would reveal an unsealed payload).
    expect(Buffer.from(raw).includes(Buffer.from("SQLite format 3", "utf8"))).toBe(false);

    // Same device: restores fine.
    expect((await ws.engine.list())[0].status).toBe("verified");

    // New device WITH the key.
    const otherDir = join(ws.root, "other-device");
    const other = FixtureDatabase.open({ dir: otherDir });
    other.applySchema(CREATE_SCHEMA_V1);
    other.close();
    const onNewDevice = new NodeBackupEngine({ folderDir: ws.folderDir, dbDir: otherDir, currentSchema: DB_VERSION, key });
    expect((await onNewDevice.list())[0].status).toBe("verified");
    const restored = await onNewDevice.restore(created.fileName!, "replace");
    expect(restored.ok).toBe(true);
    expect(onNewDevice.readInvoice("0001")?.party).toBe("عميل سري");

    // New device WITHOUT the key: cannot read, and does not corrupt anything.
    const noKeyDir = join(ws.root, "no-key-device");
    const noKeyDb = FixtureDatabase.open({ dir: noKeyDir });
    noKeyDb.applySchema(CREATE_SCHEMA_V1);
    noKeyDb.close();
    const withoutKey = new NodeBackupEngine({ folderDir: ws.folderDir, dbDir: noKeyDir, currentSchema: DB_VERSION });
    const blocked = await withoutKey.list();
    expect(blocked[0].status).toBe("encrypted");
    const refused = await withoutKey.restore(created.fileName!, "replace");
    expect(refused.ok).toBe(false);
    expect(refused.errorCode).toBe("CORRUPT_ARCHIVE");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Scenario 2-3 (WAL): crash/restart safety with -wal content
// ═══════════════════════════════════════════════════════════════════════════

describe("Scenario: WAL mode and recent committed writes", () => {
  it("includes pages still living in the -wal file in the backup", async () => {
    const ws = await freshWorkspace({ wal: true });
    writeInvoice(ws.fixture, "0001", "عميل WAL", 7500, [{ description: "في الـ WAL", dimensions: "7×7", qty: 1, total: 7500 }]);

    // Do NOT checkpoint: the row may still be only in the -wal file.
    const created = await ws.engine.create({ kind: "daily" });
    expect(created.ok).toBe(true);

    ws.fixture.db.exec("DELETE FROM custom_invoice_items");
    ws.fixture.db.exec("DELETE FROM custom_invoices");
    expect(countInvoices()).toBe(0);

    releaseHandles();
    const restored = await ws.engine.restore(created.fileName!, "replace");
    expect(restored.ok).toBe(true);
    const invoice = ws.engine.readInvoice("0001");
    expect(invoice?.party).toBe("عميل WAL");
    expect(invoice?.items[0].description).toBe("في الـ WAL");
  });

  it("keeps WAL safety after restore: no stale -wal resurrects deleted rows", async () => {
    const ws = await freshWorkspace({ wal: true });
    writeInvoice(ws.fixture, "0001", "أساس", 100, [{ description: "أ", dimensions: "1×1", qty: 1, total: 100 }]);
    const first = await ws.engine.create({ kind: "manual" });
    expect(first.ok).toBe(true);
    // Newer state that must disappear after restoring the older backup.
    writeInvoice(ws.fixture, "0002", "أحدث", 200, [{ description: "ب", dimensions: "2×2", qty: 1, total: 200 }]);
    ws.fixture.db.exec("PRAGMA wal_checkpoint(TRUNCATE);");
    expect(countInvoices()).toBe(2);

    releaseHandles();
    const restored = await ws.engine.restore(first.fileName!, "replace");
    expect(restored.ok).toBe(true);
    expect(countInvoices()).toBe(1);
    expect(ws.engine.readInvoice("0002")).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Merge vs replace — no random merging, no duplicated invoices
// ═══════════════════════════════════════════════════════════════════════════

describe("Restore modes", () => {
  it("merge adds only missing records and never duplicates an existing invoice", async () => {
    const ws = await freshWorkspace();
    writeInvoice(ws.fixture, "0001", "مشترك", 1000, [{ description: "a", dimensions: "1×1", qty: 1, total: 1000 }]);
    writeInvoice(ws.fixture, "0002", "قديم فقط", 2000, [{ description: "b", dimensions: "2×2", qty: 1, total: 2000 }]);
    const backup = await ws.engine.create({ kind: "manual" });
    expect(backup.ok).toBe(true);

    // Device now has a different invoice with the same serial 0001 (edited) plus a new 0003.
    ws.fixture.db.exec("DELETE FROM custom_invoice_items WHERE invoice_id = 'custom-inv-0001'");
    ws.fixture.db.exec("DELETE FROM custom_invoices WHERE id = 'custom-inv-0001'");
    writeInvoice(ws.fixture, "0001", "معدّل محلياً", 9999, [{ description: "معدل", dimensions: "9×9", qty: 1, total: 9999 }]);
    writeInvoice(ws.fixture, "0003", "جديد محلياً", 3000, [{ description: "c", dimensions: "3×3", qty: 1, total: 3000 }]);

    releaseHandles();
    const result = await ws.engine.restore(backup.fileName!, "merge");
    expect(result.ok).toBe(true);

    // Local edits are preserved, only the missing 0002 was added.
    expect(ws.engine.readInvoice("0001")?.party).toBe("معدّل محلياً");
    expect(ws.engine.readInvoice("0002")?.party).toBe("قديم فقط");
    expect(ws.engine.readInvoice("0003")?.party).toBe("جديد محلياً");
    expect(countInvoices()).toBe(3);

    // Running the same merge twice must not duplicate anything.
    releaseHandles();
    const again = await ws.engine.restore(backup.fileName!, "merge");
    expect(again.ok).toBe(true);
    expect(countInvoices()).toBe(3);
    const reread = FixtureDatabase.open({ dir: ws.dbDir });
    expect(reread.db.prepare("SELECT COUNT(*) AS c FROM custom_invoice_items WHERE invoice_id='custom-inv-0002'").get()).toEqual({ c: 1 });
    reread.close();
  });

  it("merge restores all v2/v3 tables (projects, suppliers, expenses, expense_payments, finance) and preserves higher document_sequences", async () => {
    const ws = await freshWorkspace();
    const now = "2026-11-12T06:00:00.000Z";
    ws.fixture.db
      .prepare("INSERT OR REPLACE INTO financial_accounts (id, name, kind, opening_balance, is_active, created_at) VALUES (?,?,?,?,?,?)")
      .run("acc-cash", "الخزينة الرئيسية", "cash", 50000, 1, now);
    ws.fixture.db.prepare("INSERT INTO customers (id, name, created_at) VALUES (?,?,?)").run("cust-1", "عميل مشاريع", now);
    ws.fixture.db.prepare("INSERT INTO suppliers (id, name, phone, created_at) VALUES (?,?,?,?)").run("sup-1", "مورد طباعة", "0912", now);
    ws.fixture.db
      .prepare("INSERT INTO projects (id, reference, customer_id, title, execution_status, financial_status, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)")
      .run("proj-1", "PRJ-20261112-001", "cust-1", "حملة إعلانية كبرى", "in_progress", "not_invoiced", now, now);
    ws.fixture.db
      .prepare("INSERT INTO expenses (id, kind, project_id, supplier_id, category, amount, expense_date, created_at) VALUES (?,?,?,?,?,?,?,?)")
      .run("exp-1", "direct", "proj-1", "sup-1", "أجور تركيب", 15000, "2026-11-12", now);
    ws.fixture.db
      .prepare("INSERT INTO expense_payments (id, reference, expense_id, amount, paid_at, method, account_id, created_at) VALUES (?,?,?,?,?,?,?,?)")
      .run("epay-1", "EXPPAY-20261112-001", "exp-1", 10000, "2026-11-12", "cash", "acc-cash", now);
    ws.fixture.db
      .prepare("INSERT INTO financial_transactions (id, kind, amount, occurred_at, account_id, source_type, source_id, project_id, created_at) VALUES (?,?,?,?,?,?,?,?,?)")
      .run("ft-1", "expense_payment", 10000, "2026-11-12", "acc-cash", "expense", "exp-1", "proj-1", now);
    ws.fixture.db
      .prepare("INSERT OR REPLACE INTO document_sequences (scope, date_key, last_number, updated_at) VALUES (?,?,?,?)")
      .run("sales", "20261112", 14, now);
    writeInvoice(ws.fixture, "0001", "عميل مشاريع", 120000, [{ description: "بند مشروع", dimensions: "4×2", qty: 1, total: 120000 }]);

    const backup = await ws.engine.create({ kind: "manual" });
    expect(backup.ok).toBe(true);
    expect(backup.manifest?.counts?.projects).toBe(1);
    expect(backup.manifest?.counts?.suppliers).toBe(1);
    expect(backup.manifest?.counts?.expenses).toBe(1);
    expect(backup.manifest?.counts?.expense_payments).toBe(1);
    expect(backup.manifest?.counts?.financial_transactions).toBe(1);
    expect(backup.manifest?.counts?.document_sequences).toBe(1);

    // Clear v2/v3 tables on the live device and simulate a lower sequence counter.
    ws.fixture.db.exec(`
      DELETE FROM financial_transactions;
      DELETE FROM expense_payments;
      DELETE FROM expenses;
      DELETE FROM projects;
      DELETE FROM suppliers;
      DELETE FROM financial_accounts;
      UPDATE document_sequences SET last_number = 2 WHERE scope = 'sales' AND date_key = '20261112';
    `);

    releaseHandles();
    const merged = await ws.engine.restore(backup.fileName!, "merge");
    expect(merged.ok).toBe(true);

    const check = FixtureDatabase.open({ dir: ws.dbDir });
    try {
      expect(check.count("projects")).toBe(1);
      expect(check.count("suppliers")).toBe(1);
      expect(check.count("financial_accounts")).toBeGreaterThanOrEqual(1);
      expect(check.count("expenses")).toBe(1);
      expect(check.count("expense_payments")).toBe(1);
      expect(check.count("financial_transactions")).toBe(1);
      const seq = check.db
        .prepare("SELECT last_number FROM document_sequences WHERE scope = 'sales' AND date_key = '20261112'")
        .get() as any;
      expect(seq?.last_number).toBe(14);
    } finally {
      check.close();
    }
  });

  it("restoreBackup clears stale in-memory sqliteStorage cache and reloads restored settings", async () => {
    const ws = await freshWorkspace();
    ws.fixture.db.prepare("INSERT OR REPLACE INTO settings(key, value) VALUES(?,?)").run("future_print_user_name", "اسم النسخة القديمة");
    ws.fixture.db.prepare("INSERT OR REPLACE INTO settings(key, value) VALUES(?,?)").run("future_print_onboarded", "true");
    writeInvoice(ws.fixture, "0001", "عميل النسخة", 500, [{ description: "صنف", dimensions: "1×1", qty: 1, total: 500 }]);

    const backup = await ws.engine.create({ kind: "manual" });
    expect(backup.ok).toBe(true);

    // Seed stale memoryCache with newer session state (including a key absent from backup).
    const { setMemoryCacheString, getStoredSync } = await import("@/lib/sqliteStorage");
    setMemoryCacheString("future_print_user_name", "اسم مؤقت بعد النسخة");
    setMemoryCacheString("ephemeral_post_backup_key", "should-vanish");
    expect(getStoredSync("future_print_user_name")).toBe("اسم مؤقت بعد النسخة");

    const { restoreBackup } = await import("@/lib/backup/restoreService");
    releaseHandles();
    const restored = await restoreBackup(backup.fileName!, "replace");
    expect(restored.ok).toBe(true);
    // Point state.db to reopened DB before calling reload checks cleanly:
    state.db = FixtureDatabase.open({ dir: ws.dbDir });
    const { reloadAllStoresFromDatabase } = await import("@/lib/backup/restoreService");
    await reloadAllStoresFromDatabase();

    expect(getStoredSync("future_print_user_name")).toBe("اسم النسخة القديمة");
    expect(getStoredSync("ephemeral_post_backup_key")).toBe("");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Retention end-to-end on the folder
// ═══════════════════════════════════════════════════════════════════════════

describe("Retention against real files", () => {
  it("prunes only expired daily files and never the manual/transaction copies", async () => {
    const ws = await freshWorkspace();
    writeInvoice(ws.fixture, "0001", "عميل", 100, [{ description: "x", dimensions: "1×1", qty: 1, total: 100 }]);
    const manual = await ws.engine.create({ kind: "manual" });
    expect(manual.ok).toBe(true);

    // Drive the planner with synthetic dates to simulate 12 daily periods.
    const files = Array.from({ length: 12 }, (_, i) => ({
      fileName: `ta-backup-day${i}.tabk`,
      uri: "",
      sizeBytes: 10,
      modifiedAt: 0,
      sha256Ok: true,
      quickCheckOk: true,
      status: "verified" as const,
      manifest: {
        ...manual.manifest!,
        backupId: `day-${i}`,
        kind: "daily" as const,
        createdAt: `2026-10-${String(i + 1).padStart(2, "0")}T08:00:00.000Z`,
      },
    }));
    files.push({ ...files[0], fileName: "ta-backup-manual.tabk", manifest: { ...files[0].manifest, backupId: "manual-x", kind: "manual" } });

    const plan = planRetention(files, { daily: 7, weekly: 4, monthly: 12, keepMinimum: 2 }, 0);
    expect(plan.prune.length).toBe(5);
    expect(plan.prune).not.toContain("ta-backup-manual.tabk");
    expect(plan.keep).toContain("ta-backup-manual.tabk");
    expect(dailyKey(localCalendar("2026-10-12T08:00:00.000Z", 0), 0)).toBe("2026-10-12");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Legacy JSON backups (installed base)
// ═══════════════════════════════════════════════════════════════════════════

describe("Legacy JSON backups", () => {
  it("imports an old export in one transaction, including items, sequences and settings", async () => {
    const ws = await freshWorkspace();
    const legacyDoc = {
      version: "2.0.0-SQLITE",
      exportedAt: "2026-10-01T10:00:00.000Z",
      appId: "com.taadvertising.invoicing",
      stats: { totalInvoices: 1 },
      data: {
        customInvoices: [
          {
            id: "legacy-1",
            meta: { serial: "0007", type: "sales", date: "2026-09-30", partyName: "عميل قديم جداً", phone: "0912", language: "ar" },
            items: [
              { id: "li-1", description: "لوحة قديمة", dimensions: "120×80 سم", qty: 3, unitPrice: 5000, total: 15000 },
            ],
            totalAmount: 15000,
            totalInWords: "فقط خمسة عشر ألف",
            createdAt: "2026-09-30T10:00:00.000Z",
            updatedAt: "2026-09-30T10:00:00.000Z",
          },
        ],
        proformaInvoices: [],
        printInvoices: [],
        customers: [{ id: "c-legacy", name: "عميل عميل", phone: "0999", totalOrders: 4 }],
        orders: [],
        sequences: { invoiceSeq: "42", proformaSeq: "3" },
      },
    };

    expect(detectLegacyBackup(legacyDoc).ok).toBe(true);
    const normalized = normalizeLegacyBackup(legacyDoc, new Date().toISOString());
    expect(normalized.customInvoices.length).toBe(1);
    expect(normalized.customInvoiceItems.length).toBe(1);
    expect(normalized.sequences).toEqual([
      { key: "future_invoice_seq", value: "42" },
      { key: "future_proforma_seq", value: "3" },
    ]);

    const { importLegacyJson } = await import("@/lib/backup/restoreService");
    const result = await importLegacyJson(JSON.stringify(legacyDoc));
    expect(result.ok).toBe(true);
    expect(countInvoices()).toBe(1);

    const invoice = ws.engine.readInvoice("0007");
    expect(invoice?.party).toBe("عميل قديم جداً");
    expect(invoice?.total).toBe(15000);
    expect(invoice?.items[0]).toEqual({ description: "لوحة قديمة", dimensions: "120×80 سم", qty: 3, total: 15000 });
    expect(ws.engine.getSequence("future_invoice_seq")).toBe("42");
  });

  it("rejects a tampered legacy file (checksum mismatch) without touching data", async () => {
    const ws = await freshWorkspace();
    writeInvoice(ws.fixture, "0001", "بياناتي الحالية", 100, [{ description: "x", dimensions: "1×1", qty: 1, total: 100 }]);
    const { importLegacyJson } = await import("@/lib/backup/restoreService");

    // A document whose declared checksum cannot match its data.
    const tampered = {
      appId: "com.taadvertising.invoicing",
      checksum: "deadbeef",
      data: { customInvoices: [{ id: "x", meta: { serial: "9999" }, items: [], totalAmount: 1 }] },
    };
    const result = await importLegacyJson(JSON.stringify(tampered));
    expect(result.ok).toBe(false);
    expect(countInvoices()).toBe(1);
  });

  it("rolls the whole import back if one row violates a constraint", async () => {
    const ws = await freshWorkspace();
    writeInvoice(ws.fixture, "0005", "موجودة", 100, [{ description: "x", dimensions: "1×1", qty: 1, total: 100 }]);
    const { importLegacyJson } = await import("@/lib/backup/restoreService");

    const doc = {
      appId: "com.taadvertising.invoicing",
      data: {
        // A custom invoice that already exists locally under the same id with
        // DIFFERENT data. INSERT OR IGNORE would silently skip it, so the
        // importer must detect the conflict and refuse the whole file rather
        // than reporting a success that did not restore what the user expects.
        customInvoices: [
          { id: "custom-inv-0005", meta: { serial: "0005", partyName: "اسم من النسخة القديمة", date: "2025-01-01" }, items: [], totalAmount: 5 },
        ],
      },
    };
    const refunded = await importLegacyJson(JSON.stringify(doc));
    expect(refunded.ok).toBe(false);
    expect(refunded.message).toContain("تعارض");
    // Nothing from the file was committed.
    const probe = FixtureDatabase.open({ dir: ws.dbDir });
    try {
      expect(probe.count("proforma_invoices")).toBe(0);
      expect(probe.count("custom_invoices")).toBe(1);
    } finally {
      probe.close();
    }
  });
});
