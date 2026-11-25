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

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to, ...rest }: any) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock("@/components/layout/PageShell", () => ({
  PageShell: ({ children }: { children: React.ReactNode }) => <div data-testid="page-shell">{children}</div>,
}));

vi.mock("@/lib/customersStore", () => ({
  useCustomers: () => state.customers,
  addCustomer: async (data: any) => {
    const created = {
      ...data,
      id: `cust-new-${state.customers.length + 1}`,
      totalOrders: 0,
      totalSpent: 0,
      createdAt: "2026-11-12T08:00:00.000Z",
    };
    state.db.db
      .prepare("INSERT OR REPLACE INTO customers(id, name, created_at) VALUES(?,?,?)")
      .run(created.id, created.name, created.createdAt);
    state.customers = [created, ...state.customers];
    return created;
  },
}));

import { CREATE_SCHEMA_V1 } from "@/lib/database/schema";
import { runPendingMigrations } from "@/lib/database/migrations";
import { FixtureDatabase, closeAllFixtures } from "@/test/backup/fixtureDb";
import { createAccount, getDefaultAccountId } from "@/lib/repositories/FinancialAccountRepository";
import { getCustomerReceipts, getOpenSalesInvoices } from "@/lib/repositories/LedgerRepository";
import { createSupplier } from "@/lib/repositories/SupplierRepository";
import { createExpense } from "@/lib/repositories/ExpenseRepository";
import { ReceiptDialog } from "./ReceiptDialog";
import { SupplierPaymentDialog } from "./SupplierPaymentDialog";
import { ExpenseDialog } from "./ExpenseDialog";
import { TransferDialog } from "./TransferDialog";
import { FinancePage } from "./FinancePage";

const NOW = "2026-11-12T08:00:00.000Z";
const TODAY = "2026-11-12";

let db: FixtureDatabase;

function seedCustomer(id: string, name: string) {
  db.db.prepare("INSERT INTO customers(id, name, created_at) VALUES(?,?,?)").run(id, name, NOW);
  state.customers.push({
    id,
    name,
    phone: "0912345678",
    type: "company",
    address: "",
    totalOrders: 0,
    totalSpent: 0,
    balance: 0,
    createdAt: NOW,
  });
}

function seedSalesInvoice(
  id: string,
  reference: string,
  customerId: string | null,
  customerName: string,
  total: number,
  currency: "SDG" | "USD" | "SAR" | "EGP" = "SDG"
) {
  db.db
    .prepare(
      `INSERT INTO custom_invoices(id, serial, reference, type, date, customer_id, party_name, total_amount, currency, created_at, updated_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?)`
    )
    .run(id, reference, reference, "sales", TODAY, customerId, customerName, total, currency, NOW, NOW);
}

function seedPurchaseInvoice(
  id: string,
  reference: string,
  supplierId: string,
  supplierName: string,
  total: number,
  currency: "SDG" | "USD" | "SAR" | "EGP" = "SDG"
) {
  db.db
    .prepare(
      `INSERT INTO custom_invoices(id, serial, reference, type, date, supplier_id, party_name, total_amount, currency, created_at, updated_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?)`
    )
    .run(id, reference, reference, "purchase", TODAY, supplierId, supplierName, total, currency, NOW, NOW);
}

beforeEach(async () => {
  closeAllFixtures();
  state.customers = [];
  const dir = mkdtempSync(join(tmpdir(), "ta-fin-ui-"));
  db = FixtureDatabase.open({ dir });
  db.applySchema(CREATE_SCHEMA_V1);
  db.db.prepare("INSERT OR REPLACE INTO db_meta(key, value) VALUES('schema_version','1')").run();
  await runPendingMigrations(db, { nowIso: NOW });
  state.db = db;
  await getDefaultAccountId();

  seedCustomer("cust-1", "شركة النور");
  seedSalesInvoice("inv-1", "261112S001", "cust-1", "شركة النور", 1000);
  seedSalesInvoice("inv-2", "261112S002", "cust-1", "شركة النور", 500);
});

afterEach(() => {
  cleanup();
  closeAllFixtures();
});

