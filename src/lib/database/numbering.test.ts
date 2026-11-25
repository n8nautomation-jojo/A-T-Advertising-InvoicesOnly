/**
 * تكامل نظام الترقيم مع SQLite حقيقي (بنفس محرّك SQLite المستخدم على أندرويد).
 * يتحقق من معايير القبول في PRD §17 المتعلقة بالمراجع.
 */
import { describe, expect, it, beforeEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CREATE_SCHEMA_V1, DB_VERSION } from "@/lib/database/schema";
import {
  EXPENSE_PAYMENT_TARGET,
  allocateDocumentNumber,
  reserveReference,
  seedSequenceCounter,
} from "@/lib/database/sequences";
import { backfillInvoiceReferences, ensureSchemaV2, verifySequenceConsistency } from "@/lib/database/migrations/v2BusinessModel";
import { SCHEMA_VERSION, runPendingMigrations } from "@/lib/database/migrations";
import { reconcileOrphanInvoicesToCustomers } from "@/lib/database/migrations/v5CustomerModule";
import { FixtureDatabase } from "@/test/backup/fixtureDb";

const NOW = "2026-11-11T10:00:00.000Z";

let dir = "";
let db: FixtureDatabase;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "ta-numbering-"));
  db = FixtureDatabase.open({ dir });
  db.applySchema(CREATE_SCHEMA_V1);
  db.db
    .prepare("INSERT OR REPLACE INTO db_meta(key, value) VALUES('schema_version','1')")
    .run();
  // Run the real migration so columns, indexes and counters exist exactly as
  // they do on a device after the upgrade.
  const outcome = await runPendingMigrations(db, { nowIso: NOW });
  expect(outcome.warnings).toEqual([]);
  expect(outcome.to).toBe(SCHEMA_VERSION);
  expect(outcome.to).toBe(DB_VERSION);
});

function insertInvoice(id: string, type: string, date: string, reference: string | null, createdAt: string) {
  db.db
    .prepare(
      `INSERT INTO custom_invoices (id, serial, type, date, party_name, language, total_amount, created_at, updated_at, reference)
       VALUES (?,?,?,?,?,?,?,?,?,?)`
    )
    .run(id, "001", type, date, "عميل", "ar", 100, createdAt, createdAt, reference);
}

describe("Atomic allocation (PRD §5.3.2)", () => {
  it("issues sequential references for the same day and restarts on a new day", async () => {
    const first = await allocateDocumentNumber(db, "sales", "11112026", NOW);
    const second = await allocateDocumentNumber(db, "sales", "11112026", NOW);
    const third = await allocateDocumentNumber(db, "sales", "11112026", NOW);
    expect([first.reference, second.reference, third.reference]).toEqual([
      "INV-11112026-001",
      "INV-11112026-002",
      "INV-11112026-003",
    ]);

    const nextDay = await allocateDocumentNumber(db, "sales", "12112026", NOW);
    expect(nextDay.reference).toBe("INV-12112026-001");
  });

  it("never hands out a duplicate across many rapid allocations", async () => {
    const references = new Set<string>();
    for (let i = 0; i < 60; i++) {
      const allocated = await allocateDocumentNumber(db, "sales", "11112026", NOW);
      references.add(allocated.reference);
    }
    expect(references.size).toBe(60);
    expect(references.has("INV-11112026-060")).toBe(true);
  });

  it("keeps sales and purchase counters separate (PRD §5.3.8)", async () => {
    await allocateDocumentNumber(db, "sales", "11112026", NOW);
    await allocateDocumentNumber(db, "sales", "11112026", NOW);
    const purchase = await allocateDocumentNumber(db, "purchase", "11112026", NOW);
    expect(purchase.reference).toBe("PINV-11112026-001");
  });

  it("skips a number that is already stored (collision safety net)", async () => {
    // Simulate a database where 001 exists but the counter row was lost.
    insertInvoice("inv-1", "sales", "2026-11-11", "INV-11112026-001", NOW);
    const allocated = await allocateDocumentNumber(db, "sales", "11112026", NOW);
    expect(allocated.reference).toBe("INV-11112026-002");
  });

  it("recovers the counter from existing references after a restore (PRD §17)", async () => {
    insertInvoice("a", "sales", "2026-11-11", "INV-11112026-001", NOW);
    insertInvoice("b", "sales", "2026-11-11", "INV-11112026-002", NOW);
    // document_sequences is empty (older backup without the numbering table)
    expect(db.count("document_sequences")).toBe(0);

    const allocated = await allocateDocumentNumber(db, "sales", "11112026", NOW);
    expect(allocated.reference).toBe("INV-11112026-003");
  });

  it("allocates a purchase invoice cleanly after 70 sales invoices in the same year (FIN-05)", async () => {
    const seen = new Set<string>();
    for (let i = 1; i <= 70; i++) {
      const salesRef = await allocateDocumentNumber(db, "sales", "2026", NOW);
      expect(seen.has(salesRef.reference)).toBe(false);
      seen.add(salesRef.reference);
      insertInvoice(`sale-${i}`, "sales", "2026-11-11", salesRef.reference, NOW);
    }

    const purchaseRef = await allocateDocumentNumber(db, "purchase", "2026", NOW);
    expect(purchaseRef.reference).toBe("26-0071");
    expect(seen.has(purchaseRef.reference)).toBe(false);
    insertInvoice("purchase-1", "purchase", "2026-11-11", purchaseRef.reference, NOW);

    // Even if document_sequences is wiped (backup restore), purchase still recovers cleanly past 71.
    db.db.exec("DELETE FROM document_sequences");
    const purchaseAfterWipe = await allocateDocumentNumber(db, "purchase", "2026", NOW);
    expect(purchaseAfterWipe.reference).toBe("26-0072");
  });

  it("allocates expense_payment references in their own EXP namespace without colliding with supplier_payments (FIN-09)", async () => {
    const payRef = await allocateDocumentNumber(db, "supplier_payment", "11112026", NOW, {
      table: "supplier_payments",
    });
    const expRef = await allocateDocumentNumber(db, "expense_payment", "11112026", NOW, EXPENSE_PAYMENT_TARGET);
    expect(payRef.reference).toBe("PAY-11112026-001");
    expect(expRef.reference).toBe("EXP-11112026-001");
  });
});

