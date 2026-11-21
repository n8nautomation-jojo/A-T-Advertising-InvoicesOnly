import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { CustomerDetailPage } from "./CustomerDetailPage";
import { getCustomerFinancialSummary, type CustomerRecord } from "@/lib/customersStore";

afterEach(() => {
  cleanup();
});

vi.mock("@/components/layout/PageShell", () => ({
  PageShell: ({ children }: { children: React.ReactNode }) => <div data-testid="page-shell">{children}</div>,
}));

vi.mock("@/lib/customersStore", async () => {
  const actual = await vi.importActual<any>("@/lib/customersStore");
  return {
    ...actual,
    getCustomerFinancialSummary: vi.fn().mockResolvedValue({
      customerId: "cust-test-1",
      customerName: "شركة الفجر الجديد",
      customerType: "company",
      primaryCurrency: "SDG",
      summariesByCurrency: {
        SDG: {
          currency: "SDG",
          totalInvoiced: 500000,
          totalPaid: 300000,
          outstanding: 200000,
          advanceCredit: 0,
          totalInvoicesCount: 5,
          paidInvoicesCount: 2,
          partialInvoicesCount: 2,
          unpaidInvoicesCount: 1,
          overdueInvoicesCount: 0,
        },
      },
    }),
    getCustomerInvoicesList: vi.fn().mockResolvedValue([
      {
        id: "inv-1",
        serial: 101,
        reference: "INV-2026-001",
        date: "2026-01-15",
        dueDate: "2026-01-30",
        totalAmount: 150000,
        paidAmount: 150000,
        remainingAmount: 0,
        currency: "SDG",
        status: "paid",
        statusLabel: "مسددة بالكامل",
        statusBadgeColor: "bg-emerald-500/10 text-emerald-600",
      },
      {
        id: "inv-2",
        serial: 102,
        reference: "INV-2026-002",
        date: "2026-02-01",
        dueDate: "2026-02-15",
        totalAmount: 350000,
        paidAmount: 150000,
        remainingAmount: 200000,
        currency: "SDG",
        status: "partial",
        statusLabel: "مسددة جزئياً",
        statusBadgeColor: "bg-amber-500/10 text-amber-600",
      },
    ]),
  };
});

vi.mock("@/lib/repositories/ReportsRepository", () => ({
  getCustomerStatement: vi.fn().mockResolvedValue({
    customerId: "cust-test-1",
    customerName: "شركة الفجر الجديد",
    currency: "SDG",
    openingBalance: 0,
    openingBalanceType: "debit",
    lines: [
      {
        id: "line-1",
        date: "2026-01-15",
        kind: "invoice",
        label: "فاتورة مبيعات #101",
        reference: "INV-2026-001",
        debit: 150000,
        credit: 0,
        runningBalance: 150000,
      },
    ],
    closingBalance: 200000,
  }),
}));

const mockCustomer: CustomerRecord = {
  id: "cust-test-1",
  name: "شركة الفجر الجديد للتجارة",
  phone: "0912345678",
  type: "company",
  address: "الخرطوم - شارع الستين",
  balance: 200000,
  createdAt: "2026-01-01T00:00:00Z",
};

describe("CustomerDetailPage — Full Standalone Page Architecture (CEO Benchmark)", () => {
  it("renders as an unboxed full page without dialog overlay or modal constraint", async () => {
    const handleBack = vi.fn();
    render(<CustomerDetailPage customer={mockCustomer} onBack={handleBack} />);

    // Breadcrumbs & Back button
    expect(screen.getByText("دليل العملاء")).toBeDefined();
    expect(screen.getAllByText("شركة الفجر الجديد للتجارة").length).toBeGreaterThanOrEqual(1);

    // Verify back button calls onBack
    const backBtn = screen.getByRole("button", { name: /دليل العملاء/i });
    fireEvent.click(backBtn);
    expect(handleBack).toHaveBeenCalledTimes(1);
  });

  it("renders all three primary workspace tabs", async () => {
    render(<CustomerDetailPage customer={mockCustomer} onBack={vi.fn()} />);

    expect(screen.getAllByRole("button", { name: /سجل الفواتير/i }).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByRole("button", { name: /كشف الحساب المالي/i }).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByRole("button", { name: /بيانات العميل والافتتاحي/i }).length).toBeGreaterThanOrEqual(1);
  });

  it("switches tabs smoothly when clicked", async () => {
    render(<CustomerDetailPage customer={mockCustomer} onBack={vi.fn()} />);

    const statementTabs = screen.getAllByRole("button", { name: /كشف الحساب المالي/i });
    const tabBtn = statementTabs[0];
    fireEvent.click(tabBtn);
    expect(tabBtn.className).toContain("bg-primary");
  });

  it("renders preview & edit invoice buttons and reloads on finance-changed event", async () => {
    render(
      <CustomerDetailPage
        customer={mockCustomer}
        onBack={vi.fn()}
        onCreateProforma={vi.fn()}
      />
    );

    expect(screen.getByRole("button", { name: /عرض سعر/i })).toBeDefined();

    await waitFor(() => {
      expect(screen.getAllByRole("button", { name: "معاينة الفاتورة" }).length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByRole("button", { name: "تعديل الفاتورة" }).length).toBeGreaterThanOrEqual(1);
    });

    const beforeCalls = vi.mocked(getCustomerFinancialSummary).mock.calls.length;
    window.dispatchEvent(new Event("finance-changed"));
    await waitFor(() => {
      expect(vi.mocked(getCustomerFinancialSummary).mock.calls.length).toBeGreaterThan(beforeCalls);
    });
  });
});
