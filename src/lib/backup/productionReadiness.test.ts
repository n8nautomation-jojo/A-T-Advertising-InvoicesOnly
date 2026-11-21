/**
 * ═══════════════════════════════════════════════════════════════
 * Production-Readiness End-to-End Verification Suite
 * ═══════════════════════════════════════════════════════════════
 * Real SQLite-backed Vitest tests proving every P0, P1, and P2
 * production requirement for the T.A Advertising Backup Engine:
 *
 *  1. Full Multi-Module Round-Trip (v7 schema + v2 GZIP + AES-256-GCM + Recovery Key cross-device restore)
 *  2. Official Letters v7 Migration + Smart Merge + Pre-Merge UNIQUE Conflict & Parent Guards
 *  3. Corrupt Live Database Disaster Recovery (no deadlock on pre-restore)
 *  4. Auto-Backup Trailing Debounce + App-Pause Flush (no dropped changes inside throttle window)
 *  5. Multi-Module Protection Assessment (customers / official_letters / payments with 0 new invoices)
 *  6. Pre-Update Native Backup Orchestration & Renamed External Archive Import
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CREATE_SCHEMA_V1, DB_VERSION } from "@/lib/database/schema";
import { runPendingMigrations, SCHEMA_VERSION } from "@/lib/database/migrations";
import { parseArchiveV2 } from "@/lib/backup/codec";
import { assessProtection, countBusinessRecords } from "@/lib/backup/validation";
import { DEFAULT_BACKUP_SETTINGS, type StorageInfo } from "@/lib/backup/types";
import { FixtureDatabase, closeAllFixtures } from "@/test/backup/fixtureDb";
import { NodeBackupEngine } from "@/test/backup/nodeEngine";

// ── Hoisted mocks for autoBackup & restoreService orchestration tests ───────

const mockState = vi.hoisted(() => ({
  native: true,
  db: null as any,
  createBackupCalls: [] as { kind: string; options: any }[],
  preparePreUpdateCalls: [] as { appVersion: string; targetSchema: number }[],
  preparePreUpdateDelayMs: 0,
  appStateListeners: [] as ((state: { isActive: boolean }) => void)[],
}));

vi.mock("@capacitor/core", () => ({
  Capacitor: {
    isNativePlatform: () => mockState.native,
    Plugins: { TaBackup: {} },
    getPlatform: () => (mockState.native ? "android" : "web"),
  },
  registerPlugin: () => ({}),
}));

vi.mock("@capacitor/app", () => ({
  App: {
    addListener: async (_event: string, cb: (state: { isActive: boolean }) => void) => {
      mockState.appStateListeners.push(cb);
      return { remove: async () => {} };
    },
  },
}));

vi.mock("@capacitor/preferences", () => ({
  Preferences: { get: async () => ({ value: null }), set: async () => {}, remove: async () => {} },
}));

vi.mock("@/lib/database", () => ({
  getDb: async () => mockState.db,
  closeDb: async () => {},
  withDbWriteLock: async <T>(fn: () => Promise<T>) => fn(),
}));

vi.mock("sonner", () => ({
  toast: { success: () => {}, error: () => {}, loading: () => {}, warning: () => {} },
}));

vi.mock("@/lib/backup/bridge", () => ({
  isBackupEngineAvailable: () => true,
  backupBridge: {
    createBackup: async (kind: string, options: any) => {
      mockState.createBackupCalls.push({ kind, options });
      return {
        ok: true,
        backupId: `mock-${mockState.createBackupCalls.length}`,
        fileName: `ta-backup-mock-${mockState.createBackupCalls.length}.tabk`,
        sizeBytes: 4096,
      };
    },
    preparePreUpdateBackup: async (appVersion: string, targetSchema: number) => {
      mockState.preparePreUpdateCalls.push({ appVersion, targetSchema });
      if (mockState.preparePreUpdateDelayMs > 0) {
        await new Promise((r) => setTimeout(r, mockState.preparePreUpdateDelayMs));
      }
      return {
        ok: true,
        backupId: "pre-update-mock-1",
        fileName: "ta-backup-pre-update-mock-1.tabk",
      };
    },
    setScheduledBackupEnabled: async () => ({ ok: true }),
    saveSettings: async () => ({ ok: true }),
    getEngineInfo: async () => ({ ok: true, engineVersion: "2.0.0", sdkInt: 35, model: "node", supported: true }),
  },
}));

const NOW = "2026-11-20T12:00:00.000Z";
const tempDirs: string[] = [];

async function createV7Workspace(options: { key?: Uint8Array } = {}) {
  const root = mkdtempSync(join(tmpdir(), "ta-prod-ready-"));
  tempDirs.push(root);
  const folderDir = join(root, "Documents", "InvoiceBackups");
  const dbDir = join(root, "databases");
  const fixture = FixtureDatabase.open({ dir: dbDir });
  fixture.applySchema(CREATE_SCHEMA_V1);
  fixture.db.exec("PRAGMA user_version = 1;");
  const migration = await runPendingMigrations(fixture, { nowIso: NOW });
  expect(migration.warnings).toEqual([]);
  expect(migration.to).toBe(SCHEMA_VERSION);
  expect(migration.to).toBe(7);

  const engine = new NodeBackupEngine({
    folderDir,
    dbDir,
    currentSchema: DB_VERSION,
    key: options.key,
    archiveVersion: 2,
    compress: true,
  });

  return { root, folderDir, dbDir, fixture, engine };
}

beforeEach(() => {
  closeAllFixtures();
  mockState.native = true;
  mockState.db = null;
  mockState.createBackupCalls = [];
  mockState.preparePreUpdateCalls = [];
  mockState.preparePreUpdateDelayMs = 0;
  mockState.appStateListeners = [];
});

afterEach(() => {
  vi.useRealTimers();
  closeAllFixtures();
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!;
    rmSync(dir, { recursive: true, force: true });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// 1. Full Multi-Module Round-Trip (v7 + v2 GZIP + AES-256-GCM + Recovery Key)
// ═══════════════════════════════════════════════════════════════════════════

describe("P0: Full Multi-Module v7 Round-Trip with AES-256-GCM & Cross-Device Recovery Key", () => {
  it("backs up ALL modules (SDG/USD invoices, v5 customers, suppliers, v6 multi-currency accounts, payments, expenses, orders, settings, official_letters) and restores 100% on a new device via Recovery Key", async () => {
    const deviceAKey = new Uint8Array(randomBytes(32));
    const ws = await createV7Workspace({ key: deviceAKey });
    const db = ws.fixture.db;

    // 1. Multi-currency Financial Accounts (v6)
    db.prepare(
      `INSERT OR REPLACE INTO financial_accounts (id, name, kind, opening_balance, is_active, notes, created_at, currency)
       VALUES (?,?,?,?,?,?,?,?)`
    ).run("acc-sdg-cash", "خزينة الجنيه الرئيسية", "cash", 250000, 1, "الخزينة اليومية", NOW, "SDG");
    db.prepare(
      `INSERT OR REPLACE INTO financial_accounts (id, name, kind, opening_balance, is_active, notes, created_at, currency)
       VALUES (?,?,?,?,?,?,?,?)`
    ).run("acc-usd-bank", "حساب الدولار التجاري", "bank", 5000, 1, "بنك الخرطوم USD", NOW, "USD");

    // 2. Customers with v5 opening balances & is_archived flag
    db.prepare(
      `INSERT INTO customers (id, name, phone, type, address, notes, total_orders, total_spent, balance, created_at,
         is_archived, opening_balance, opening_balance_currency, opening_balance_date, opening_balance_type, opening_balance_notes)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(
      "cust-active-1", "شركة النيل الذهبي", "+249912340001", "company", "الخرطوم - العمارات", "عميل VIP",
      3, 450000, 150000, NOW, 0, 50000, "SDG", "2026-01-01", "debit", "رصيد افتتاحي منقول"
    );
    db.prepare(
      `INSERT INTO customers (id, name, phone, type, address, notes, total_orders, total_spent, balance, created_at,
         is_archived, opening_balance, opening_balance_currency, opening_balance_date, opening_balance_type, opening_balance_notes)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(
      "cust-archived-2", "مؤسسة الأفق القديم", "+249912340002", "company", "أم درمان", "حساب مؤرشف",
      1, 1200, 0, NOW, 1, 200, "USD", "2026-02-01", "credit", "دفعة مقدمة سابقة"
    );

    // 3. Suppliers
    db.prepare(
      `INSERT INTO suppliers (id, name, phone, email, address, notes, created_at)
       VALUES (?,?,?,?,?,?,?)`
    ).run("sup-1", "مصنع خامات الفلكس", "+249918887777", "flex@supplier.sd", "المنطقة الصناعية", "مورد خامات", NOW);

    // 4. Custom Invoices (SDG Sales + USD Sales + SDG Purchase) & Line Items
    db.prepare(
      `INSERT INTO custom_invoices (id, serial, reference, type, date, party_name, phone, language, currency,
         total_amount, subtotal, discount, total_in_words, customer_id, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(
      "inv-sdg-1", "0001", "26-0001", "sales", "2026-11-18", "شركة النيل الذهبي", "+249912340001",
      "ar", "SDG", 300000, 300000, 0, "ثلاثمائة ألف جنيه", "cust-active-1", NOW, NOW
    );
    db.prepare(
      `INSERT INTO custom_invoice_items (id, invoice_id, description, material, dimensions, qty, unit_price, total, sort_order)
       VALUES (?,?,?,?,?,?,?,?,?)`
    ).run("item-sdg-1", "inv-sdg-1", "لوحة واجهة كلادينج مضيئة", "cladding", "600×150 سم", 1, 300000, 300000, 0);

    db.prepare(
      `INSERT INTO custom_invoices (id, serial, reference, type, date, party_name, phone, language, currency,
         total_amount, subtotal, discount, total_in_words, customer_id, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(
      "inv-usd-1", "0002", "26-0002", "sales", "2026-11-19", "شركة النيل الذهبي", "+249912340001",
      "en", "USD", 1500, 1500, 0, "One Thousand Five Hundred USD", "cust-active-1", NOW, NOW
    );
    db.prepare(
      `INSERT INTO custom_invoice_items (id, invoice_id, description, material, dimensions, qty, unit_price, total, sort_order)
       VALUES (?,?,?,?,?,?,?,?,?)`
    ).run("item-usd-1", "inv-usd-1", "LED Signboard Export", "acrylic", "400×100 cm", 2, 750, 1500, 0);

    db.prepare(
      `INSERT INTO custom_invoices (id, serial, reference, type, date, party_name, phone, language, currency,
         total_amount, subtotal, discount, total_in_words, supplier_id, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(
      "inv-pur-1", "0003", "26-0003", "purchase", "2026-11-19", "مصنع خامات الفلكس", "+249918887777",
      "ar", "SDG", 120000, 120000, 0, "مائة وعشرون ألف جنيه", "sup-1", NOW, NOW
    );
    db.prepare(
      `INSERT INTO custom_invoice_items (id, invoice_id, description, material, dimensions, qty, unit_price, total, sort_order)
       VALUES (?,?,?,?,?,?,?,?,?)`
    ).run("item-pur-1", "inv-pur-1", "رول فلكس 3.2 متر", "flex", "320×5000 سم", 2, 60000, 120000, 0);

    // 5. Proforma & Print Invoices
    db.prepare(
      `INSERT INTO proforma_invoices (id, serial, date, customer_name, currency, total_amount, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?)`
    ).run("prof-1", "PRF-001", "2026-11-18", "شركة النيل الذهبي", "SDG", 95000, NOW, NOW);
    db.prepare(
      `INSERT INTO proforma_lines (id, proforma_id, description, width, height, qty, area, unit_price, total, sort_order)
       VALUES (?,?,?,?,?,?,?,?,?,?)`
    ).run("pl-1", "prof-1", "بانر ترويجي", 3, 2, 5, 30, 3166.67, 95000, 0);

    db.prepare(
      `INSERT INTO print_invoices (id, serial, date, customer_name, total, paid_amount, payment_status, currency, created_at)
       VALUES (?,?,?,?,?,?,?,?,?)`
    ).run("prn-1", "PRN-001", "2026-11-18", "عميل مباشر", 25000, 25000, "paid", "SDG", NOW);
    db.prepare(
      `INSERT INTO print_invoice_lines (id, invoice_id, description, material, width, height, qty, unit_price, total, sort_order)
       VALUES (?,?,?,?,?,?,?,?,?,?)`
    ).run("prnl-1", "prn-1", "ستيكر نافذة", "vinyl", 2, 1, 2, 6250, 25000, 0);

    // 6. Customer Receipts + Allocations (SDG & USD)
    db.prepare(
      `INSERT INTO customer_payments (id, reference, customer_id, amount, paid_at, method, account_id, notes, created_at, currency)
       VALUES (?,?,?,?,?,?,?,?,?,?)`
    ).run("cpay-1", "REC-20261119-001", "cust-active-1", 200000, "2026-11-19", "cash", "acc-sdg-cash", "دفعة أولى", NOW, "SDG");
    db.prepare(
      `INSERT INTO customer_payment_allocations (id, payment_id, invoice_id, amount, created_at)
       VALUES (?,?,?,?,?)`
    ).run("cpa-1", "cpay-1", "inv-sdg-1", 200000, NOW);

    db.prepare(
      `INSERT INTO customer_payments (id, reference, customer_id, amount, paid_at, method, account_id, notes, created_at, currency)
       VALUES (?,?,?,?,?,?,?,?,?,?)`
    ).run("cpay-2", "REC-20261119-002", "cust-active-1", 1000, "2026-11-19", "bank", "acc-usd-bank", "USD wire", NOW, "USD");
    db.prepare(
      `INSERT INTO customer_payment_allocations (id, payment_id, invoice_id, amount, created_at)
       VALUES (?,?,?,?,?)`
    ).run("cpa-2", "cpay-2", "inv-usd-1", 1000, NOW);

    // 7. Supplier Payments + Allocations
    db.prepare(
      `INSERT INTO supplier_payments (id, reference, supplier_id, amount, paid_at, method, account_id, created_at, currency)
       VALUES (?,?,?,?,?,?,?,?,?)`
    ).run("spay-1", "PAY-20261119-001", "sup-1", 80000, "2026-11-19", "cash", "acc-sdg-cash", NOW, "SDG");
    db.prepare(
      `INSERT INTO supplier_payment_allocations (id, payment_id, invoice_id, amount, created_at)
       VALUES (?,?,?,?,?)`
    ).run("spa-1", "spay-1", "inv-pur-1", 80000, NOW);

    // 8. Expenses + Expense Payments + Financial Transactions
    db.prepare(
      `INSERT INTO expenses (id, kind, supplier_id, beneficiary, category, amount, expense_date, method, account_id, notes, created_at, currency)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run("exp-1", "operating", null, "شركة الكهرباء", "كهرباء ومرافق", 35000, "2026-11-19", "cash", "acc-sdg-cash", "فاتورة نوفمبر", NOW, "SDG");
    db.prepare(
      `INSERT INTO expense_payments (id, reference, expense_id, amount, paid_at, method, account_id, created_at, currency)
       VALUES (?,?,?,?,?,?,?,?,?)`
    ).run("epay-1", "EXP-20261119-001", "exp-1", 35000, "2026-11-19", "cash", "acc-sdg-cash", NOW, "SDG");

    db.prepare(
      `INSERT INTO financial_transactions (id, kind, amount, occurred_at, account_id, source_type, source_id, created_at, currency)
       VALUES (?,?,?,?,?,?,?,?,?)`
    ).run("ft-1", "customer_payment", 200000, "2026-11-19", "acc-sdg-cash", "customer_payment", "cpay-1", NOW, "SDG");
    db.prepare(
      `INSERT INTO financial_transactions (id, kind, amount, occurred_at, account_id, source_type, source_id, created_at, currency)
       VALUES (?,?,?,?,?,?,?,?,?)`
    ).run("ft-2", "customer_payment", 1000, "2026-11-19", "acc-usd-bank", "customer_payment", "cpay-2", NOW, "USD");
    db.prepare(
      `INSERT INTO financial_transactions (id, kind, amount, occurred_at, account_id, source_type, source_id, created_at, currency)
       VALUES (?,?,?,?,?,?,?,?,?)`
    ).run("ft-3", "supplier_payment", -80000, "2026-11-19", "acc-sdg-cash", "supplier_payment", "spay-1", NOW, "SDG");
    db.prepare(
      `INSERT INTO financial_transactions (id, kind, amount, occurred_at, account_id, source_type, source_id, created_at, currency)
       VALUES (?,?,?,?,?,?,?,?,?)`
    ).run("ft-4", "expense_payment", -35000, "2026-11-19", "acc-sdg-cash", "expense", "exp-1", NOW, "SDG");

    // 9. Production Orders + Order Items
    db.prepare(
      `INSERT INTO orders (id, order_number, customer_name, status, priority, created_at, total_area, total_cost, paid_amount, invoice_serial, currency)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`
    ).run("ord-1", "ORD-101", "شركة النيل الذهبي", "in_production", "high", NOW, 9, 300000, 200000, "0001", "SDG");
    db.prepare(
      `INSERT INTO order_items (id, order_id, description, material, width, height, qty, area, unit_price, total, sort_order)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`
    ).run("oi-1", "ord-1", "واجهة كلادينج", "cladding", 6, 1.5, 1, 9, 33333.33, 300000, 0);

    // 10. Company Profile Settings
    const companyProfile = JSON.stringify({
      companyName: "T.A Advertising Solution",
      phone: "+249912345678",
      signatoryName: "طارق عثمان علي",
      city: "الخرطوم",
    });
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?,?)").run("future_user_profile", companyProfile);

    // 11. Official Letters (Arabic & English) in dedicated v7 `official_letters` table
    db.prepare(
      `INSERT INTO official_letters (
         id, reference, language, date, show_letter_title, letter_title,
         recipient_honorific, recipient_name, recipient_title,
         salutation, subject, body, closing_phrase,
         signatory_name, signatory_title,
         include_signature, include_stamp, include_qr, created_at, updated_at
       ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(
      "ltr-ar-1", "TA-2026-001", "ar", "2026-11-19", 1, "خطاب تفويض رسمي",
      "السادة /", "شركة النيل الذهبي", "إدارة المشتريات",
      "السلام عليكم ورحمة الله وبركاته،،،",
      "اعتماد توريد وتركيب لوحات إعلانية",
      "نفيدكم بموافقتنا على تنفيذ الأعمال حسب المواصفات المتفق عليها.",
      "وتفضلوا بقبول فائق الاحترام والتقدير،،،",
      "طارق عثمان علي", "المدير العام",
      1, 1, 1, NOW, NOW
    );
    db.prepare(
      `INSERT INTO official_letters (
         id, reference, language, date, show_letter_title, letter_title,
         recipient_honorific, recipient_name, recipient_title,
         salutation, subject, body, closing_phrase,
         signatory_name, signatory_title,
         include_signature, include_stamp, include_qr, created_at, updated_at
       ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(
      "ltr-en-2", "TA-2026-002", "en", "2026-11-20", 0, "",
      "Messrs.", "Nile Golden Trading Co.", "Procurement Dept.",
      "Dear Sir / Madam,",
      "Confirmation of LED Signboard Delivery",
      "We confirm that the LED signboard order is scheduled for installation.",
      "Yours sincerely,",
      "Tarig Osman Ali", "General Manager",
      1, 1, 0, NOW, NOW
    );

    // Capture live profitability & balance summary BEFORE backup
    const beforeSdgNetCash = (
      db.prepare("SELECT SUM(amount) AS s FROM financial_transactions WHERE account_id = 'acc-sdg-cash'").get() as any
    ).s;
    const beforeUsdNetCash = (
      db.prepare("SELECT SUM(amount) AS s FROM financial_transactions WHERE account_id = 'acc-usd-bank'").get() as any
    ).s;
    expect(beforeSdgNetCash).toBe(85000); // +200k - 80k - 35k
    expect(beforeUsdNetCash).toBe(1000);

    // Backup (v2 compressed + AES-256-GCM encrypted)
    const created = await ws.engine.create({ kind: "manual" });
    expect(created.ok).toBe(true);
    expect(created.manifest?.encrypted).toBe(true);
    expect(created.manifest?.databaseSchemaVersion).toBe(7);
    expect(created.manifest?.invoiceCount).toBe(5); // 3 custom + 1 proforma + 1 print
    expect(created.manifest?.counts?.official_letters).toBe(2);
    expect(created.manifest?.counts?.customers).toBe(2);
    expect(created.manifest?.counts?.suppliers).toBe(1);
    expect(created.manifest?.counts?.customer_payments).toBe(2);
    expect(created.manifest?.counts?.supplier_payments).toBe(1);
    expect(created.manifest?.counts?.expenses).toBe(1);
    expect(created.manifest?.counts?.expense_payments).toBe(1);
    expect(created.manifest?.counts?.orders).toBe(1);
    expect(created.manifest?.totalBusinessRecords).toBe(countBusinessRecords(created.manifest?.counts as Record<string, number>));
    expect(created.manifest?.totalBusinessRecords).toBeGreaterThanOrEqual(16);

    // Inspect raw archive bytes: must be v2 compressed + sealed, with ZERO plaintext leakage
    const rawArchive = new Uint8Array(readFileSync(join(ws.folderDir, created.fileName!)));
    const parsedV2 = parseArchiveV2(rawArchive);
    expect(parsedV2.archiveVersion).toBe(2);
    expect(parsedV2.sealed).toBe(true);
    expect(parsedV2.compressed).toBe(true);
    expect(Buffer.from(rawArchive).includes(Buffer.from("SQLite format 3", "utf8"))).toBe(false);
    expect(Buffer.from(rawArchive).includes(Buffer.from("خطاب تفويض رسمي", "utf8"))).toBe(false);

    // Export Recovery Key from Device A
    const exportedKey = await ws.engine.exportRecoveryKey();
    expect(exportedKey.ok).toBe(true);
    expect(exportedKey.recoveryKey).toMatch(/^TAKEY-/);

    // Wipe & simulate brand-new Device B (empty DB, NO key yet)
    ws.fixture.close();
    const deviceBDir = join(ws.root, "device-b-databases");
    const deviceB = FixtureDatabase.open({ dir: deviceBDir });
    deviceB.applySchema(CREATE_SCHEMA_V1);
    await runPendingMigrations(deviceB, { nowIso: NOW });
    deviceB.close();

    const deviceBEngine = new NodeBackupEngine({
      folderDir: ws.folderDir,
      dbDir: deviceBDir,
      currentSchema: DB_VERSION,
    });

    // Without Recovery Key: backup is listed as "encrypted" and restore is refused
    const lockedList = await deviceBEngine.list();
    expect(lockedList.length).toBe(1);
    expect(lockedList[0].status).toBe("encrypted");
    const blockedRestore = await deviceBEngine.restore(created.fileName!, "replace");
    expect(blockedRestore.ok).toBe(false);

    // Import Recovery Key on Device B -> backup immediately unlocks to "verified"
    const importedKey = await deviceBEngine.importRecoveryKey(exportedKey.recoveryKey!);
    expect(importedKey.ok).toBe(true);
    expect(importedKey.keyId).toBe(exportedKey.keyId);

    const unlockedList = await deviceBEngine.list();
    expect(unlockedList[0].status).toBe("verified");
    expect(unlockedList[0].manifest?.counts?.official_letters).toBe(2);

    // Full Replace Restore on Device B
    const restored = await deviceBEngine.restore(created.fileName!, "replace");
    expect(restored.ok).toBe(true);
    expect(restored.counts?.official_letters).toBe(2);
    expect(restored.counts?.custom_invoices).toBe(3);

    // Verify EVERY SINGLE MODULE 100% on Device B
    const check = FixtureDatabase.open({ dir: deviceBDir });
    try {
      // Invoices & currencies
      const invUsd = check.db.prepare("SELECT * FROM custom_invoices WHERE id = 'inv-usd-1'").get() as any;
      expect(invUsd.currency).toBe("USD");
      expect(invUsd.total_amount).toBe(1500);
      expect(invUsd.reference).toBe("26-0002");

      // Customers (v5 opening balances + archived flag)
      const cust1 = check.db.prepare("SELECT * FROM customers WHERE id = 'cust-active-1'").get() as any;
      expect(cust1.opening_balance).toBe(50000);
      expect(cust1.opening_balance_currency).toBe("SDG");
      expect(cust1.is_archived).toBe(0);
      const cust2 = check.db.prepare("SELECT * FROM customers WHERE id = 'cust-archived-2'").get() as any;
      expect(cust2.is_archived).toBe(1);
      expect(cust2.opening_balance).toBe(200);
      expect(cust2.opening_balance_currency).toBe("USD");
      expect(cust2.opening_balance_type).toBe("credit");

      // Multi-currency accounts & net financial movements
      const sdgAcc = check.db.prepare("SELECT * FROM financial_accounts WHERE id = 'acc-sdg-cash'").get() as any;
      const usdAcc = check.db.prepare("SELECT * FROM financial_accounts WHERE id = 'acc-usd-bank'").get() as any;
      expect(sdgAcc.currency).toBe("SDG");
      expect(sdgAcc.opening_balance).toBe(250000);
      expect(usdAcc.currency).toBe("USD");
      expect(usdAcc.opening_balance).toBe(5000);

      const afterSdgNetCash = (
        check.db.prepare("SELECT SUM(amount) AS s FROM financial_transactions WHERE account_id = 'acc-sdg-cash'").get() as any
      ).s;
      const afterUsdNetCash = (
        check.db.prepare("SELECT SUM(amount) AS s FROM financial_transactions WHERE account_id = 'acc-usd-bank'").get() as any
      ).s;
      expect(afterSdgNetCash).toBe(beforeSdgNetCash);
      expect(afterUsdNetCash).toBe(beforeUsdNetCash);

      // Customer & supplier payment allocations + expenses + orders
      expect(check.count("customer_payment_allocations")).toBe(2);
      expect(check.count("supplier_payment_allocations")).toBe(1);
      expect(check.count("expenses")).toBe(1);
      expect(check.count("expense_payments")).toBe(1);
      expect(check.count("orders")).toBe(1);
      expect(check.count("order_items")).toBe(1);
      expect(check.count("proforma_invoices")).toBe(1);
      expect(check.count("print_invoices")).toBe(1);

      // Official Letters (Arabic & English full content)
      const ltrAr = check.db.prepare("SELECT * FROM official_letters WHERE id = 'ltr-ar-1'").get() as any;
      expect(ltrAr.reference).toBe("TA-2026-001");
      expect(ltrAr.letter_title).toBe("خطاب تفويض رسمي");
      expect(ltrAr.subject).toBe("اعتماد توريد وتركيب لوحات إعلانية");
      expect(ltrAr.include_qr).toBe(1);

      const ltrEn = check.db.prepare("SELECT * FROM official_letters WHERE id = 'ltr-en-2'").get() as any;
      expect(ltrEn.language).toBe("en");
      expect(ltrEn.recipient_name).toBe("Nile Golden Trading Co.");
      expect(ltrEn.include_qr).toBe(0);

      // Company profile setting
      const restoredProfile = (
        check.db.prepare("SELECT value FROM settings WHERE key = 'future_user_profile'").get() as any
      )?.value;
      expect(restoredProfile).toBe(companyProfile);
    } finally {
      check.close();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. Official Letters v7 Migration + Smart Merge + Conflict & Parent Guards
// ═══════════════════════════════════════════════════════════════════════════

describe("P0: Official Letters Migration (v7), Smart Merge, Conflict & Parent Guards", () => {
  it("migrates legacy settings.ta_official_letters_v1 into official_letters and merges additional letters without dropping existing ones", async () => {
    const root = mkdtempSync(join(tmpdir(), "ta-letters-merge-"));
    tempDirs.push(root);
    const folderDir = join(root, "Documents", "InvoiceBackups");
    const dbDir = join(root, "databases");

    // Seed a legacy database with `settings.ta_official_letters_v1` BEFORE running v7 migration
    const fixture = FixtureDatabase.open({ dir: dbDir });
    fixture.applySchema(CREATE_SCHEMA_V1);
    fixture.db.exec("PRAGMA user_version = 1;");
    const legacyLetters = [
      {
        id: "leg-ltr-1",
        reference: "TA-OLD-001",
        language: "ar",
        date: "2026-10-01",
        showLetterTitle: true,
        letterTitle: "شهادة خبرة",
        recipientHonorific: "السادة /",
        recipientName: "بنك السودان",
        salutation: "تحية طيبة",
        subject: "تأكيد تنفيذ أعمال",
        body: "محتوى الخطاب الأول المهاجر من الإعدادات.",
        closingPhrase: "ولكم الشكر",
        signatoryName: "طارق عثمان",
        signatoryTitle: "المدير العام",
        includeSignature: true,
        includeStamp: true,
        includeQr: true,
        createdAt: "2026-10-01T08:00:00.000Z",
        updatedAt: "2026-10-01T08:00:00.000Z",
      },
      {
        id: "leg-ltr-2",
        reference: "TA-OLD-002",
        language: "en",
        date: "2026-10-05",
        recipientName: "Dal Group",
        subject: "Price Revision Notice",
        body: "Legacy English letter content.",
        createdAt: "2026-10-05T09:00:00.000Z",
        updatedAt: "2026-10-05T09:00:00.000Z",
      },
    ];
    fixture.db
      .prepare("INSERT OR REPLACE INTO settings(key, value) VALUES (?, ?)")
      .run("ta_official_letters_v1", JSON.stringify(legacyLetters));

    const outcome = await runPendingMigrations(fixture, { nowIso: NOW });
    expect(outcome.warnings).toEqual([]);
    expect(outcome.to).toBe(7);
    expect(fixture.count("official_letters")).toBe(2);

    const engine = new NodeBackupEngine({ folderDir, dbDir, currentSchema: DB_VERSION });
    const backup = await engine.create({ kind: "manual" });
    expect(backup.ok).toBe(true);
    expect(backup.manifest?.counts?.official_letters).toBe(2);

    // Now simulate local changes: user deleted leg-ltr-2 locally and created a brand-new 3rd letter
    fixture.db.prepare("DELETE FROM official_letters WHERE id = 'leg-ltr-2'").run();
    fixture.db
      .prepare(
        `INSERT INTO official_letters (
           id, reference, language, date, recipient_name, subject, body, created_at, updated_at
         ) VALUES (?,?,?,?,?,?,?,?,?)`
      )
      .run("new-ltr-3", "TA-NEW-003", "ar", "2026-11-20", "شركة زين", "خطاب عرض جديد", "نص الخطاب الثالث", NOW, NOW);
    expect(fixture.count("official_letters")).toBe(2);

    // Merge the backup back: must recover leg-ltr-2 WITHOUT losing leg-ltr-1 or new-ltr-3!
    fixture.close();
    const merged = await engine.restore(backup.fileName!, "merge");
    expect(merged.ok).toBe(true);
    expect(merged.counts?.official_letters).toBe(3);

    const verify = FixtureDatabase.open({ dir: dbDir });
    try {
      const ids = (verify.db.prepare("SELECT id FROM official_letters ORDER BY id").all() as any[]).map((r) => r.id);
      expect(ids).toEqual(["leg-ltr-1", "leg-ltr-2", "new-ltr-3"]);
    } finally {
      verify.close();
    }
  });

  it("aborts smart merge cleanly on UNIQUE reference collision across different IDs without mutating live DB", async () => {
    const ws = await createV7Workspace();
    ws.fixture.db
      .prepare(
        `INSERT INTO custom_invoices (id, serial, reference, type, date, party_name, total_amount, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?)`
      )
      .run("inv-from-backup", "0001", "26-0099", "sales", "2026-11-18", "عميل النسخة", 50000, NOW, NOW);

    const backup = await ws.engine.create({ kind: "manual" });
    expect(backup.ok).toBe(true);

    // Replace local invoice with a DIFFERENT ID that happens to reuse the same reference 26-0099
    ws.fixture.db.exec("DELETE FROM custom_invoices");
    ws.fixture.db
      .prepare(
        `INSERT INTO custom_invoices (id, serial, reference, type, date, party_name, total_amount, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?)`
      )
      .run("inv-local-conflict", "0001", "26-0099", "sales", "2026-11-20", "عميل محلي مختلف", 75000, NOW, NOW);
    ws.fixture.close();

    const mergeAttempt = await ws.engine.restore(backup.fileName!, "merge");
    expect(mergeAttempt.ok).toBe(false);
    expect(mergeAttempt.errorCode).toBe("RESTORE_FAILED");
    expect(mergeAttempt.message).toContain("26-0099");

    // Live DB remained untouched
    const verify = FixtureDatabase.open({ dir: ws.dbDir });
    try {
      expect(verify.count("custom_invoices")).toBe(1);
      const row = verify.db.prepare("SELECT id, party_name FROM custom_invoices").get() as any;
      expect(row.id).toBe("inv-local-conflict");
      expect(row.party_name).toBe("عميل محلي مختلف");
    } finally {
      verify.close();
    }
  });

  it("enforces logical parent guards during merge so orphan payments are safely skipped without FK violations", async () => {
    const ws = await createV7Workspace();
    ws.fixture.db.prepare("INSERT INTO customers (id, name, created_at) VALUES (?,?,?)").run("cust-ok", "عميل سليم", NOW);
    ws.fixture.db
      .prepare(
        `INSERT INTO customer_payments (id, reference, customer_id, amount, paid_at, method, created_at, currency)
         VALUES (?,?,?,?,?,?,?,?)`
      )
      .run("pay-valid", "REC-1", "cust-ok", 1000, "2026-11-19", "cash", NOW, "SDG");
    // Insert an orphan payment whose customer_id does not exist (simulating a legacy DB row)
    ws.fixture.db
      .prepare(
        `INSERT INTO customer_payments (id, reference, customer_id, amount, paid_at, method, created_at, currency)
         VALUES (?,?,?,?,?,?,?,?)`
      )
      .run("pay-orphan", "REC-2", "cust-ghost-missing", 9999, "2026-11-19", "cash", NOW, "SDG");

    const backup = await ws.engine.create({ kind: "manual" });
    expect(backup.ok).toBe(true);

    // Clear payments on live DB (keeping cust-ok, still no cust-ghost-missing)
    ws.fixture.db.exec("DELETE FROM customer_payments");
    ws.fixture.close();

    const merged = await ws.engine.restore(backup.fileName!, "merge");
    expect(merged.ok).toBe(true);

    const verify = FixtureDatabase.open({ dir: ws.dbDir });
    try {
      const ids = (verify.db.prepare("SELECT id FROM customer_payments").all() as any[]).map((r) => r.id);
      expect(ids).toEqual(["pay-valid"]);
    } finally {
      verify.close();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. Corrupt Live Database Disaster Recovery
// ═══════════════════════════════════════════════════════════════════════════

describe("P0: Corrupt Live Database Disaster Recovery", () => {
  it("recovers from a corrupted on-disk SQLite database in replace mode without deadlocking on pre-restore safety backup", async () => {
    const ws = await createV7Workspace();
    ws.fixture.db
      .prepare(
        `INSERT INTO custom_invoices (id, serial, reference, type, date, party_name, total_amount, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?)`
      )
      .run("inv-rescue-1", "0001", "26-0001", "sales", "2026-11-19", "عميل الإنقاذ", 88000, NOW, NOW);
    ws.fixture.db
      .prepare(
        `INSERT INTO official_letters (id, reference, language, date, recipient_name, subject, body, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?)`
      )
      .run("ltr-rescue-1", "TA-RESCUE-1", "ar", "2026-11-19", "جهة رسمية", "خطاب محفوظ", "محتوى مهم", NOW, NOW);

    const goodBackup = await ws.engine.create({ kind: "manual" });
    expect(goodBackup.ok).toBe(true);
    ws.fixture.close();

    // Corrupt the live SQLite file bytes directly on disk
    const liveDbPath = join(ws.dbDir, "ta_invoicing_dbSQLite.db");
    writeFileSync(liveDbPath, Buffer.from("CORRUPTED_GARBAGE_BYTES_NOT_A_SQLITE_DB_00001111222233334444"));

    // Replace restore MUST succeed by saving raw corrupt rescue copy and skipping standard pre-restore snapshot
    const recovered = await ws.engine.restore(goodBackup.fileName!, "replace");
    expect(recovered.ok).toBe(true);
    expect(recovered.safetyBackupSkippedReason).toBe("live-db-corrupt");
    expect(recovered.corruptCopyPath).toBeTruthy();
    expect(existsSync(recovered.corruptCopyPath!)).toBe(true);
    expect(recovered.counts?.custom_invoices).toBe(1);
    expect(recovered.counts?.official_letters).toBe(1);

    // Verify restored DB is completely healthy
    const verify = FixtureDatabase.open({ dir: ws.dbDir });
    try {
      expect(verify.quickCheck().toLowerCase()).toBe("ok");
      expect(verify.count("custom_invoices")).toBe(1);
      expect(verify.count("official_letters")).toBe(1);
    } finally {
      verify.close();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. Auto-Backup Trailing Debounce + App-Pause Flush
// ═══════════════════════════════════════════════════════════════════════════

describe("P1: Auto-Backup Trailing Debounce & App-Pause Flush", () => {
  it("coalesces burst edits inside the throttle window and flushes via trailing debounce timer and on app pause", async () => {
    const ws = await createV7Workspace();
    mockState.db = ws.fixture;
    vi.useFakeTimers();
    const {
      triggerBackupAfterTransaction,
      flushPendingTransactionBackup,
      resetAutoBackupStateForTests,
    } = await import("@/lib/backup/autoBackup");
    const { resetBackupSettingsCacheForTests, saveBackupSettings } = await import("@/lib/backup/settingsStore");

    resetAutoBackupStateForTests();
    resetBackupSettingsCacheForTests();
    await saveBackupSettings({
      afterTransaction: true,
      transactionThrottleMinutes: 15,
      encryptionEnabled: false,
    });

    // 1. Leading trigger runs immediately after its 250ms settle delay
    triggerBackupAfterTransaction("invoice-1");
    await vi.advanceTimersByTimeAsync(300);
    expect(mockState.createBackupCalls.length).toBe(1);

    // 2. Burst of edits INSIDE the 15-minute throttle window must NOT be dropped —
    //    a trailing timer (capped at MAX_TRAILING_WAIT_MS = 60s) must flush them!
    triggerBackupAfterTransaction("customer-1");
    triggerBackupAfterTransaction("letter-1");
    triggerBackupAfterTransaction("payment-1");
    await vi.advanceTimersByTimeAsync(1000);
    expect(mockState.createBackupCalls.length).toBe(1); // still debouncing

    // Advance past 60s trailing cap + 250ms settle delay
    await vi.advanceTimersByTimeAsync(61_000);
    expect(mockState.createBackupCalls.length).toBe(2);

    // 3. Another mutation inside throttle window followed by immediate app pause flush
    triggerBackupAfterTransaction("expense-1");
    await vi.advanceTimersByTimeAsync(100);
    expect(mockState.createBackupCalls.length).toBe(2);

    const flushPromise = flushPendingTransactionBackup();
    await vi.advanceTimersByTimeAsync(300);
    const flushResult = await flushPromise;
    expect(flushResult?.ok).toBe(true);
    expect(mockState.createBackupCalls.length).toBe(3);

    // 4. Calling flush when no pending changes exist is a no-op
    const noop = await flushPendingTransactionBackup();
    expect(noop).toBeNull();
    expect(mockState.createBackupCalls.length).toBe(3);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. Multi-Module Protection Assessment (Real SQLite)
// ═══════════════════════════════════════════════════════════════════════════

describe("P1: Multi-Module Protection Assessment (0 new invoices still triggers unproven)", () => {
  it("transitions from protected to unproven when adding ONLY a customer, official letter, or payment", async () => {
    const ws = await createV7Workspace();
    const storage: StorageInfo = {
      state: "ok",
      folderUri: "content://tree/primary:Documents/InvoiceBackups",
      folderLabel: "Documents/InvoiceBackups",
      totalBytes: 1e10,
      freeBytes: 5e9,
      appDataBytes: 1e5,
      backupBytes: 1e5,
      backupCount: 1,
    };

    // Baseline: 1 invoice -> backed up -> protected
    ws.fixture.db
      .prepare(
        `INSERT INTO custom_invoices (id, serial, reference, type, date, party_name, total_amount, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?)`
      )
      .run("inv-base", "0001", "26-0001", "sales", "2026-11-20", "عميل أساس", 10000, NOW, NOW);

    const b1 = await ws.engine.create({ kind: "manual" });
    expect(b1.ok).toBe(true);

    const evalNow = async () => {
      const backups = await ws.engine.list();
      const counts = {
        custom_invoices: ws.fixture.count("custom_invoices"),
        proforma_invoices: ws.fixture.count("proforma_invoices"),
        print_invoices: ws.fixture.count("print_invoices"),
        customers: ws.fixture.count("customers"),
        suppliers: ws.fixture.count("suppliers"),
        orders: ws.fixture.count("orders"),
        financial_accounts: ws.fixture.count("financial_accounts"),
        customer_payments: ws.fixture.count("customer_payments"),
        supplier_payments: ws.fixture.count("supplier_payments"),
        expenses: ws.fixture.count("expenses"),
        expense_payments: ws.fixture.count("expense_payments"),
        official_letters: ws.fixture.count("official_letters"),
      };
      return assessProtection({
        storage,
        backups,
        settings: { ...DEFAULT_BACKUP_SETTINGS },
        databaseInvoiceCount: counts.custom_invoices + counts.proforma_invoices + counts.print_invoices,
        databaseBusinessRecordCount: countBusinessRecords(counts),
        now: Date.now(),
      });
    };

    expect((await evalNow()).status).toBe("protected");

    // Step A: Add ONLY a Customer (0 new invoices) -> unproven
    ws.fixture.db.prepare("INSERT INTO customers (id, name, created_at) VALUES (?,?,?)").run("c-only-1", "عميل جديد", NOW);
    expect((await evalNow()).status).toBe("unproven");

    await ws.engine.create({ kind: "transaction" });
    expect((await evalNow()).status).toBe("protected");

    // Step B: Add ONLY an Official Letter (0 new invoices) -> unproven
    ws.fixture.db
      .prepare(
        `INSERT INTO official_letters (id, reference, language, date, recipient_name, subject, body, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?)`
      )
      .run("ltr-only-1", "TA-01", "ar", "2026-11-20", "جهة", "موضوع", "نص", NOW, NOW);
    expect((await evalNow()).status).toBe("unproven");

    await ws.engine.create({ kind: "transaction" });
    expect((await evalNow()).status).toBe("protected");

    // Step C: Add ONLY a Customer Payment (0 new invoices) -> unproven
    ws.fixture.db
      .prepare(
        `INSERT INTO customer_payments (id, reference, customer_id, amount, paid_at, method, created_at, currency)
         VALUES (?,?,?,?,?,?,?,?)`
      )
      .run("pay-only-1", "REC-01", "c-only-1", 5000, "2026-11-20", "cash", NOW, "SDG");
    expect((await evalNow()).status).toBe("unproven");

    await ws.engine.create({ kind: "transaction" });
    expect((await evalNow()).status).toBe("protected");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. Pre-Update Native Backup & Renamed Archive Import
// ═══════════════════════════════════════════════════════════════════════════

describe("P2: Pre-Update Native Backup & Renamed External Archive Import", () => {
  it("runs pre-migration native backup with APP_VERSION and DB_VERSION and never hangs past timeout", async () => {
    const { runPreMigrationNativeBackup } = await import("@/lib/backup/restoreService");
    const { APP_VERSION } = await import("@/lib/appVersion");

    await runPreMigrationNativeBackup(2000);
    expect(mockState.preparePreUpdateCalls).toEqual([{ appVersion: APP_VERSION, targetSchema: DB_VERSION }]);

    // Even if native side is slow, timeout bounds startup cleanly without throwing
    mockState.preparePreUpdateDelayMs = 2000;
    const started = Date.now();
    await runPreMigrationNativeBackup(500);
    expect(Date.now() - started).toBeLessThan(1500);
  });

  it("imports a renamed external encrypted archive (e.g. from WhatsApp/Drive), unlocks via Recovery Key, and restores completely", async () => {
    const key = new Uint8Array(randomBytes(32));
    const ws = await createV7Workspace({ key });
    ws.fixture.db
      .prepare(
        `INSERT INTO official_letters (id, reference, language, date, recipient_name, subject, body, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?)`
      )
      .run("ltr-wa-1", "TA-WA-01", "ar", "2026-11-20", "عميل واتساب", "خطاب منقول", "محتوى الخطاب المنقول", NOW, NOW);

    const created = await ws.engine.create({ kind: "manual" });
    expect(created.ok).toBe(true);
    const exportedKey = await ws.engine.exportRecoveryKey();
    const archiveBytes = new Uint8Array(readFileSync(join(ws.folderDir, created.fileName!)));
    ws.fixture.close();

    // New device with separate backup folder receives renamed file "WhatsApp-Backup-Copy.tabk"
    const newFolderDir = join(ws.root, "new-device-folder");
    const newDbDir = join(ws.root, "new-device-db");
    const freshDb = FixtureDatabase.open({ dir: newDbDir });
    freshDb.applySchema(CREATE_SCHEMA_V1);
    await runPendingMigrations(freshDb, { nowIso: NOW });
    freshDb.close();

    const newEngine = new NodeBackupEngine({ folderDir: newFolderDir, dbDir: newDbDir, currentSchema: DB_VERSION });
    const imported = await newEngine.importArchiveBytes(archiveBytes, "WhatsApp-Backup-Copy.tabk");
    expect(imported.ok).toBe(true);
    expect(imported.needsRecoveryKey).toBe(true);
    expect(imported.fileName).toMatch(/^ta-backup-.*\.tabk$/);

    // Unlock using Recovery Key and restore
    const unlock = await newEngine.importRecoveryKey(exportedKey.recoveryKey!);
    expect(unlock.ok).toBe(true);

    const listed = await newEngine.list();
    expect(listed.length).toBe(1);
    expect(listed[0].status).toBe("verified");

    const restored = await newEngine.restore(imported.fileName!, "replace");
    expect(restored.ok).toBe(true);
    expect(restored.counts?.official_letters).toBe(1);
  });
});
