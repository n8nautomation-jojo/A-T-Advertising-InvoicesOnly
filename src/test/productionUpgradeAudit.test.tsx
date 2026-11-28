import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const state = vi.hoisted(() => ({
  db: null as any,
}));

vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: () => true, Plugins: {}, getPlatform: () => "android" },
  registerPlugin: () => ({}),
}));

vi.mock("@/lib/database", () => ({
  getDb: async () => state.db,
  closeDb: async () => {},
}));

vi.mock("@/lib/backup/notify", () => ({ notifyDataChanged: () => {} }));

import { CREATE_SCHEMA_V1, DB_VERSION } from "@/lib/database/schema";
import {
  V2_VERSION,
  V3_VERSION,
  V4_VERSION,
  V5_VERSION,
  V6_VERSION,
  V7_VERSION,
  runPendingMigrations,
} from "@/lib/database/migrations";
import {
  addMissingColumns,
  ensureColumnIndexes,
  ensureSchemaV2,
} from "@/lib/database/migrations/v2BusinessModel";
import { applyV3 } from "@/lib/database/migrations/v3Finance";
import { applyV4 } from "@/lib/database/migrations/v4Currency";
import { applyV5 } from "@/lib/database/migrations/v5CustomerModule";
import { applyV6MultiCurrency } from "@/lib/database/migrations/v6MultiCurrency";
import { applyV7OfficialLetters } from "@/lib/database/migrations/v7OfficialLetters";
import { applyV10ProductionUpgradeHeal } from "@/lib/database/migrations/v10ProductionUpgradeHeal";
import { FixtureDatabase, closeAllFixtures } from "@/test/backup/fixtureDb";
import {
  getAccountBalances,
  reconcileBankAccountBalance,
} from "@/lib/repositories/FinancialAccountRepository";
import { getBankAccountStatement, getCombinedBankStatement } from "@/lib/repositories/LedgerRepository";
import { refreshBankTreasury, resetBankTreasuryForTests } from "@/lib/bankTreasuryStore";

const TODAY = "2026-11-27";
const NOW_ISO = "2026-11-27T09:30:00.000Z";

async function buildLegacyV7Database(db: FixtureDatabase) {
  for (const ddl of CREATE_SCHEMA_V1) {
    await db.execute(ddl);
  }
  await ensureSchemaV2(db as any);
  await addMissingColumns(db as any);
  await ensureColumnIndexes(db as any);
  await applyV3(db as any, "2025-09-01T08:00:00.000Z");
  await applyV4(db as any);
  await applyV5(db as any);
  await applyV6MultiCurrency(db as any);
  await applyV7OfficialLetters(db as any, "2025-09-01T08:00:00.000Z");
  await db.run("INSERT OR REPLACE INTO db_meta(key, value) VALUES('schema_version', ?)", [
    String(V7_VERSION),
  ]);
  await db.execute(`PRAGMA user_version = ${V7_VERSION};`, false);

  // Verify preconditions: old v7 DB only has default SDG cash account (no USD/SAR/EGP accounts yet)
  const accs = await db.query("SELECT id, currency FROM financial_accounts");
  expect(accs.values?.length).toBe(1);
  expect(accs.values?.[0]?.id).toBe("acc-cash-default");
}

