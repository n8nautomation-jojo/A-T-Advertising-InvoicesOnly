import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const state = vi.hoisted(() => ({ db: null as any }));

vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: () => true, Plugins: {}, getPlatform: () => "android" },
  registerPlugin: () => ({}),
}));

vi.mock("@/lib/database", () => ({
  getDb: async () => state.db,
  closeDb: async () => {},
  withDbWriteLock: async <T>(fn: () => Promise<T>) => fn(),
  withDbTransaction: async <T>(fn: (db: any) => Promise<T>) => {
    const db = state.db;
    await db.beginTransaction();
    try {
      const res = await fn(db);
      await db.commitTransaction();
      return res;
    } catch (err) {
      try {
        await db.rollbackTransaction();
      } catch {}
      throw err;
    }
  },
}));

vi.mock("@/lib/backup/notify", () => ({ notifyDataChanged: () => {} }));

import { CREATE_SCHEMA_V1, DEFAULT_CASH_ACCOUNT } from "./schema";
import { runPendingMigrations } from "./migrations";
import { FixtureDatabase, closeAllFixtures } from "@/test/backup/fixtureDb";
import {
  upsertCustomer,
  getAllCustomerFinancialSummaries,
  getCustomerFinancialSummary,
} from "@/lib/repositories/CustomerRepository";
import { upsertCustomInvoice } from "@/lib/repositories/CustomInvoiceRepository";
import { createAccount } from "@/lib/repositories/FinancialAccountRepository";
import {
  recordCustomerReceipt,
  recordSupplierPayment,
  recordTransfer,
} from "@/lib/repositories/PaymentRepository";
import { createSupplier, cancelSupplier } from "@/lib/repositories/SupplierRepository";