describe("Counter seeding", () => {
  it("never lowers a counter", async () => {
    await seedSequenceCounter(db, "sales", "11112026", 10, NOW);
    await seedSequenceCounter(db, "sales", "11112026", 4, NOW);
    const allocated = await allocateDocumentNumber(db, "sales", "11112026", NOW);
    expect(allocated.reference).toBe("INV-11112026-011");
  });

  it("reserves a preferred number and falls back to the next free one", async () => {
    const reserved = await reserveReference(db, "sales", "11112026", 5, NOW);
    expect(reserved.reference).toBe("INV-11112026-005");

    // Same preferred number again → must not overwrite, must advance safely.
    const fallback = await reserveReference(db, "sales", "11112026", 5, NOW);
    expect(fallback.reference).not.toBe("INV-11112026-005");
    expect(fallback.reference).toBe("INV-11112026-006");
  });
});

describe("Retroactive backfill against real rows (PRD §5.3.3)", () => {
  it("numbers existing invoices deterministically and leaves other types alone", async () => {
    insertInvoice("s-c", "sales", "2026-11-11", null, "2026-11-11T18:00:00.000Z");
    insertInvoice("s-a", "sales", "2026-11-11", null, "2026-11-11T08:00:00.000Z");
    insertInvoice("s-b", "sales", "2026-11-11", null, "2026-11-11T12:00:00.000Z");
    insertInvoice("s-d", "sales", "2026-11-12", null, "2026-11-12T09:00:00.000Z");
    insertInvoice("p-1", "purchase", "2026-11-11", null, "2026-11-11T09:00:00.000Z");
    insertInvoice("f-1", "proforma", "2026-11-11", null, "2026-11-11T09:30:00.000Z");

    const report = await backfillInvoiceReferences(db, NOW);
    expect(report.assigned).toBe(5);
    expect(report.skipped).toBe(1);

    const refOf = (id: string) =>
      (db.db.prepare("SELECT reference FROM custom_invoices WHERE id = ?").get(id) as any)?.reference;

    expect(refOf("s-a")).toBe("26-0001");
    expect(refOf("s-b")).toBe("26-0002");
    expect(refOf("s-c")).toBe("26-0003");
    expect(refOf("s-d")).toBe("26-0004");
    expect(refOf("p-1")).toBe("26-0005");
    // proforma keeps its legacy serial: no mandated format exists for it
    expect(refOf("f-1")).toBeNull();
  });

  it("is idempotent: a second run changes nothing and reuses no number", async () => {
    insertInvoice("s-a", "sales", "2026-11-11", null, "2026-11-11T08:00:00.000Z");
    insertInvoice("s-b", "sales", "2026-11-11", null, "2026-11-11T09:00:00.000Z");

    await backfillInvoiceReferences(db, NOW);
    const snapshot = db.db.prepare("SELECT id, reference FROM custom_invoices ORDER BY id").all() as any[];

    const second = await backfillInvoiceReferences(db, NOW);
    expect(second.assigned).toBe(0);
    expect(second.scanned).toBe(0);

    const after = db.db.prepare("SELECT id, reference FROM custom_invoices ORDER BY id").all() as any[];
    expect(after).toEqual(snapshot);
  });

  it("continues after the backfilled range for a new invoice", async () => {
    insertInvoice("s-a", "sales", "2026-11-11", null, "2026-11-11T08:00:00.000Z");
    insertInvoice("s-b", "sales", "2026-11-11", null, "2026-11-11T09:00:00.000Z");
    await backfillInvoiceReferences(db, NOW);

    const allocated = await allocateDocumentNumber(db, "sales", "2026", NOW);
    expect(allocated.reference).toBe("26-0003");
  });

  it("preserves an existing reference and never renumbers it", async () => {
    insertInvoice("s-a", "sales", "2026-11-11", "INV-11112026-001", "2026-11-11T08:00:00.000Z");
    insertInvoice("s-b", "sales", "2026-11-11", null, "2026-11-11T09:00:00.000Z");
    await backfillInvoiceReferences(db, NOW);

    const refOf = (id: string) =>
      (db.db.prepare("SELECT reference FROM custom_invoices WHERE id = ?").get(id) as any)?.reference;
    expect(refOf("s-a")).toBe("INV-11112026-001");
    expect(refOf("s-b")).toBe("26-0001");
  });

  it("repairs counters for restricted backends that restored references without them", async () => {
    insertInvoice("s-a", "sales", "2026-11-11", "26-0007", NOW);
    db.db.exec("DELETE FROM document_sequences");
    const repaired = await verifySequenceConsistency(db, NOW);
    expect(repaired).toBeGreaterThan(0);
    const allocated = await allocateDocumentNumber(db, "sales", "2026", NOW);
    expect(allocated.reference).toBe("26-0008");
  });
});

