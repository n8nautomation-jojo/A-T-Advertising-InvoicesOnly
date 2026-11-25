/**
 * تكامل الحركات المالية مع SQLite حقيقي:
 * التحصيل الجزئي والمتعدد، أرصدة الحسابات، ذمم الموردين، المصروف غير المدفوع،
 * سداد المصروف، التحويل الداخلي، والإلغاء الذي يعكس الأثر مرة واحدة فقط.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
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
}));

vi.mock("@/lib/backup/notify", () => ({ notifyDataChanged: () => {} }));

import { CREATE_SCHEMA_V1, DB_VERSION } from "@/lib/database/schema";
import { runPendingMigrations } from "@/lib/database/migrations";
import { FixtureDatabase, closeAllFixtures } from "@/test/backup/fixtureDb";
import { createSupplier, getSupplierAccount } from "@/lib/repositories/SupplierRepository";
import { cancelExpense, createExpense, payExpense } from "@/lib/repositories/ExpenseRepository";
import { cancelCustomInvoice, upsertCustomInvoice } from "@/lib/repositories/CustomInvoiceRepository";
import {
  cancelPayment,
  recordCustomerReceipt,
  recordSupplierPayment,
  recordTransfer,
} from "@/lib/repositories/PaymentRepository";
import { getAccountBalances, getDefaultAccountId } from "@/lib/repositories/FinancialAccountRepository";
import {
  getCashSummary,
  getCompanyProfitability,
  getInvoicePaidMap,
  getPayablesSummary,
  getReceivablesSummary,
} from "@/lib/repositories/LedgerRepository";
import { listAuditEntries } from "@/lib/repositories/AuditLogRepository";

const NOW = "2026-11-11T10:00:00.000Z";
const TODAY = "2026-11-11";

let dir = "";
let db: FixtureDatabase;

beforeEach(async () => {
  closeAllFixtures();
  dir = mkdtempSync(join(tmpdir(), "ta-finance-"));
  db = FixtureDatabase.open({ dir });
  db.applySchema(CREATE_SCHEMA_V1);
  db.db.prepare("INSERT OR REPLACE INTO db_meta(key, value) VALUES('schema_version','1')").run();
  const outcome = await runPendingMigrations(db, { nowIso: NOW });
  expect(outcome.warnings).toEqual([]);
  expect(outcome.to).toBe(DB_VERSION);
  state.db = db;
});

function addCustomer(id: string, name: string) {
  db.db
    .prepare("INSERT INTO customers (id, name, phone, type, created_at) VALUES (?,?,?,?,?)")
    .run(id, name, "0912", "company", NOW);
}

function addSalesInvoice(id: string, reference: string, total: number, customerId: string) {
  db.db
    .prepare(
      `INSERT INTO custom_invoices
        (id, serial, type, date, party_name, customer_id, language, total_amount, created_at, updated_at, reference)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`
    )
    .run(id, "001", "sales", TODAY, "عميل", customerId, "ar", total, NOW, NOW, reference);
}

function addPurchaseInvoice(id: string, reference: string, total: number, supplierId: string) {
  db.db
    .prepare(
      `INSERT INTO custom_invoices
        (id, serial, type, date, party_name, supplier_id, language, total_amount, created_at, updated_at, reference)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`
    )
    .run(id, "001", "purchase", TODAY, "مورد", supplierId, "ar", total, NOW, NOW, reference);
}

async function defaultAccount(): Promise<string> {
  const id = await getDefaultAccountId();
  if (!id) throw new Error("no default account");
  return id;
}

describe("Default accounts (PRD §13.2, §10 — Schema v8 4-Currency Treasury)", () => {
  it("seeds canonical accounts for SDG, USD, SAR, and EGP at zero balance so money can be recorded immediately in any currency", async () => {
    const accounts = await getAccountBalances();
    expect(accounts.length).toBe(4);
    expect(accounts.map((a) => a.account.currency).sort()).toEqual(["EGP", "SAR", "SDG", "USD"]);
    const sdg = accounts.find((a) => a.account.currency === "SDG")!;
    expect(sdg.account.id).toBe("acc-cash-default");
    expect(sdg.account.kind).toBe("cash");
    expect(sdg.account.accountNumber).toBe("3283046");
    for (const report of accounts) {
      expect(report.balance).toBe(0);
    }
  });
});

describe("Customer collections (PRD §6, §17)", () => {
  it("does not increase cash when an invoice is created", async () => {
    addCustomer("cust-1", "شركة");
    addSalesInvoice("inv-1", "INV-11112026-001", 250000, "cust-1");

    const cash = await getCashSummary();
    expect(cash.liquidity).toBe(0);
    expect(cash.receipts).toBe(0);

    const receivables = await getReceivablesSummary(TODAY);
    expect(receivables.invoiced).toBe(250000);
    expect(receivables.collected).toBe(0);
    expect(receivables.outstanding).toBe(250000);
    expect(receivables.unpaidCount).toBe(1);
  });

  it("updates the outstanding balance on a partial payment", async () => {
    addCustomer("cust-1", "شركة");
    addSalesInvoice("inv-1", "INV-11112026-001", 250000, "cust-1");
    const accountId = await defaultAccount();

    const { payment } = await recordCustomerReceipt({
      customerId: "cust-1",
      amount: 100000,
      paidAt: TODAY,
      accountId,
      allocations: [{ invoiceId: "inv-1", amount: 100000 }],
    });

    expect(payment.reference).toMatch(/^RCV-11112026-\d{3}$/);
    const paidMap = await getInvoicePaidMap("sales");
    expect(paidMap["inv-1"]).toBe(100000);

    const receivables = await getReceivablesSummary(TODAY);
    expect(receivables.collected).toBe(100000);
    expect(receivables.outstanding).toBe(150000);
    expect(receivables.partialCount).toBe(1);

    const cash = await getCashSummary();
    expect(cash.liquidity).toBe(100000);
    expect(cash.receipts).toBe(100000);
  });

  it("calculates the balance correctly over multiple payments", async () => {
    addCustomer("cust-1", "شركة");
    addSalesInvoice("inv-1", "INV-11112026-001", 250000, "cust-1");
    const accountId = await defaultAccount();

    // The specification's own example (§6.2): 100,000 + 50,000 + 100,000.
    // The third payment is identical to the first, so it requires explicit
    // confirmation — that is the "explicit user intent" of §12.8.
    await recordCustomerReceipt({
      customerId: "cust-1",
      amount: 100000,
      paidAt: TODAY,
      accountId,
      allocations: [{ invoiceId: "inv-1", amount: 100000 }],
    });
    await recordCustomerReceipt({
      customerId: "cust-1",
      amount: 50000,
      paidAt: TODAY,
      accountId,
      allocations: [{ invoiceId: "inv-1", amount: 50000 }],
    });
    // without confirmation the identical third payment is refused
    await expect(
      recordCustomerReceipt({
        customerId: "cust-1",
        amount: 100000,
        paidAt: TODAY,
        accountId,
        allocations: [{ invoiceId: "inv-1", amount: 100000 }],
      })
    ).rejects.toThrow(/مطابقة/);
    // with confirmation it is recorded
    await recordCustomerReceipt({
      customerId: "cust-1",
      amount: 100000,
      paidAt: TODAY,
      accountId,
      allocations: [{ invoiceId: "inv-1", amount: 100000 }],
      confirmDuplicate: true,
    });

    const paidMap = await getInvoicePaidMap("sales");
    expect(paidMap["inv-1"]).toBe(250000);
    const receivables = await getReceivablesSummary(TODAY);
    expect(receivables.outstanding).toBe(0);
    expect((await getCashSummary()).liquidity).toBe(250000);
  });

  it("refuses an allocation beyond the invoice outstanding", async () => {
    addCustomer("cust-1", "شركة");
    addSalesInvoice("inv-1", "INV-11112026-001", 100000, "cust-1");
    const accountId = await defaultAccount();

    await expect(
      recordCustomerReceipt({
        customerId: "cust-1",
        amount: 150000,
        paidAt: TODAY,
        accountId,
        allocations: [{ invoiceId: "inv-1", amount: 150000 }],
      })
    ).rejects.toThrow(/يتجاوز المتبقي/);

    // nothing was recorded
    expect((await getCashSummary()).liquidity).toBe(0);
    expect(db.count("customer_payments")).toBe(0);
  });

  it("refuses an identical payment until explicitly confirmed", async () => {
    addCustomer("cust-1", "شركة");
    addSalesInvoice("inv-1", "INV-11112026-001", 250000, "cust-1");
    const accountId = await defaultAccount();
    const payload = {
      customerId: "cust-1",
      amount: 100000,
      paidAt: TODAY,
      accountId,
      allocations: [{ invoiceId: "inv-1", amount: 100000 }],
    };

    await recordCustomerReceipt(payload);
    await expect(recordCustomerReceipt(payload)).rejects.toThrow(/مطابقة/);

    // with explicit intent it is accepted
    const confirmed = await recordCustomerReceipt({ ...payload, confirmDuplicate: true });
    expect(confirmed.payment.reference).toMatch(/^RCV-11112026-\d{3}$/);
    expect(db.count("customer_payments")).toBe(2);
  });

  it("records an advance payment without allocating it", async () => {
    addCustomer("cust-1", "شركة");
    const accountId = await defaultAccount();

    const { payment } = await recordCustomerReceipt({
      customerId: "cust-1",
      amount: 75000,
      paidAt: TODAY,
      accountId,
    });
    expect(payment.allocations).toEqual([]);
    expect((await getCashSummary()).liquidity).toBe(75_000);
    // an advance is money received, not revenue
    expect((await getReceivablesSummary(TODAY)).invoiced).toBe(0);
  });

  it("reverses its cash effect exactly once on cancellation", async () => {
    addCustomer("cust-1", "شركة");
    addSalesInvoice("inv-1", "INV-11112026-001", 250000, "cust-1");
    const accountId = await defaultAccount();

    const { payment } = await recordCustomerReceipt({
      customerId: "cust-1",
      amount: 100000,
      paidAt: TODAY,
      accountId,
      allocations: [{ invoiceId: "inv-1", amount: 100000 }],
    });
    expect((await getCashSummary()).liquidity).toBe(100000);

    await cancelPayment("receipt", payment.id, "خطأ في الإدخال");

    expect((await getCashSummary()).liquidity).toBe(0);
    expect((await getReceivablesSummary(TODAY)).collected).toBe(0);
    // the record is kept and audited, not deleted
    expect(db.count("customer_payments")).toBe(1);
    expect((await listAuditEntries("customer_payment", payment.id)).map((e) => e.action)).toContain("cancel");
  });
});

describe("Suppliers and purchase obligations (PRD §7, §17)", () => {
  it("creates an obligation without moving cash", async () => {
    const supplier = await createSupplier({ name: "مطبعة النور" }, NOW);
    addPurchaseInvoice("pinv-1", "PINV-11112026-001", 120000, supplier.id);

    const account = await getSupplierAccount(supplier.id);
    expect(account.totalObligations).toBe(120000);
    expect(account.totalPaid).toBe(0);
    expect(account.outstanding).toBe(120000);

    expect((await getCashSummary()).payments).toBe(0);
    const payables = await getPayablesSummary();
    expect(payables.purchased).toBe(120000);
    expect(payables.outstanding).toBe(120000);
  });

  it("reduces the supplier balance and the account balance on payment", async () => {
    const supplier = await createSupplier({ name: "مطبعة النور" }, NOW);
    addPurchaseInvoice("pinv-1", "PINV-11112026-001", 120000, supplier.id);
    const accountId = await defaultAccount();

    const { payment } = await recordSupplierPayment({
      supplierId: supplier.id,
      amount: 70000,
      paidAt: TODAY,
      accountId,
      allocations: [{ invoiceId: "pinv-1", amount: 70000 }],
    });
    expect(payment.reference).toMatch(/^PAY-11112026-\d{3}$/);

    const account = await getSupplierAccount(supplier.id);
    expect(account.totalPaid).toBe(70000);
    expect(account.outstanding).toBe(50000);
    expect(account.invoices[0].settlement.status).toBe("partially_paid");

    const cash = await getCashSummary();
    expect(cash.liquidity).toBe(-70000);
    expect(cash.payments).toBe(70000);

    await recordSupplierPayment({
      supplierId: supplier.id,
      amount: 50000,
      paidAt: TODAY,
      accountId,
      allocations: [{ invoiceId: "pinv-1", amount: 50000 }],
    });
    expect((await getSupplierAccount(supplier.id)).outstanding).toBe(0);
    expect((await getPayablesSummary()).outstanding).toBe(0);
  });
});

describe("Expenses: recorded is not paid (PRD §7.5, §17)", () => {
  it("adds a direct cost without marking it paid and without moving cash", async () => {
    const accountId = await defaultAccount();
    const expense = await createExpense(
      { kind: "direct", beneficiary: "فريق التركيب", amount: 25000, expenseDate: TODAY },
      NOW
    );

    expect(expense.amount).toBe(25000);
    expect((await getCashSummary()).payments).toBe(0);
    expect((await getCashSummary()).liquidity).toBe(0);

    // it does count as a recorded cost
    const profitability = await getCompanyProfitability();
    expect(profitability.directCosts).toBe(25000);
    expect(accountId).toBeTruthy();
  });

  it("records the outgoing movement when the expense is settled", async () => {
    const accountId = await defaultAccount();
    const expense = await createExpense(
      { kind: "direct", beneficiary: "فريق التركيب", amount: 25000, expenseDate: TODAY },
      NOW
    );

    const payment = await payExpense(
      { expenseId: expense.id, amount: 25000, paidAt: TODAY, accountId, method: "cash" },
      NOW
    );
    expect(payment.reference).toMatch(/^EXP-11112026-\d{3}$/);
    expect((await getCashSummary()).liquidity).toBe(-25000);
    expect((await getCashSummary()).payments).toBe(25000);
  });

  it("refuses settling more than the outstanding expense", async () => {
    const accountId = await defaultAccount();
    const expense = await createExpense(
      { kind: "operating", beneficiary: "إيجار", amount: 10000, expenseDate: TODAY },
      NOW
    );
    await payExpense({ expenseId: expense.id, amount: 4000, paidAt: TODAY, accountId }, NOW);
    await expect(
      payExpense({ expenseId: expense.id, amount: 7000, paidAt: TODAY, accountId }, NOW)
    ).rejects.toThrow(/تتجاوز المتبقي/);
  });

  it("allows direct expenses without projectId and keeps directCosts separate from operatingExpenses", async () => {
    const direct = await createExpense(
      { kind: "direct", beneficiary: "تنفيذ وتركيب", amount: 15000, expenseDate: TODAY },
      NOW
    );
    const operating = await createExpense(
      { kind: "operating", beneficiary: "كهرباء وإيجار", amount: 8000, expenseDate: TODAY },
      NOW
    );

    expect(direct.kind).toBe("direct");
    expect(operating.kind).toBe("operating");

    const profitability = await getCompanyProfitability();
    expect(profitability.directCosts).toBe(15000);
    expect(profitability.operatingExpenses).toBe(8000);
  });
});

describe("Internal transfers (PRD §10.1, §12.11)", () => {
  it("moves money between accounts without creating revenue or expense", async () => {
    // give the cash account some money first
    addCustomer("cust-1", "شركة");
    const cashId = await defaultAccount();
    await recordCustomerReceipt({ customerId: "cust-1", amount: 100000, paidAt: TODAY, accountId: cashId });

    const { createAccount } = await import("@/lib/repositories/FinancialAccountRepository");
    const bank = await createAccount({ name: "حساب بنكي", kind: "bank" }, );

    const profitabilityBefore = await getCompanyProfitability();
    await recordTransfer({ fromAccountId: cashId, toAccountId: bank.id, amount: 40000, occurredAt: TODAY }, NOW);
    const profitabilityAfter = await getCompanyProfitability();

    // revenue, costs and profit are untouched by the transfer
    expect(profitabilityAfter).toEqual(profitabilityBefore);

    const balances = await getAccountBalances();
    const cash = balances.find((b) => b.account.id === cashId)!;
    const bankBalance = balances.find((b) => b.account.id === bank.id)!;
    expect(cash.balance).toBe(60000);
    expect(bankBalance.balance).toBe(40000);
    // total liquidity is unchanged by an internal transfer
    expect((await getCashSummary()).liquidity).toBe(100000);
  });

  it("refuses a transfer to the same account or with a zero amount", async () => {
    const cashId = await defaultAccount();
    await expect(
      recordTransfer({ fromAccountId: cashId, toAccountId: cashId, amount: 100, occurredAt: TODAY }, NOW)
    ).rejects.toThrow(/الحساب نفسه/);
    await expect(
      recordTransfer({ fromAccountId: cashId, toAccountId: "other", amount: 0, occurredAt: TODAY }, NOW)
    ).rejects.toThrow(/أكبر من صفر/);
  });
});

describe("Company profitability keeps the three dimensions apart (PRD §8, §9)", () => {
  it("separates revenue, collections and liquidity", async () => {
    addCustomer("cust-1", "شركة");
    const supplier = await createSupplier({ name: "مطبعة" }, NOW);
    addSalesInvoice("inv-1", "INV-11112026-001", 250000, "cust-1");
    addPurchaseInvoice("pinv-1", "PINV-11112026-001", 170000, supplier.id);
    const accountId = await defaultAccount();

    await createExpense({ kind: "operating", beneficiary: "إيجار المكتب", amount: 20000, expenseDate: TODAY }, NOW);
    await recordCustomerReceipt({
      customerId: "cust-1",
      amount: 100000,
      paidAt: TODAY,
      accountId,
      allocations: [{ invoiceId: "inv-1", amount: 100000 }],
    });

    const profitability = await getCompanyProfitability();
    expect(profitability.revenue).toBe(250000);
    expect(profitability.directCosts).toBe(170000);
    expect(profitability.operatingExpenses).toBe(20000);
    expect(profitability.grossMargin).toBe(80000);
    expect(profitability.netProfit).toBe(60000);

    const cash = await getCashSummary();
    // only actual collection is liquidity — never the invoice amount
    expect(cash.receipts).toBe(100000);
    expect(cash.liquidity).toBe(100000);

    const receivables = await getReceivablesSummary(TODAY);
    expect(receivables.outstanding).toBe(150000);
  });
});

describe("Phase 3 production guards & multi-currency durability", () => {
  it("persists USD receipts separately and rejects mixed-currency allocations", async () => {
    addCustomer("cust-usd", "شركة الدولار");
    db.db
      .prepare(
        `INSERT INTO custom_invoices
          (id, serial, type, date, party_name, customer_id, language, currency, total_amount, created_at, updated_at, reference)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
      )
      .run("inv-usd-1", "001", "sales", TODAY, "شركة الدولار", "cust-usd", "en", "USD", 500, NOW, NOW, "26-0010");

    const { createAccount } = await import("@/lib/repositories/FinancialAccountRepository");
    const usdBank = await createAccount({ name: "خزينة دولار", kind: "bank", currency: "USD" }, NOW as any);

    await expect(
      recordCustomerReceipt({
        customerId: "cust-usd",
        amount: 200,
        currency: "SDG",
        paidAt: TODAY,
        accountId: usdBank.id,
        allocations: [{ invoiceId: "inv-usd-1", amount: 200 }],
      })
    ).rejects.toThrow(/عملة السند/);

    const receipt = await recordCustomerReceipt({
      customerId: "cust-usd",
      amount: 200,
      currency: "USD",
      paidAt: TODAY,
      accountId: usdBank.id,
      allocations: [{ invoiceId: "inv-usd-1", amount: 200 }],
    });
    expect(receipt.payment.currency).toBe("USD");
    expect((await getCashSummary("USD")).liquidity).toBe(200);
    expect((await getCashSummary("SDG")).liquidity).toBe(0);
    expect((await getReceivablesSummary(TODAY, "USD")).outstanding).toBe(300);
  });

  it("blocks cancelling or under-editing paid invoices/expenses and cleanly reverses expense_payment", async () => {
    addCustomer("cust-guard", "عميل محمي");
    await upsertCustomInvoice({
      id: "inv-guard-1",
      meta: { serial: "011", type: "sales", date: TODAY, partyName: "عميل محمي", language: "ar", currency: "SDG" },
      items: [{ id: "it-guard-1", description: "بند", qty: 1, unitPrice: 1000, total: 1000 }],
      totalAmount: 1000,
      currency: "SDG",
      customerId: "cust-guard",
      createdAt: NOW,
      updatedAt: NOW,
    });
    const cashId = await defaultAccount();
    await recordCustomerReceipt({
      customerId: "cust-guard",
      amount: 600,
      paidAt: TODAY,
      accountId: cashId,
      allocations: [{ invoiceId: "inv-guard-1", amount: 600 }],
    });

    await expect(cancelCustomInvoice("inv-guard-1", "test")).rejects.toThrow(/سدادات نشطة/);
    await expect(
      upsertCustomInvoice({
        id: "inv-guard-1",
        meta: { serial: "011", type: "sales", date: TODAY, partyName: "عميل محمي", language: "ar", currency: "SDG" },
        items: [{ id: "it-guard-1", description: "بند", qty: 1, unitPrice: 400, total: 400 }],
        totalAmount: 400,
        currency: "SDG",
        customerId: "cust-guard",
        createdAt: NOW,
        updatedAt: NOW,
      })
    ).rejects.toThrow(/أقل من المبلغ المسدّد/);

    const expense = await createExpense(
      { kind: "operating", beneficiary: "صيانة", amount: 500, expenseDate: TODAY },
      NOW
    );
    const expPay = await payExpense({ expenseId: expense.id, amount: 500, paidAt: TODAY, accountId: cashId }, NOW);

    await expect(cancelExpense(expense.id, "test", NOW)).rejects.toThrow(/سدادات نشطة/);
    await cancelPayment("expense_payment", expPay.id, "خطأ في القيد", NOW);
    expect((await getCashSummary()).liquidity).toBe(600);
    await expect(cancelExpense(expense.id, "تم إلغاء السداد", NOW)).resolves.toBeUndefined();
  });
});