describe("Strict Multi-Currency Isolation across Customers, Payments, Transfers & Suppliers", () => {
  beforeEach(async () => {
    closeAllFixtures();
    const dir = mkdtempSync(join(tmpdir(), "ta-mc-iso-"));
    const fx = new FixtureDatabase(join(dir, "test.db"));
    state.db = fx;
    for (const stmt of CREATE_SCHEMA_V1) {
      await fx.execute(stmt + ";", false);
    }
    await runPendingMigrations(fx);
  });

  afterEach(() => {
    closeAllFixtures();
  });

  it("reports a USD-only customer strictly in USD (never SDG) in both directory summaries and profile", async () => {
    await upsertCustomer({
      id: "cust-usd-only",
      name: "شركة المدار الدولية",
      phone: "0911111111",
      type: "company",
      address: "الخرطوم",
      totalOrders: 0,
      totalSpent: 0,
      balance: 0,
      createdAt: "2026-11-20T00:00:00.000Z",
    });

    await upsertCustomInvoice({
      id: "inv-usd-1",
      customerId: "cust-usd-only",
      currency: "USD",
      meta: {
        type: "sales",
        serial: "0001",
        date: "2099-12-31",
        partyName: "شركة المدار الدولية",
        currency: "USD",
      },
      items: [{ id: "item-1", description: "تصميم هوية", qty: 1, unitPrice: 500, total: 500 }],
      totalAmount: 500,
      createdAt: "2026-11-20T08:00:00.000Z",
    });

    const summaries = await getAllCustomerFinancialSummaries();
    const row = summaries["cust-usd-only"];
    expect(row).toBeDefined();
    expect(row.primaryCurrency).toBe("USD");
    expect(row.invoiced).toBe(500);
    expect(row.outstanding).toBe(500);
    expect(row.byCurrency.USD).toEqual({
      currency: "USD",
      invoiced: 500,
      collected: 0,
      outstanding: 500,
      overdueCount: 0,
    });
    expect(row.byCurrency.SDG).toBeUndefined();

    const profile = await getCustomerFinancialSummary("cust-usd-only");
    expect(profile.primaryCurrency).toBe("USD");
    expect(Object.keys(profile.summariesByCurrency)).toEqual(["USD"]);
    expect(profile.summariesByCurrency.USD.totalInvoiced).toBe(500);
    expect(profile.summariesByCurrency.USD.outstanding).toBe(500);
  });

  it("keeps USD and SDG strictly separated without ever summing mixed currencies for a dual-currency customer", async () => {
    await upsertCustomer({
      id: "cust-dual",
      name: "عميل بعملتين",
      phone: "0922222222",
      type: "company",
      address: "",
      totalOrders: 0,
      totalSpent: 0,
      balance: 0,
      createdAt: "2026-11-20T00:00:00.000Z",
    });

    await upsertCustomInvoice({
      id: "inv-dual-usd",
      customerId: "cust-dual",
      currency: "USD",
      meta: { type: "sales", serial: "0002", date: "2026-11-20", partyName: "عميل بعملتين", currency: "USD" },
      items: [{ id: "i1", description: "حملة رقمية", qty: 1, unitPrice: 300, total: 300 }],
      totalAmount: 300,
      createdAt: "2026-11-20T09:00:00.000Z",
    });

    await upsertCustomInvoice({
      id: "inv-dual-sdg",
      customerId: "cust-dual",
      currency: "SDG",
      meta: { type: "sales", serial: "0003", date: "2026-11-20", partyName: "عميل بعملتين", currency: "SDG" },
      items: [{ id: "i2", description: "مطبوعات ورقية", qty: 1, unitPrice: 120000, total: 120000 }],
      totalAmount: 120000,
      createdAt: "2026-11-20T10:00:00.000Z",
    });

    const summaries = await getAllCustomerFinancialSummaries();
    const row = summaries["cust-dual"];
    expect(row.byCurrency.USD?.invoiced).toBe(300);
    expect(row.byCurrency.SDG?.invoiced).toBe(120000);
    // Must NEVER be 120300
    expect(row.invoiced).not.toBe(120300);
  });

  it("blocks posting a USD receipt into an SDG account and blocks cross-currency account transfers", async () => {
    await upsertCustomer({
      id: "cust-pay",
      name: "عميل تحصيل",
      phone: "0933333333",
      type: "client",
      address: "",
      totalOrders: 0,
      totalSpent: 0,
      balance: 0,
      createdAt: "2026-11-20T00:00:00.000Z",
    });

    const usdAccount = await createAccount({
      name: "خزينة الدولار",
      kind: "cash",
      currency: "USD",
      openingBalance: 1000,
    });

    await expect(
      recordCustomerReceipt({
        customerId: "cust-pay",
        accountId: DEFAULT_CASH_ACCOUNT.id, // SDG cash box
        amount: 100,
        currency: "USD",
        method: "cash",
        paidAt: "2026-11-20",
      })
    ).rejects.toThrow();

    await expect(
      recordTransfer({
        fromAccountId: usdAccount.id,
        toAccountId: DEFAULT_CASH_ACCOUNT.id,
        amount: 50,
        occurredAt: "2026-11-20",
      })
    ).rejects.toThrow();

    const okReceipt = await recordCustomerReceipt({
      customerId: "cust-pay",
      accountId: usdAccount.id,
      amount: 100,
      currency: "USD",
      method: "cash",
      paidAt: "2026-11-20",
    });
    expect(okReceipt.payment.currency).toBe("USD");
  });

  it("prevents cancelling a supplier with unpaid USD debt even if they have an SDG credit", async () => {
    const supplier = await createSupplier({
      name: "مورد أحبار دولي",
      phone: "0944444444",
    });

    await upsertCustomInvoice({
      id: "pinv-usd-1",
      supplierId: supplier.id,
      currency: "USD",
      meta: { type: "purchase", serial: "0001", date: "2026-11-20", partyName: "مورد أحبار دولي", currency: "USD" },
      items: [{ id: "p1", description: "أحبار طباعة", qty: 1, unitPrice: 400, total: 400 }],
      totalAmount: 400,
      createdAt: "2026-11-20T10:00:00.000Z",
    });

    // Advance payment in SDG must NOT mask unpaid USD invoice
    await recordSupplierPayment({
      supplierId: supplier.id,
      accountId: DEFAULT_CASH_ACCOUNT.id,
      amount: 500000,
      currency: "SDG",
      method: "cash",
      paidAt: "2026-11-20",
    });

    await expect(cancelSupplier(supplier.id, "اختبار")).rejects.toThrow(/USD/);
  });
});