describe("ReceiptDialog & FinancePage integration", () => {
  it("returns customerId in getOpenSalesInvoices", async () => {
    const open = await getOpenSalesInvoices();
    expect(open).toHaveLength(2);
    expect(open[0].customerId).toBe("cust-1");
    expect(open[0].settlement.outstanding).toBeGreaterThan(0);
  });

  it("pre-fills amount & allocation without resetting user edits in an infinite loop", async () => {
    const onRecorded = vi.fn();
    const onOpenChange = vi.fn();

    render(
      <ReceiptDialog
        open={true}
        onOpenChange={onOpenChange}
        initialInvoiceId="inv-1"
        onRecorded={onRecorded}
      />
    );

    await waitFor(() => {
      const inputs = screen.getAllByPlaceholderText("0") as HTMLInputElement[];
      expect(inputs.length).toBeGreaterThanOrEqual(2);
      expect(inputs[0].value).toBe("1000");
    });

    await waitFor(() => {
      expect(screen.getByText(/مفوتر 1,500/)).toBeInTheDocument();
    });

    const amountInput = screen.getAllByPlaceholderText("0")[0] as HTMLInputElement;

    // تعديل المبلغ والملاحظات والتأكد أنها لا تُمسح بعد دورات render إضافية
    fireEvent.change(amountInput, { target: { value: "600" } });
    const notesInput = screen.getByPlaceholderText("رقم إيصال، اسم المسلّم، أو ملاحظة…") as HTMLInputElement;
    fireEvent.change(notesInput, { target: { value: "دفعة أولى" } });

    await new Promise((r) => setTimeout(r, 80));
    expect(amountInput.value).toBe("600");
    expect(notesInput.value).toBe("دفعة أولى");

    // إضافة صف تخصيص ثانٍ — يجب أن يختار الفاتورة غير المخصصة الثانية (ليس تكرار الأولى)
    fireEvent.click(screen.getByRole("button", { name: /إضافة فاتورة/i }));
    await waitFor(() => {
      const allocationInputs = screen.getAllByPlaceholderText("0");
      // 1 main amount + 2 row allocation inputs
      expect(allocationInputs.length).toBe(3);
    });
  });

  it("records a customer receipt and uses inline duplicate confirmation instead of window.confirm", async () => {
    const confirmSpy = vi.spyOn(window, "confirm");
    const onRecorded = vi.fn();
    const onOpenChange = vi.fn();

    const { rerender } = render(
      <ReceiptDialog
        open={true}
        onOpenChange={onOpenChange}
        initialInvoiceId="inv-2"
        onRecorded={onRecorded}
      />
    );

    await waitFor(() => {
      const inputs = screen.getAllByPlaceholderText("0") as HTMLInputElement[];
      expect(inputs[0].value).toBe("500");
    });

    // تقليل المبلغ حتى تظل الفاتورة مفتوحة بعد السداد الأول ثم محاولة دفعة مطابقة
    fireEvent.change(screen.getAllByPlaceholderText("0")[0], { target: { value: "200" } });
    fireEvent.change(screen.getAllByPlaceholderText("0")[1], { target: { value: "200" } });

    fireEvent.click(screen.getByRole("button", { name: "تسجيل التحصيل" }));

    await waitFor(() => {
      expect(onRecorded).toHaveBeenCalledTimes(1);
    });

    // فتح مرة ثانية بنفس القيمة -> يجب إظهار تنبيه التكرار داخل الحوار لا window.confirm
    rerender(
      <ReceiptDialog
        open={false}
        onOpenChange={onOpenChange}
        initialInvoiceId="inv-2"
        onRecorded={onRecorded}
      />
    );
    rerender(
      <ReceiptDialog
        open={true}
        onOpenChange={onOpenChange}
        initialInvoiceId="inv-2"
        onRecorded={onRecorded}
      />
    );

    await waitFor(() => {
      expect(screen.getAllByPlaceholderText("0").length).toBeGreaterThan(1);
    });
    fireEvent.change(screen.getAllByPlaceholderText("0")[0], { target: { value: "200" } });
    fireEvent.change(screen.getAllByPlaceholderText("0")[1], { target: { value: "200" } });
    fireEvent.click(screen.getByRole("button", { name: "تسجيل التحصيل" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /تأكيد التسجيل رغم التكرار/i })).toBeInTheDocument();
    });
    expect(confirmSpy).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /تأكيد التسجيل رغم التكرار/i }));
    await waitFor(() => {
      expect(onRecorded).toHaveBeenCalledTimes(2);
    });

    const receipts = await getCustomerReceipts();
    expect(receipts).toHaveLength(2);
    confirmSpy.mockRestore();
  });

  it("renders FinancePage open invoice collection action and lets users cancel receipts", async () => {
    render(<FinancePage />);

    // ظهور الفواتير المفتوحة بانتظار التحصيل مع زر تحصيل مباشر
    await waitFor(() => {
      expect(screen.getByText(/فواتير المبيعات بانتظار التحصيل/i)).toBeInTheDocument();
    });

    const collectButtons = screen.getAllByRole("button", { name: "تحصيل" });
    expect(collectButtons.length).toBeGreaterThanOrEqual(2);

    // فتح التحصيل مباشرة من إحدى الفواتير المفتوحة وتسجيلها
    fireEvent.click(collectButtons[0]);
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: "تحصيل من عميل" })).toBeInTheDocument();

    await waitFor(() => {
      const inputs = within(dialog).getAllByPlaceholderText("0") as HTMLInputElement[];
      expect(inputs[0].value).toBe("1000");
    });

    fireEvent.click(within(dialog).getByRole("button", { name: "تسجيل التحصيل" }));

    await waitFor(async () => {
      const receipts = await getCustomerReceipts();
      expect(receipts).toHaveLength(1);
    });

    // الانتقال لتبويب التحصيلات وإلغاء التحصيل عبر AlertDialog الحقيقي
    const receiptsTab = screen.getByRole("tab", { name: /التحصيلات \(1\)/i });
    fireEvent.mouseDown(receiptsTab, { button: 0 });
    fireEvent.click(receiptsTab);
    const cancelBtn = await screen.findByRole("button", { name: "إلغاء" });
    fireEvent.click(cancelBtn);

    const confirmDialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(confirmDialog).getByRole("button", { name: "تأكيد الإلغاء والعكس" }));

    await waitFor(async () => {
      const receipts = await getCustomerReceipts();
      expect(receipts).toHaveLength(0);
    });
  });

  it("supports inline quick-add customer and auto-allocate inside ReceiptDialog", async () => {
    seedSalesInvoice("inv-ofok-1", "261112S003", null, "مؤسسة الأفق", 1000);
    seedSalesInvoice("inv-ofok-2", "261112S004", null, "مؤسسة الأفق", 500);

    const onRecorded = vi.fn();
    render(<ReceiptDialog open={true} onOpenChange={() => {}} onRecorded={onRecorded} />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /عميل جديد/i })).toBeInTheDocument();
    });

    // إضافة عميل سريع داخل نفس الحوار
    fireEvent.click(screen.getByRole("button", { name: /عميل جديد/i }));
    fireEvent.change(screen.getByPlaceholderText("اسم العميل *"), { target: { value: "مؤسسة الأفق" } });
    fireEvent.click(screen.getByRole("button", { name: "حفظ العميل واختياره للتحصيل" }));

    await waitFor(() => {
      expect(screen.getByText(/متبقي/i)).toBeInTheDocument();
      expect(screen.getAllByText(/ج\.س/).length).toBeGreaterThan(0);
    });

    // توزيع تلقائي للفواتير المفتوحة للعميل (1000 + 500 = 1500)
    fireEvent.click(screen.getByRole("button", { name: /توزيع تلقائي/i }));

    await waitFor(() => {
      const inputs = screen.getAllByPlaceholderText("0") as HTMLInputElement[];
      expect(inputs[0].value).toBe("1500");
      expect(inputs.length).toBe(3);
    });

    fireEvent.click(screen.getByRole("button", { name: "تسجيل التحصيل" }));
    await waitFor(() => {
      expect(onRecorded).toHaveBeenCalledTimes(1);
    });
  });

  it("supports immediate USD partial & full collection out of the box and warns if USD accounts are deactivated", async () => {
    seedSalesInvoice("inv-usd-1", "261112S099", "cust-1", "شركة النور", 250, "USD");

    // 1) If all USD accounts are manually deactivated, cross-currency guard blocks & offers 1-click activation
    state.db.db.prepare("UPDATE financial_accounts SET is_active = 0 WHERE currency = 'USD'").run();

    const { unmount } = render(
      <ReceiptDialog
        open={true}
        onOpenChange={() => {}}
        initialInvoiceId="inv-usd-1"
      />
    );

    await waitFor(() => {
      expect(screen.getByText(/لا يوجد حساب مالي بعملة USD/i)).toBeInTheDocument();
    });

    // Customer summary must only reflect the USD invoice (250), NOT SDG (1500)
    await waitFor(() => {
      expect(screen.getByText(/مفوتر 250/)).toBeInTheDocument();
    });
    expect(screen.queryByText(/ج\.س/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "تسجيل التحصيل" })).toBeDisabled();

    // 1-click inline reactivation restores the seeded USD bank account immediately
    fireEvent.click(screen.getByRole("button", { name: /تفعيل حساب \$ تلقائياً/i }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "تسجيل التحصيل" })).not.toBeDisabled();
    });

    unmount();

    // 2) Verify partial payment (100 out of 250 USD) syncs allocation row automatically and succeeds
    const onRecorded = vi.fn();
    render(
      <ReceiptDialog
        open={true}
        onOpenChange={() => {}}
        initialInvoiceId="inv-usd-1"
        onRecorded={onRecorded}
      />
    );

    await waitFor(() => {
      const btn = screen.getByRole("button", { name: "تسجيل التحصيل" });
      expect(btn).not.toBeDisabled();
    });

    const numericInputs = screen.getAllByPlaceholderText("0") as HTMLInputElement[];
    fireEvent.change(numericInputs[0], { target: { value: "100" } });

    fireEvent.click(screen.getByRole("button", { name: "تسجيل التحصيل" }));
    await waitFor(() => {
      expect(onRecorded).toHaveBeenCalledTimes(1);
    });

    const usdReceipts = await getCustomerReceipts(20, "USD");
    expect(usdReceipts).toHaveLength(1);
    expect(usdReceipts[0].amount).toBe(100);
    expect(usdReceipts[0].currency).toBe("USD");
  });

  it("isolates currency in SupplierPaymentDialog and blocks submit when matching currency account is deactivated", async () => {
    state.db.db.prepare("UPDATE financial_accounts SET is_active = 0 WHERE currency = 'USD'").run();
    const sup = await createSupplier({ name: "مطبعة الشرق" });
    seedPurchaseInvoice("pur-sdg-1", "261112P001", sup.id, sup.name, 5000, "SDG");
    seedPurchaseInvoice("pur-usd-1", "261112P002", sup.id, sup.name, 300, "USD");

    render(
      <SupplierPaymentDialog
        open={true}
        onOpenChange={() => {}}
        initialSupplierId={sup.id}
        defaultCurrency="USD"
      />
    );

    await waitFor(() => {
      expect(screen.getByText(/لا يوجد حساب مالي بعملة USD/i)).toBeInTheDocument();
      expect(screen.getByText(/إجمالي الالتزام 300 \$/)).toBeInTheDocument();
    });

    expect(screen.getByRole("button", { name: "تسجيل الدفعة" })).toBeDisabled();
  });

  it("blocks cross-currency settlement in ExpenseDialog when matching currency account is deactivated", async () => {
    state.db.db.prepare("UPDATE financial_accounts SET is_active = 0 WHERE currency = 'USD'").run();
    const usdExpense = await createExpense({
      kind: "operating",
      beneficiary: "خدمة استضافة",
      amount: 120,
      currency: "USD",
      expenseDate: TODAY,
    });

    render(
      <ExpenseDialog
        open={true}
        onOpenChange={() => {}}
        settleExpense={usdExpense}
      />
    );

    await waitFor(() => {
      expect(screen.getByText(/لا يوجد حساب مالي بعملة USD/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/مبلغ السداد \(\$\)/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "تسجيل السداد" })).toBeDisabled();
  });

  it("blocks cross-currency transfers in TransferDialog when each currency has only one active account", async () => {
    render(<TransferDialog open={true} onOpenChange={() => {}} />);

    await waitFor(() => {
      expect(screen.getByText(/يلزم وجود حسابين على الأقل بنفس العملة للتحويل/i)).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: "تنفيذ التحويل" })).toBeDisabled();
  });
});

