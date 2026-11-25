/**
 * الاختبار التكاملي الشامل من الطرف إلى الطرف (End-to-End Multi-Currency & Bank Ledger Suite)
 * يختبر دورة الحياة الكاملة عبر العملات الأربع (`SDG`, `USD`, `SAR`, `EGP`):
 * 1. تأسيس الرصيد البنكي الافتتاحي والمطابقة الذكية مع الرصيد البنكي الفعلي (مثال 1000 -> 1200) دون تشويه الإيرادات.
 * 2. السداد الجزئي والكلي لفواتير المبيعات بالدولار والعملات الأخرى عبر واجهة `ReceiptDialog`.
 * 3. السداد الجزئي والكلي لفواتير المشتريات (بما فيها فواتير المورد العابر غير المسجل مسبقاً) عبر `SupplierPaymentDialog`.
 * 4. الخصم الفوري للمصروفات العامة والتشغيلية غير المرتبطة بالفواتير عبر `ExpenseDialog` وسداد المصروف الجزئي المتبقي.
 * 5. مستطيل الرصيد البنكي بجوار رسالة الترحيب في `HomePage` والنافذة المنبثقة للحسابات الأربعة وكشف الحساب بنمط "بنكك".
 */
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const state = vi.hoisted(() => ({
  db: null as any,
  customers: [] as any[],
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

const navState = vi.hoisted(() => ({
  navigateSpy: vi.fn(),
  backSpy: vi.fn(),
  search: {} as Record<string, any>,
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to, ...rest }: any) => (
    <a href={typeof to === "string" ? to : "#"} {...rest}>
      {children}
    </a>
  ),
  useNavigate: () => navState.navigateSpy,
  useLocation: () => ({ pathname: "/" }),
  useSearch: () => navState.search,
  useRouter: () => ({ history: { back: navState.backSpy } }),
  useRouterState: () => ({ location: { pathname: "/" } }),
}));

vi.mock("@/components/layout/PageShell", () => ({
  PageShell: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="page-shell">{children}</div>
  ),
}));

vi.mock("@/lib/userProfileStore", () => ({
  useUserProfile: () => ({
    userName: "طارق عثمان",
    setUserName: vi.fn(),
  }),
}));

vi.mock("@/lib/customersStore", () => ({
  useCustomers: () => state.customers,
  addCustomer: async (data: any) => {
    const created = {
      ...data,
      id: `cust-auto-${state.customers.length + 1}`,
      totalOrders: 0,
      totalSpent: 0,
      createdAt: "2026-11-25T08:00:00.000Z",
    };
    state.db.db
      .prepare("INSERT OR REPLACE INTO customers(id, name, phone, created_at) VALUES(?,?,?,?)")
      .run(created.id, created.name, created.phone ?? "", created.createdAt);
    state.customers = [created, ...state.customers];
    return created;
  },
}));

import { CREATE_SCHEMA_V1, DB_VERSION } from "@/lib/database/schema";
import { runPendingMigrations } from "@/lib/database/migrations";
import { FixtureDatabase, closeAllFixtures } from "@/test/backup/fixtureDb";
import {
  ensureAccountForCurrency,
  getAccountBalances,
  reconcileBankAccountBalance,
  recordExternalBankMovement,
} from "@/lib/repositories/FinancialAccountRepository";
import {
  getBankAccountStatement,
  getCompanyProfitability,
  getCustomerAccount,
  getInvoiceSettlement,
} from "@/lib/repositories/LedgerRepository";
import { recordCustomerReceipt } from "@/lib/repositories/PaymentRepository";
import { createExpense, getExpensesWithSettlement, payExpense } from "@/lib/repositories/ExpenseRepository";
import { resetSettlementsForTests } from "@/lib/financeStore";
import { refreshBankTreasury, resetBankTreasuryForTests } from "@/lib/bankTreasuryStore";
import { ReceiptDialog } from "@/components/finance/ReceiptDialog";
import { SupplierPaymentDialog } from "@/components/finance/SupplierPaymentDialog";
import { ExpenseDialog } from "@/components/finance/ExpenseDialog";
import { HomePage } from "@/components/dashboard/HomePage";
import { BankAccountsPage } from "@/components/finance/BankAccountsPage";
import type { AppCurrency } from "@/lib/currency/types";

const NOW = "2026-11-25T09:00:00.000Z";
const TODAY = "2026-11-25";