describe("Soft cancellation keeps references (PRD §5.3.7, §12.13)", () => {
  it("keeps the cancelled invoice's number out of circulation forever", async () => {
    insertInvoice("s-a", "sales", "2026-11-11", null, "2026-11-11T08:00:00.000Z");
    await backfillInvoiceReferences(db, NOW);
    const before = (db.db.prepare("SELECT reference FROM custom_invoices WHERE id='s-a'").get() as any).reference;
    expect(before).toBe("26-0001");

    db.db.prepare("UPDATE custom_invoices SET cancelled_at = ? WHERE id = 's-a'").run(NOW);
    db.db.exec("DELETE FROM document_sequences");

    // The next invoice must reuse neither the number nor the gap arbitrarily.
    const allocated = await allocateDocumentNumber(db, "sales", "2026", NOW);
    expect(allocated.reference).toBe("26-0002");

    const stillThere = (db.db.prepare("SELECT reference FROM custom_invoices WHERE id='s-a'").get() as any).reference;
    expect(stillThere).toBe("26-0001");
  });
});

describe("Migration safety", () => {
  it("ensureSchemaV2 is idempotent and v6 multi-currency columns + v5 sales-only reconciliation hold", async () => {
    await ensureSchemaV2(db);
    await ensureSchemaV2(db);
    const tables = (db.db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as any[]).map((r) => r.name);
    for (const expected of ["projects", "suppliers", "document_sequences", "audit_log", "financial_transactions"]) {
      expect(tables).toContain(expected);
    }

    // Verify v6 multi-currency columns exist across all 6 upgraded tables.
    for (const table of [
      "financial_accounts",
      "financial_transactions",
      "supplier_payments",
      "expenses",
      "expense_payments",
      "orders",
    ]) {
      const cols = (db.db.prepare(`PRAGMA table_info(${table})`).all() as any[]).map((c) => c.name);
      expect(cols).toContain("currency");
    }

    // Verify v5 reconciliation never links purchase invoices or ambiguous duplicate customer names.
    db.db.prepare("INSERT INTO customers (id, name, created_at) VALUES (?,?,?)").run("c-uniq", "شركة النور", NOW);
    db.db.prepare("INSERT INTO customers (id, name, created_at) VALUES (?,?,?)").run("c-dup-1", "عميل مكرر", NOW);
    db.db.prepare("INSERT INTO customers (id, name, created_at) VALUES (?,?,?)").run("c-dup-2", "عميل مكرر", NOW);
    db.db
      .prepare(
        `INSERT INTO custom_invoices (id, serial, type, date, party_name, total_amount, created_at, updated_at, reference)
         VALUES (?,?,?,?,?,?,?,?,?)`
      )
      .run("inv-purchase-same", "001", "purchase", "2026-11-11", "شركة النور", 500, NOW, NOW, "26-0901");
    db.db
      .prepare(
        `INSERT INTO custom_invoices (id, serial, type, date, party_name, total_amount, created_at, updated_at, reference)
         VALUES (?,?,?,?,?,?,?,?,?)`
      )
      .run("inv-sales-uniq", "002", "sales", "2026-11-11", "شركة النور", 500, NOW, NOW, "26-0902");
    db.db
      .prepare(
        `INSERT INTO custom_invoices (id, serial, type, date, party_name, total_amount, created_at, updated_at, reference)
         VALUES (?,?,?,?,?,?,?,?,?)`
      )
      .run("inv-sales-dup", "003", "sales", "2026-11-11", "عميل مكرر", 500, NOW, NOW, "26-0903");

    const reconciled = await reconcileOrphanInvoicesToCustomers(db);
    expect(reconciled).toBe(1);
    const getCustId = (id: string) =>
      (db.db.prepare("SELECT customer_id FROM custom_invoices WHERE id = ?").get(id) as any)?.customer_id;
    expect(getCustId("inv-purchase-same")).toBeNull();
    expect(getCustId("inv-sales-uniq")).toBe("c-uniq");
    expect(getCustId("inv-sales-dup")).toBeNull();
  });

  it("cleans up the temporary fixture", () => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
    expect(true).toBe(true);
  });
});