describe("Production Legacy Upgrade Audit (Old v2.0.0–v2.3.3 Schema v7 -> v10 Bank Balances & Accounting Integrity)", () => {
  let db: FixtureDatabase;

  beforeEach(async () => {
    const dir = mkdtempSync(join(tmpdir(), "ta-prod-upgrade-audit-"));
    db = new FixtureDatabase(join(dir, "legacy_v7.sqlite"));
    state.db = db;
    resetBankTreasuryForTests();
  });

  afterEach(async () => {
    await closeAllFixtures();
    state.db = null;
  });

  it("migrates legacy v7 invoices, cross-currency USD/SAR/EGP payments, inactive-account payments, unpaid purchases, and legacy expenses with exact original dates, 0.00 balance drift, and accurate multi-account reconciliation", async () => {
    await buildLegacyV7Database(db);
    const raw = db.db;

    // Seed a legacy second active SDG account + a legacy deactivated account
    raw.prepare(
      `INSERT INTO financial_accounts (id, name, kind, currency, opening_balance, is_active, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run("acc-bank-legacy", "بنك الخرطوم القديم", "bank", "SDG", 500_000, 1, "2025-09-01T08:00:00.000Z");
    raw.prepare(
      `INSERT INTO financial_accounts (id, name, kind, currency, opening_balance, is_active, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run("acc-disabled-old", "خزينة قديمة ملغاة", "cash", "SDG", 0, 0, "2025-09-01T08:00:00.000Z");

    // Seed legacy customers & suppliers
    raw.prepare("INSERT INTO customers (id, name, phone, created_at) VALUES (?,?,?,?)").run(
      "cust-1",
      "شركة النيل للإعلان",
      "0912345678",
      "2025-09-01T08:00:00.000Z"
    );
    raw.prepare("INSERT INTO suppliers (id, name, phone, created_at) VALUES (?,?,?,?)").run(
      "sup-1",
      "مورد الخامات العالمي",
      "0998765432",
      "2025-09-01T08:00:00.000Z"
    );

    // 1. Legacy SDG sales invoice (2025-11-10) + customer_payment with valid tx on acc-cash (1,000,000 SDG on 2025-11-12)
    raw.prepare(
      `INSERT INTO custom_invoices (id, serial, reference, type, date, party_name, customer_id, currency, total_amount, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`
    ).run("inv-sdg-1", "1", "INV-25-0001", "sales", "2025-11-10", "شركة النيل للإعلان", "cust-1", "SDG", 1_000_000, "2025-11-10T10:00:00.000Z", "2025-11-10T10:00:00.000Z");
    raw.prepare(
      `INSERT INTO customer_payments (id, reference, customer_id, amount, currency, paid_at, method, account_id, created_at)
       VALUES (?,?,?,?,?,?,?,?,?)`
    ).run("cp-sdg-1", "RCV-25-0001", "cust-1", 1_000_000, "SDG", "2025-11-12", "cash", "acc-cash-default", "2025-11-12T10:00:00.000Z");
    raw.prepare("INSERT INTO customer_payment_allocations (id, payment_id, invoice_id, amount, created_at) VALUES (?,?,?,?,?)").run(
      "cpa-1",
      "cp-sdg-1",
      "inv-sdg-1",
      1_000_000,
      "2025-11-12T10:00:00.000Z"
    );
    raw.prepare(
      `INSERT INTO financial_transactions (id, kind, amount, currency, occurred_at, account_id, source_type, source_id, reference_note, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`
    ).run("tx-cp-sdg-1", "receipt", 1_000_000, "SDG", "2025-11-12", "acc-cash-default", "customer_payment", "cp-sdg-1", "RCV-25-0001", "2025-11-12T10:00:00.000Z");

    // 2. Legacy SDG payment stored on an INACTIVE account (300,000 SDG on 2025-09-15) — previously hidden!
    raw.prepare(
      `INSERT INTO customer_payments (id, reference, customer_id, amount, currency, paid_at, method, account_id, created_at)
       VALUES (?,?,?,?,?,?,?,?,?)`
    ).run("cp-sdg-inactive", "RCV-25-0000", "cust-1", 300_000, "SDG", "2025-09-15", "cash", "acc-disabled-old", "2025-09-15T10:00:00.000Z");
    raw.prepare(
      `INSERT INTO financial_transactions (id, kind, amount, currency, occurred_at, account_id, source_type, source_id, reference_note, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`
    ).run("tx-cp-inactive", "receipt", 300_000, "SDG", "2025-09-15", "acc-disabled-old", "customer_payment", "cp-sdg-inactive", "RCV-25-0000", "2025-09-15T10:00:00.000Z");

    // 3. Legacy USD sales invoice (2025-12-01) with TWO legacy bugs:
    //    (a) Payment 1 (1,200 USD on 2025-12-05, Arabic digits date!) linked to `acc-cash-default` (SDG account!) with currency='USD'
    //    (b) Payment 2 (800 USD on 2025-12-10) defaulted to currency='SDG' even though allocated invoice is USD, AND missing financial_transactions!
    raw.prepare(
      `INSERT INTO custom_invoices (id, serial, reference, type, date, party_name, customer_id, currency, total_amount, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`
    ).run("inv-usd-1", "2", "INV-25-0002", "sales", "2025-12-01", "شركة النيل للإعلان", "cust-1", "USD", 2_000, "2025-12-01T10:00:00.000Z", "2025-12-01T10:00:00.000Z");

    raw.prepare(
      `INSERT INTO customer_payments (id, reference, customer_id, amount, currency, paid_at, method, account_id, created_at)
       VALUES (?,?,?,?,?,?,?,?,?)`
    ).run("cp-usd-1", "RCV-25-0002", "cust-1", 1_200, "USD", "٢٠٢٥/١٢/٠٥", "bank_transfer", "acc-cash-default", "2025-12-05T10:00:00.000Z");
    raw.prepare("INSERT INTO customer_payment_allocations (id, payment_id, invoice_id, amount, created_at) VALUES (?,?,?,?,?)").run(
      "cpa-usd-1",
      "cp-usd-1",
      "inv-usd-1",
      1_200,
      "2025-12-05T10:00:00.000Z"
    );
    raw.prepare(
      `INSERT INTO financial_transactions (id, kind, amount, currency, occurred_at, account_id, source_type, source_id, reference_note, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`
    ).run("tx-cp-usd-1", "receipt", 1_200, "USD", "٢٠٢٥/١٢/٠٥", "acc-cash-default", "customer_payment", "cp-usd-1", "RCV-25-0002", "2025-12-05T10:00:00.000Z");

    raw.prepare(
      `INSERT INTO customer_payments (id, reference, customer_id, amount, currency, paid_at, method, account_id, created_at)
       VALUES (?,?,?,?,?,?,?,?,?)`
    ).run("cp-usd-2", "RCV-25-0003", "cust-1", 800, "SDG", "2025-12-10", "bank_transfer", "acc-cash-default", "2025-12-10T10:00:00.000Z");
    raw.prepare("INSERT INTO customer_payment_allocations (id, payment_id, invoice_id, amount, created_at) VALUES (?,?,?,?,?)").run(
      "cpa-usd-2",
      "cp-usd-2",
      "inv-usd-1",
      800,
      "2025-12-10T10:00:00.000Z"
    );

    // 4. Legacy SAR supplier payment (800 SAR on 15/01/2026) stuck on acc-cash-default (SDG)
    raw.prepare(
      `INSERT INTO custom_invoices (id, serial, reference, type, date, party_name, supplier_id, currency, total_amount, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`
    ).run("pinv-sar-1", "1", "PINV-26-0001", "purchase", "2026-01-10", "مورد الخامات العالمي", "sup-1", "SAR", 1_000, "2026-01-10T10:00:00.000Z", "2026-01-10T10:00:00.000Z");
    raw.prepare(
      `INSERT INTO supplier_payments (id, reference, supplier_id, amount, currency, paid_at, method, account_id, created_at)
       VALUES (?,?,?,?,?,?,?,?,?)`
    ).run("sp-sar-1", "PAY-26-0001", "sup-1", 800, "SAR", "15/01/2026", "bank_transfer", "acc-cash-default", "2026-01-15T10:00:00.000Z");
    raw.prepare("INSERT INTO supplier_payment_allocations (id, payment_id, invoice_id, amount, created_at) VALUES (?,?,?,?,?)").run(
      "spa-sar-1",
      "sp-sar-1",
      "pinv-sar-1",
      800,
      "2026-01-15T10:00:00.000Z"
    );
    raw.prepare(
      `INSERT INTO financial_transactions (id, kind, amount, currency, occurred_at, account_id, source_type, source_id, reference_note, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`
    ).run("tx-sp-sar-1", "payment", 800, "SAR", "15/01/2026", "acc-cash-default", "supplier_payment", "sp-sar-1", "PAY-26-0001", "2026-01-15T10:00:00.000Z");

    // 5. Legacy unpaid SDG purchase invoice (400,000 SDG on 2026-02-01)
    raw.prepare(
      `INSERT INTO custom_invoices (id, serial, reference, type, date, party_name, supplier_id, currency, total_amount, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`
    ).run("pinv-sdg-1", "2", "PINV-26-0002", "purchase", "2026-02-01", "مورد الخامات العالمي", "sup-1", "SDG", 400_000, "2026-02-01T10:00:00.000Z", "2026-02-01T10:00:00.000Z");

    // 6. Legacy unsettled expenses (no expense_payments rows in old version): 150,000 SDG (2025-10-20) and 250 USD (2025-10-25)
    raw.prepare(
      `INSERT INTO expenses (id, kind, category, beneficiary, amount, currency, expense_date, method, account_id, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`
    ).run("exp-sdg-legacy", "operating", "كهرباء", "شركة الكهرباء", 150_000, "SDG", "2025-10-20", "cash", "acc-cash-default", "2025-10-20T09:00:00.000Z");
    raw.prepare(
      `INSERT INTO expenses (id, kind, category, beneficiary, amount, currency, expense_date, method, account_id, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`
    ).run("exp-usd-legacy", "direct", "استضافة", "AWS", 250, "USD", "2025-10-25", "bank_transfer", "acc-cash-default", "2025-10-25T09:00:00.000Z");

    // ═══ EXECUTE UPGRADE MIGRATION (v7 -> v10) ═══
    const outcome = await runPendingMigrations(db as any, { nowIso: NOW_ISO });
    expect(outcome.from).toBe(V7_VERSION);
    expect(outcome.to).toBe(DB_VERSION);
    expect(outcome.warnings).toEqual([]);

    // Re-running migration & v10 heal must be 100% idempotent (zero duplicate rows!)
    const rerun = await runPendingMigrations(db as any, { nowIso: NOW_ISO });
    expect(rerun.applied).toEqual([]);
    const secondHeal = await applyV10ProductionUpgradeHeal(db as any, NOW_ISO);
    expect(secondHeal.inferredPaymentCurrencies).toBe(0);
    expect(secondHeal.reroutedCrossCurrencyTx).toBe(0);
    expect(secondHeal.reroutedInactiveAccountTx).toBe(0);
    expect(secondHeal.v9BackfilledTotal).toBe(0);

    // ═══ ASSERT EXACT BALANCES ACROSS ALL CURRENCIES ═══
    // Expected SDG: opening(500,000) + cp(1,000,000) + cp_inactive_healed(300,000) - exp(150,000) - unpaid_purchase(400,000) = 1,250,000 SDG
    const sdgStmt = await getBankAccountStatement({ currency: "SDG", period: "all", today: TODAY });
    expect(sdgStmt.currentBalance).toBe(1_250_000);
    expect(sdgStmt.items[0].runningBalance).toBe(sdgStmt.currentBalance); // newest item's runningBalance === currentBalance!

    // Expected USD: cp1_rerouted(1,200) + cp2_inferred_and_backfilled(800) - exp_usd(250) = 1,750 USD
    const usdStmt = await getBankAccountStatement({ currency: "USD", period: "all", today: TODAY });
    expect(usdStmt.currentBalance).toBe(1_750);
    expect(usdStmt.items[0].runningBalance).toBe(1_750);

    // Expected SAR: -sp_rerouted(800) - unpaid_purchase_remainder(200) = -1,000 SAR (zero double-counting!)
    const sarStmt = await getBankAccountStatement({ currency: "SAR", period: "all", today: TODAY });
    expect(sarStmt.currentBalance).toBe(-1_000);
    expect(sarStmt.items[0].runningBalance).toBe(-1_000);

    // ═══ ASSERT ORIGINAL HISTORICAL DATES PRESERVED (NEVER TODAY 2026-11-27) ═══
    const combined = await getCombinedBankStatement({ period: "all", today: TODAY });
    const dates = combined.items.map((i) => i.occurredAt);
    expect(dates).toContain("2025-09-15");
    expect(dates).toContain("2025-10-20");
    expect(dates).toContain("2025-10-25");
    expect(dates).toContain("2025-11-12");
    expect(dates).toContain("2025-12-05");
    expect(dates).toContain("2025-12-10");
    expect(dates).toContain("2026-01-15");
    expect(dates).toContain("2026-02-01");
    expect(dates).not.toContain(TODAY);

    // ═══ ASSERT HOMEPAGE STORE === BANK STATEMENT === RECONCILIATION (MULTI-ACCOUNT SDG!) ═══
    await refreshBankTreasury();
    const sdgAccounts = (await getAccountBalances()).filter((r) => r.account.currency === "SDG");
    expect(sdgAccounts.length).toBe(2); // BOTH acc-cash and acc-bank-legacy are active!

    // User reconciles SDG bank balance to 10,000,000 SDG via primary SDG account
    const primarySdgId = sdgAccounts[0].account.id;
    const rec = await reconcileBankAccountBalance(
      {
        accountId: primarySdgId,
        actualBalance: 10_000_000,
        occurredAt: TODAY,
        notes: "مطابقة بعد الترقية من النسخة القديمة",
      },
      NOW_ISO
    );
    expect(rec.previousBalance).toBe(1_250_000);
    expect(rec.delta).toBe(8_750_000);
    expect(rec.newBalance).toBe(10_000_000);

    const sdgAfterRec = await getBankAccountStatement({ currency: "SDG", period: "all", today: TODAY });
    expect(sdgAfterRec.currentBalance).toBe(10_000_000);
    expect(sdgAfterRec.items[0].runningBalance).toBe(10_000_000);
  });
});
