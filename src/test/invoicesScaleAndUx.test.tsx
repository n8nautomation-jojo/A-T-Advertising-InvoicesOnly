import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const state = vi.hoisted(() => ({
  db: null as any,
}));

vi.mock("@/lib/database", () => ({
  getDb: async () => state.db,
  closeDb: async () => {},
}));

vi.mock("@/lib/backup/notify", () => ({ notifyDataChanged: () => {} }));

import { CREATE_SCHEMA_V1 } from "@/lib/database/schema";
import { runPendingMigrations } from "@/lib/database/migrations";
import { FixtureDatabase, closeAllFixtures } from "@/test/backup/fixtureDb";
import { queryCustomInvoicesPage } from "@/lib/repositories/CustomInvoiceRepository";

describe("100,000+ Invoices SQLite Indexed Pagination Scale Proof", () => {
  let db: FixtureDatabase;

  beforeEach(async () => {
    const dir = mkdtempSync(join(tmpdir(), "ta-100k-scale-"));
    db = new FixtureDatabase(join(dir, "scale.sqlite"));
    state.db = db;
    for (const ddl of CREATE_SCHEMA_V1) {
      await db.execute(ddl);
    }
    await runPendingMigrations(db as any);
  });

  afterEach(async () => {
    await closeAllFixtures();
    state.db = null;
  });

  it("handles 100,000 invoices in SQLite with fast indexed pagination, filtering, and search", async () => {
    const TOTAL = 100_000;
    const raw = db.db;

    const insertStmt = raw.prepare(
      `INSERT INTO custom_invoices
         (id, serial, reference, type, date, party_name, currency, total_amount, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );

    const currencies = ["SDG", "USD", "SAR", "EGP"];
    const types = ["sales", "purchase", "proforma"];

    raw.exec("BEGIN TRANSACTION");
    try {
      for (let i = 1; i <= TOTAL; i++) {
        const day = String(((i - 1) % 28) + 1).padStart(2, "0");
        const month = String((Math.floor((i - 1) / 28) % 12) + 1).padStart(2, "0");
        const cur = currencies[i % 4];
        const type = types[i % 3];
        const ref = `INV-26-${String(i).padStart(6, "0")}`;
        const party = i === 54321 ? "شركة المستقبل الذهبية" : `عميل رقم ${i % 500}`;
        const date = `2026-${month}-${day}`;
        insertStmt.run(
          `inv-${i}`,
          String(i),
          ref,
          type,
          date,
          party,
          cur,
          (i % 1000) * 100 + 50,
          `${date}T10:00:00.000Z`,
          `${date}T10:00:00.000Z`
        );
      }
      raw.exec("COMMIT");
    } catch (e) {
      raw.exec("ROLLBACK");
      throw e;
    }

    // 1. Page 1 of 100,000 invoices (pageSize = 25 -> 4,000 pages)
    const t0 = performance.now();
    const page1 = await queryCustomInvoicesPage({ page: 1, pageSize: 25 });
    const elapsedPage1 = performance.now() - t0;

    expect(page1.totalCount).toBe(TOTAL);
    expect(page1.totalPages).toBe(4000);
    expect(page1.items).toHaveLength(25);
    expect(elapsedPage1).toBeLessThan(350);

    // 2. Deep jump to Page 2,000 out of 4,000
    const page2000 = await queryCustomInvoicesPage({ page: 2000, pageSize: 25 });
    expect(page2000.page).toBe(2000);
    expect(page2000.items).toHaveLength(25);

    // 3. Currency + type filter across 100,000 records
    const usdSales = await queryCustomInvoicesPage({
      page: 1,
      pageSize: 50,
      type: "sales",
      currency: "USD",
    });
    expect(usdSales.totalCount).toBeGreaterThan(8000);
    expect(usdSales.items).toHaveLength(50);
    expect(usdSales.items.every((item) => item.currency === "USD" && item.type === "sales")).toBe(true);

    // 4. Exact needle search inside 100,000 invoices
    const found = await queryCustomInvoicesPage({
      page: 1,
      pageSize: 25,
      search: "المستقبل الذهبية",
    });
    expect(found.totalCount).toBe(1);
    expect(found.items[0].reference).toBe("INV-26-054321");
  }, 30_000);
});