let db: FixtureDatabase;

function seedCustomer(id: string, name: string, openingBalance = 0, openingCurrency: AppCurrency = "SDG") {
  db.db
    .prepare(
      `INSERT INTO customers(id, name, opening_balance, opening_balance_currency, created_at)
       VALUES(?,?,?,?,?)`
    )
    .run(id, name, openingBalance, openingCurrency, NOW);
  state.customers.push({
    id,
    name,
    phone: "",
    type: "company",
    address: "",
    balance: openingBalance,
    totalOrders: 0,
    totalSpent: 0,
    createdAt: NOW,
  });
}

function seedCustomInvoice(opts: {
  id: string;
  reference: string;
  type: "sales" | "purchase";
  partyName: string;
  customerId?: string | null;
  supplierId?: string | null;
  total: number;
  currency: AppCurrency;
  date?: string;
}) {
  db.db
    .prepare(
      `INSERT INTO custom_invoices
        (id, serial, reference, type, date, party_name, customer_id, supplier_id, language, currency, total_amount, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
    )
    .run(
      opts.id,
      opts.reference,
      opts.reference,
      opts.type,
      opts.date ?? TODAY,
      opts.partyName,
      opts.customerId ?? null,
      opts.supplierId ?? null,
      "ar",
      opts.currency,
      opts.total,
      NOW,
      NOW
    );
}

describe("End-to-End Multi-Currency Settlements & Bankak-Style 4-Currency Ledger", () => {
  beforeEach(async () => {
    closeAllFixtures();
    resetSettlementsForTests();
    resetBankTreasuryForTests();
    window.localStorage.clear();

    const dir = mkdtempSync(join(tmpdir(), "ta-e2e-bank-"));
    db = FixtureDatabase.open({ dir });
    db.applySchema(CREATE_SCHEMA_V1);
    db.db.prepare("INSERT OR REPLACE INTO db_meta(key, value) VALUES('schema_version','1')").run();
    const outcome = await runPendingMigrations(db, { nowIso: NOW });
    expect(outcome.warnings).toEqual([]);
    expect(outcome.to).toBe(DB_VERSION);

    state.db = db;
    state.customers = [];
  });

  afterEach(() => {
    cleanup();
    closeAllFixtures();
  });

  it("executes full USD lifecycle: initial bank balance -> external 1000->1200 reconciliation -> partial & full sales collection -> walk-in purchase partial payment -> general expense deduction -> statement & profitability integrity", async () => {
    seedCustomer("cust-usd", "شركة الأفق العالمية");
    const usdAccount = await ensureAccountForCurrency("USD", NOW);
    expect(usdAccount.currency).toBe("USD");

    // 1) Initial Bank Balance Setup: User enters $1,000 currently in their bank account
    const initRec = await reconcileBankAccountBalance(
      {
        accountId: usdAccount.id,
        actualBalance: 1000,
        occurredAt: "2026-11-20",
        notes: "الرصيد الفعلي الأولي في حساب الدولار",
      },
      NOW
    );
    expect(initRec.adjusted).toBe(true);
    expect(initRec.sourceType).toBe("opening_balance");
    expect(initRec.newBalance).toBe(1000);

    // 2) External Non-App Transfer (CEO Scenario: app shows 1000, external person transfers money -> bank has 1200)
    const extRec = await reconcileBankAccountBalance(
      {
        accountId: usdAccount.id,
        actualBalance: 1200,
        occurredAt: "2026-11-22",
        notes: "تحويل خارجي وارد من شريك خارج التطبيق",
      },
      NOW
    );
    expect(extRec.adjusted).toBe(true);
    expect(extRec.sourceType).toBe("bank_reconciliation");
    expect(extRec.delta).toBe(200);
    expect(extRec.newBalance).toBe(1200);

    // Accounting Guarantee: Neither opening balance nor external bank reconciliation pollutes Sales Revenue!
    const profitBeforeInvoices = await getCompanyProfitability("USD");
    expect(profitBeforeInvoices.revenue).toBe(0);
    expect(profitBeforeInvoices.netProfit).toBe(0);

    // 3) USD Sales Invoice ($500): Partial collection ($200) then Full remaining collection ($300) via ReceiptDialog UI
    seedCustomInvoice({
      id: "inv-usd-500",
      reference: "INV-USD-001",
      type: "sales",
      partyName: "شركة الأفق العالمية",
      customerId: "cust-usd",
      total: 500,
      currency: "USD",
    });

    const onReceipt1 = vi.fn();
    const { unmount: unmountReceipt1 } = render(
      <ReceiptDialog
        open={true}
        onOpenChange={() => {}}
        initialInvoiceId="inv-usd-500"
        onRecorded={onReceipt1}
      />
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "تسجيل التحصيل" })).not.toBeDisabled();
    });

    // Edit main amount from 500 -> 200 (Partial USD payment — previously broke with allocation > payment error!)
    const receiptInputs1 = screen.getAllByPlaceholderText("0") as HTMLInputElement[];
    expect(receiptInputs1[0].value).toBe("500");
    fireEvent.change(receiptInputs1[0], { target: { value: "200" } });

    fireEvent.click(screen.getByRole("button", { name: "تسجيل التحصيل" }));
    await waitFor(() => {
      expect(onReceipt1).toHaveBeenCalledTimes(1);
    });
    unmountReceipt1();

    const afterPartialSales = await getInvoiceSettlement("inv-usd-500", "sales");
    expect(afterPartialSales?.paid).toBe(200);
    expect(afterPartialSales?.outstanding).toBe(300);
    expect(afterPartialSales?.status).toBe("partially_paid");

    // Bank balance must now be 1200 + 200 = $1,400
    expect((await getBankAccountStatement({ currency: "USD", period: "all", today: TODAY })).currentBalance).toBe(1400);

    // Pay remaining $300 in full via ReceiptDialog UI
    const onReceipt2 = vi.fn();
    const { unmount: unmountReceipt2 } = render(
      <ReceiptDialog
        open={true}
        onOpenChange={() => {}}
        initialInvoiceId="inv-usd-500"
        onRecorded={onReceipt2}
      />
    );

    await waitFor(() => {
      const inputs = screen.getAllByPlaceholderText("0") as HTMLInputElement[];
      expect(inputs[0].value).toBe("300");
    });
    fireEvent.click(screen.getByRole("button", { name: "تسجيل التحصيل" }));
    await waitFor(() => {
      expect(onReceipt2).toHaveBeenCalledTimes(1);
    });
    unmountReceipt2();

    const afterFullSales = await getInvoiceSettlement("inv-usd-500", "sales");
    expect(afterFullSales?.status).toBe("fully_paid");
    expect(afterFullSales?.outstanding).toBe(0);
    // Bank balance: 1400 + 300 = $1,700
    expect((await getBankAccountStatement({ currency: "USD", period: "all", today: TODAY })).currentBalance).toBe(1700);

    // 4) Walk-In Purchase Invoice ($400 USD, supplierId = null) paid partially ($150) via SupplierPaymentDialog UI
    seedCustomInvoice({
      id: "pur-usd-400",
      reference: "PINV-USD-001",
      type: "purchase",
      partyName: "مؤسسة الخليج للأحبار",
      supplierId: null,
      total: 400,
      currency: "USD",
    });

    const onSupplierPay = vi.fn();
    const { unmount: unmountSup } = render(
      <SupplierPaymentDialog
        open={true}
        onOpenChange={() => {}}
        initialInvoiceId="pur-usd-400"
        onRecorded={onSupplierPay}
      />
    );

    await waitFor(() => {
      const inputs = screen.getAllByPlaceholderText("0") as HTMLInputElement[];
      expect(inputs[0].value).toBe("400");
      expect(screen.getByRole("button", { name: "تسجيل الدفعة" })).not.toBeDisabled();
    });

    const supInputs = screen.getAllByPlaceholderText("0") as HTMLInputElement[];
    fireEvent.change(supInputs[0], { target: { value: "150" } });
    fireEvent.click(screen.getByRole("button", { name: "تسجيل الدفعة" }));

    await waitFor(() => {
      expect(onSupplierPay).toHaveBeenCalledTimes(1);
    });
    unmountSup();

    const afterPartialPurchase = await getInvoiceSettlement("pur-usd-400", "purchase");
    expect(afterPartialPurchase?.paid).toBe(150);
    expect(afterPartialPurchase?.outstanding).toBe(250);
    expect(afterPartialPurchase?.status).toBe("partially_paid");

    // Bank balance: 1700 - 150 = $1,550
    expect((await getBankAccountStatement({ currency: "USD", period: "all", today: TODAY })).currentBalance).toBe(1550);

    // 5) General Operating Expense ($50 USD, unrelated to any invoice) via ExpenseDialog UI -> Immediate Bank Deduction
    const onExpenseSaved = vi.fn();
    const { unmount: unmountExp } = render(
      <ExpenseDialog
        open={true}
        onOpenChange={() => {}}
        defaultCurrency="USD"
        onSaved={onExpenseSaved}
      />
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "حفظ وخصم من الرصيد" })).not.toBeDisabled();
    });

    const expAmountInput = screen.getByPlaceholderText("0") as HTMLInputElement;
    fireEvent.change(expAmountInput, { target: { value: "50" } });
    fireEvent.change(
      screen.getByPlaceholderText("إيجار، كهرباء، وقود، عمولة، سائق…"),
      { target: { value: "اشتراك إنترنت واستضافة" } }
    );
    fireEvent.click(screen.getByRole("button", { name: "حفظ وخصم من الرصيد" }));

    await waitFor(() => {
      expect(onExpenseSaved).toHaveBeenCalledTimes(1);
    });
    unmountExp();

    // Final USD Bank Balance: 1550 - 50 = $1,500
    const fullStatement = await getBankAccountStatement({
      currency: "USD",
      period: "all",
      today: TODAY,
    });
    expect(fullStatement.currentBalance).toBe(1500);
    expect(fullStatement.totalCount).toBe(6); // 1000 + 200 + 200 + 300 - 150 - 50
    expect(fullStatement.periodInflow).toBe(1700);
    expect(fullStatement.periodOutflow).toBe(200);

    // Verify period filter "last5" returns exactly 5 newest transactions
    const last5Statement = await getBankAccountStatement({
      currency: "USD",
      period: "last5",
      today: TODAY,
    });
    expect(last5Statement.items).toHaveLength(5);
    expect(last5Statement.items[0].direction).toBe("out");
    expect(last5Statement.items[0].amount).toBe(50);
    expect(last5Statement.items[0].runningBalance).toBe(1500);

    // Verify Company Profitability in USD remains 100% pure:
    // Revenue = 500 (sales invoice), DirectCosts = 400 (purchase invoice), OperatingExpenses = 50, NetProfit = 50
    const finalProfit = await getCompanyProfitability("USD");
    expect(finalProfit.revenue).toBe(500);
    expect(finalProfit.directCosts).toBe(400);
    expect(finalProfit.operatingExpenses).toBe(50);
    expect(finalProfit.netProfit).toBe(50);
  });

  it("navigates from HomePage Bank Balance rectangle to dedicated full-page BankAccountsPage (zero modal) and renders 4-currency cards + responsive BankStatementView with zero -0 and exact accounting figures", async () => {
    navState.navigateSpy.mockReset();
    navState.backSpy.mockReset();
    navState.search = {};

    const sdgAcc = await ensureAccountForCurrency("SDG", NOW);
    const usdAcc = await ensureAccountForCurrency("USD", NOW);
    const sarAcc = await ensureAccountForCurrency("SAR", NOW);
    const egpAcc = await ensureAccountForCurrency("EGP", NOW);

    // Reference accounting verification from Executive Order §14:
    // Opening: 15,000,000 SDG + Sales Collection: 5,550 SDG - Operating Expense: 150,000 SDG = 14,855,550 SDG
    seedCustomer("cust-sdg-ref", "عميل مرجعي");
    await reconcileBankAccountBalance({ accountId: sdgAcc.id, actualBalance: 15000000, occurredAt: TODAY }, NOW);
    await recordCustomerReceipt(
      {
        customerId: "cust-sdg-ref",
        amount: 5550,
        currency: "SDG",
        paidAt: TODAY,
        method: "bank_transfer",
        accountId: sdgAcc.id,
      },
      NOW
    );
    const opExp = await createExpense(
      {
        kind: "operating",
        beneficiary: "مصروف تشغيلي",
        amount: 150000,
        currency: "SDG",
        expenseDate: TODAY,
      },
      NOW
    );
    await payExpense(
      {
        expenseId: opExp.id,
        amount: 150000,
        currency: "SDG",
        paidAt: TODAY,
        method: "bank_transfer",
        accountId: sdgAcc.id,
      },
      NOW
    );

    await reconcileBankAccountBalance({ accountId: usdAcc.id, actualBalance: 1200, occurredAt: TODAY }, NOW);
    await reconcileBankAccountBalance({ accountId: sarAcc.id, actualBalance: 4500, occurredAt: TODAY }, NOW);
    await reconcileBankAccountBalance({ accountId: egpAcc.id, actualBalance: 30000, occurredAt: TODAY }, NOW);
    await recordExternalBankMovement({
      accountId: usdAcc.id,
      direction: "out",
      amount: 25,
      occurredAt: TODAY,
      notes: "عمولة تحويل بنكي دولي",
    });

    await refreshBankTreasury();

    const { unmount: unmountHome } = render(<HomePage />);

    // 1) Greeting + Bank Balance rectangle exist side by side; ZERO modal/dialog rendered
    expect(screen.getByText(/طارق عثمان/)).toBeInTheDocument();
    const widget = screen.getByTestId("bank-balance-greeting-widget");
    expect(widget).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    // Default SDG balance (14,855,550 ج.س) with Bankak account #3283046
    await waitFor(() => {
      expect(within(widget).getByTestId("bank-greeting-live-balance")).toHaveTextContent("14,855,550");
      expect(within(widget).getByText("#3283046")).toBeInTheDocument();
    });

    // Click widget -> navigates to dedicated /bank-accounts full page (view: accounts)
    fireEvent.click(widget);
    expect(navState.navigateSpy).toHaveBeenCalledWith({
      to: "/bank-accounts",
      search: { view: "accounts", currency: "SDG", from: "/" },
    });

    // Switch currency pill to USD -> shows 1,175 $, click "كشف الحساب" -> navigates directly to dedicated statement view
    fireEvent.click(within(widget).getByTestId("widget-currency-pill-USD"));
    await waitFor(() => {
      expect(within(widget).getByTestId("bank-greeting-live-balance")).toHaveTextContent("1,175");
    });
    fireEvent.click(within(widget).getByTestId("bank-greeting-direct-statement-btn"));
    expect(navState.navigateSpy).toHaveBeenCalledWith({
      to: "/bank-accounts",
      search: { view: "statement", currency: "USD", from: "/" },
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    unmountHome();

    // 2) Render Dedicated BankAccountsPage (Accounts view) -> 4 cards, single Back button, ZERO dialog/modal
    const { unmount: unmountAccounts } = render(
      <BankAccountsPage initialViewOverride="accounts" initialCurrencyOverride="SDG" />
    );
    const page = screen.getByTestId("bank-accounts-page");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(within(page).getByTestId("bank-accounts-back-btn")).toBeInTheDocument();
    expect(within(page).getByTestId("bank-card-balance-SDG")).toHaveTextContent("14,855,550");
    expect(within(page).getByTestId("bank-card-balance-USD")).toHaveTextContent("1,175");
    expect(within(page).getByTestId("bank-card-balance-SAR")).toHaveTextContent("4,500");
    expect(within(page).getByTestId("bank-card-balance-EGP")).toHaveTextContent("30,000");

    // Clicking balance button on SDG card navigates directly to SDG statement view (UX-001)
    fireEvent.click(within(page).getByTestId("bank-card-balance-SDG"));
    expect(navState.navigateSpy).toHaveBeenCalledWith({
      to: "/bank-accounts",
      search: { view: "statement", currency: "SDG", from: undefined },
    });
    unmountAccounts();

    // 3) Render Dedicated BankAccountsPage (Statement view for SDG & SAR zero-outflow check)
    const { unmount: unmountStmtSdg } = render(
      <BankAccountsPage initialViewOverride="statement" initialCurrencyOverride="SDG" />
    );
    const sdgStmt = await screen.findByTestId("bank-statement-view-SDG");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    // All 5 period filter tabs exist inside flex-wrap bar (no horizontal overflow-x-auto)
    const tabsBar = within(sdgStmt).getByTestId("bank-statement-period-tabs");
    expect(tabsBar.className).toContain("flex-wrap");
    expect(tabsBar.className).not.toContain("overflow-x-auto");
    expect(within(sdgStmt).getByTestId("statement-tab-last5")).toBeInTheDocument();
    expect(within(sdgStmt).getByTestId("statement-tab-7d")).toBeInTheDocument();
    expect(within(sdgStmt).getByTestId("statement-tab-30d")).toBeInTheDocument();
    expect(within(sdgStmt).getByTestId("statement-tab-90d")).toBeInTheDocument();
    expect(within(sdgStmt).getByTestId("statement-tab-all")).toBeInTheDocument();

    await waitFor(() => {
      expect(within(sdgStmt).getByTestId("statement-summary-balance")).toHaveTextContent("14,855,550");
      expect(within(sdgStmt).getByTestId("statement-summary-inflow")).toHaveTextContent("+15,005,550");
      expect(within(sdgStmt).getByTestId("statement-summary-outflow")).toHaveTextContent("-150,000");
    });
    unmountStmtSdg();

    // SAR has 4,500 inflow and 0 outflow -> MUST display "0" and NEVER "-0" (UX-004)
    render(<BankAccountsPage initialViewOverride="statement" initialCurrencyOverride="SAR" />);
    const sarStmt = await screen.findByTestId("bank-statement-view-SAR");
    await waitFor(() => {
      const outflowEl = within(sarStmt).getByTestId("statement-summary-outflow");
      expect(outflowEl.textContent).not.toContain("-0");
      expect(outflowEl).toHaveTextContent("0");
    });
  });

  it("prevents cross-currency duplicate false positives, respects customer opening_balance, and settles partially-paid expenses cleanly across SAR & EGP", async () => {
    seedCustomer("cust-multi", "عميل متعدد العملات", 400, "SAR");

    // Customer opening_balance in SAR (400) is reflected in getCustomerAccount("SAR") and NOT leaked into EGP
    const sarSummary = await getCustomerAccount("cust-multi", "SAR");
    const egpSummary = await getCustomerAccount("cust-multi", "EGP");
    expect(sarSummary.outstanding).toBe(400);
    expect(egpSummary.outstanding).toBe(0);

    const sdgAcc = await ensureAccountForCurrency("SDG", NOW);
    const usdAcc = await ensureAccountForCurrency("USD", NOW);

    // Same customer pays 100 SDG and 100 USD on the exact same day with the same method -> MUST NOT throw DUPLICATE_PAYMENT!
    const r1 = await recordCustomerReceipt({
      customerId: "cust-multi",
      amount: 100,
      currency: "SDG",
      paidAt: TODAY,
      method: "bank_transfer",
      accountId: sdgAcc.id,
    });
    const r2 = await recordCustomerReceipt({
      customerId: "cust-multi",
      amount: 100,
      currency: "USD",
      paidAt: TODAY,
      method: "bank_transfer",
      accountId: usdAcc.id,
    });
    expect(r1.payment.currency).toBe("SDG");
    expect(r2.payment.currency).toBe("USD");

    // Partially paid EGP expense -> ExpenseDialog pre-fills remaining 180 EGP (not original 300 EGP!)
    const egpAcc = await ensureAccountForCurrency("EGP", NOW);
    const exp = await createExpense({
      kind: "direct",
      beneficiary: "ورشة طباعة",
      amount: 300,
      currency: "EGP",
      expenseDate: TODAY,
    });
    await payExpense({
      expenseId: exp.id,
      amount: 120,
      currency: "EGP",
      paidAt: TODAY,
      method: "bank_transfer",
      accountId: egpAcc.id,
    });

    const [expWithSettlement] = await getExpensesWithSettlement(undefined, "EGP");
    expect(expWithSettlement.settlement.outstanding).toBe(180);

    const onSettleSaved = vi.fn();
    render(
      <ExpenseDialog
        open={true}
        onOpenChange={() => {}}
        settleExpense={expWithSettlement}
        onSaved={onSettleSaved}
      />
    );

    await waitFor(() => {
      const input = screen.getByDisplayValue("180") as HTMLInputElement;
      expect(input).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "تسجيل السداد" }));
    await waitFor(() => {
      expect(onSettleSaved).toHaveBeenCalledTimes(1);
    });

    const [afterSettle] = await getExpensesWithSettlement(undefined, "EGP");
    expect(afterSettle.settlement.status).toBe("fully_paid");
    expect(afterSettle.settlement.outstanding).toBe(0);

    // Verify all 4 accounts maintain completely independent balances
    const allBalances = await getAccountBalances();
    const byCur = Object.fromEntries(allBalances.map((b) => [b.account.currency, b.balance]));
    expect(byCur.SDG).toBe(100);
    expect(byCur.USD).toBe(100);
    expect(byCur.SAR).toBe(0);
    expect(byCur.EGP).toBe(-300);
  });
});
