/**
 * اختبارات التحقق من الأمر التنفيذي لإصلاح الأخطاء التصميمية والوظيفية (UX-001 -> UX-011 & BUG-009):
 * 1. BUG-009: منع إضافة أو تراكم كلمة "(نسخة)" في اسم العميل عند تكرار الفواتير.
 * 2. UX-007: منع تكرار أزرار الإغلاق (X) في النوافذ المنبثقة وتوفير زر رجوع واحد في الصفحة المستقلة.
 * 3. UX-008: التحقق من إزالة العرض الثابت المقيّد (min-w-[680px]) في جدول الفواتير مع الحفاظ على تصميم الجدول وبياناته.
 */
import React from "react";
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { BillingArchiveTable } from "@/components/billing/BillingArchiveTable";
import type { UnifiedInvoiceRecord } from "@/components/invoices/types";

const savedCopies = vi.hoisted(() => [] as any[]);

vi.mock("@/lib/billing/store", async () => {
  const actual = await vi.importActual<any>("@/lib/billing/store");
  return {
    ...actual,
    saveCustomInvoice: async (inv: any) => {
      savedCopies.push(inv);
      return { ...inv, reference: `INV-DUP-${savedCopies.length}` };
    },
  };
});

const duplicateFixtureRecords: UnifiedInvoiceRecord[] = [
  {
    id: "inv-clean-1",
    kind: "custom",
    type: "sales",
    typeLabel: "فاتورة مبيعات",
    badgeColor: "bg-emerald-500/10 text-emerald-700 border-emerald-500/25",
    serial: "26-0101",
    customerName: "أحمد كمال",
    date: "2026-11-25",
    total: 5550,
    currency: "SDG",
    itemsCount: 2,
    sortTime: 1700000100000,
    raw: {
      id: "inv-clean-1",
      serial: "0101",
      reference: "INV-26-0101",
      customerId: "cust-ahmed-1",
      meta: {
        type: "sales",
        partyName: "أحمد كمال",
        date: "2026-11-25",
        currency: "SDG",
      },
      items: [{ id: "it-1", description: "طباعة بنر", qty: 1, unitPrice: 5550, total: 5550 }],
      totalAmount: 5550,
      createdAt: "2026-11-25T08:00:00Z",
      updatedAt: "2026-11-25T08:00:00Z",
    } as any,
  },
  {
    id: "inv-stacked-2",
    kind: "custom",
    type: "sales",
    typeLabel: "فاتورة مبيعات",
    badgeColor: "bg-emerald-500/10 text-emerald-700 border-emerald-500/25",
    serial: "26-0102",
    customerName: "أحمد كمال (نسخة) (نسخة) (نسخة)",
    date: "2026-11-25",
    total: 5550,
    currency: "SDG",
    itemsCount: 1,
    sortTime: 1700000090000,
    raw: {
      id: "inv-stacked-2",
      serial: "0102",
      reference: "INV-26-0102",
      customerId: "cust-ahmed-1",
      meta: {
        type: "sales",
        partyName: "أحمد كمال (نسخة) (نسخة) (نسخة)",
        date: "2026-11-25",
        currency: "SDG",
      },
      items: [],
      totalAmount: 5550,
      createdAt: "2026-11-25T08:00:00Z",
      updatedAt: "2026-11-25T08:00:00Z",
    } as any,
  },
];

vi.mock("@/components/invoices/useUnifiedInvoices", () => ({
  useUnifiedInvoices: () => ({
    filteredRecords: duplicateFixtureRecords,
    allRecords: duplicateFixtureRecords,
    stats: {
      totalCount: duplicateFixtureRecords.length,
      salesCount: 2,
      proformaCount: 0,
      purchaseCount: 0,
      calcCount: 0,
      salesTotal: 11100,
      purchaseTotal: 0,
    },
  }),
}));

vi.mock("@/lib/customersStore", async () => {
  const actual = await vi.importActual<any>("@/lib/customersStore");
  return {
    ...actual,
    useCustomers: () => [
      {
        id: "cust-ahmed-1",
        name: "أحمد كمال",
        phone: "0912345678",
        type: "client",
        balance: 0,
        createdAt: "2026-01-01T00:00:00Z",
      },
    ],
  };
});

vi.mock("@/lib/financeStore", async () => {
  const actual = await vi.importActual<any>("@/lib/financeStore");
  return {
    ...actual,
    useSettlementVersion: () => 1,
    settlementFor: (_id: string, total: number) => ({
      total,
      paid: 0,
      outstanding: total,
      status: "unpaid",
    }),
  };
});

afterEach(() => {
  cleanup();
  savedCopies.length = 0;
});

describe("Executive UI/UX & Bug-Fix Governance Suite (UX-001..UX-011 & BUG-009)", () => {
  it("BUG-009: duplicating an invoice never appends or stacks '(نسخة)' onto customer partyName and preserves customerId", async () => {
    render(
      <BillingArchiveTable onEditCustom={vi.fn()} onPreviewCustom={vi.fn()} />
    );

    const dupButtons = screen.getAllByTitle("نسخ وتكرار الفاتورة");
    expect(dupButtons).toHaveLength(2);

    // 1) Duplicate a clean invoice -> customer name stays "أحمد كمال" with exact customerId
    fireEvent.click(dupButtons[0]);
    await waitFor(() => {
      expect(savedCopies).toHaveLength(1);
    });
    expect(savedCopies[0].meta.partyName).toBe("أحمد كمال");
    expect(savedCopies[0].customerId).toBe("cust-ahmed-1");

    // 2) Duplicate a legacy invoice with stacked "(نسخة) (نسخة) (نسخة)" -> copy has clean "أحمد كمال" (never stacks more)
    fireEvent.click(dupButtons[1]);
    await waitFor(() => {
      expect(savedCopies).toHaveLength(2);
    });
    expect(savedCopies[1].meta.partyName).toBe("أحمد كمال");
    expect(savedCopies[1].customerId).toBe("cust-ahmed-1");
  });

  it("UX-008: BillingArchiveTable preserves table structure without fixed 680px overflow trap and keeps customer names readable", () => {
    const { container } = render(
      <BillingArchiveTable onEditCustom={vi.fn()} onPreviewCustom={vi.fn()} />
    );
    const table = container.querySelector("table");
    expect(table).toBeTruthy();
    expect(table?.className).not.toContain("min-w-[680px]");
    expect(screen.getByText("أحمد كمال")).toBeInTheDocument();
  });

  it("UX-007: no DialogContent component renders a duplicate manual close X button on top of DialogPrimitive.Close", () => {
    const srcComponents = path.resolve(process.cwd(), "src/components");
    const bankHubPath = path.join(srcComponents, "finance/BankAccountsHubModal.tsx");
    const bankHubSource = fs.readFileSync(bankHubPath, "utf8");
    expect(bankHubSource).not.toContain("<X ");

    const bankPagePath = path.join(srcComponents, "finance/BankAccountsPage.tsx");
    const bankPageSource = fs.readFileSync(bankPagePath, "utf8");
    expect(bankPageSource).not.toContain("<DialogContent");
    expect(bankPageSource).not.toContain("<X ");
  });

  it("UX-004/006/008/010: Customers invoices/statement tabs & Orders History views wrap filters cleanly, avoid dir=ltr on Arabic headers, and never truncate names or totals", () => {
    const srcComponents = path.resolve(process.cwd(), "src/components");

    const custInvoicesSrc = fs.readFileSync(
      path.join(srcComponents, "customers/CustomerDetailInvoicesTab.tsx"),
      "utf8"
    );
    expect(custInvoicesSrc).not.toContain('dir="ltr">الإجمالي');
    expect(custInvoicesSrc).not.toContain('dir="ltr">المتبقي');
    expect(custInvoicesSrc).toContain("hidden md:table-cell");
    expect(custInvoicesSrc).toContain('<bdi dir="ltr"');

    const custStatementSrc = fs.readFileSync(
      path.join(srcComponents, "customers/CustomerDetailStatementTab.tsx"),
      "utf8"
    );
    expect(custStatementSrc).not.toContain('dir="ltr">مدين');
    expect(custStatementSrc).not.toContain('dir="ltr">دائن');
    expect(custStatementSrc).not.toContain('dir="ltr">الرصيد');
    expect(custStatementSrc).toContain("hidden md:table-cell");
    expect(custStatementSrc).toContain("hidden lg:table-cell");
    expect(custStatementSrc).toContain('<bdi dir="ltr"');

    const invStatsSrc = fs.readFileSync(
      path.join(srcComponents, "invoices/InvoicesStatsHeader.tsx"),
      "utf8"
    );
    expect(invStatsSrc).toContain("grid-cols-2 sm:grid-cols-3");
    expect(invStatsSrc).toContain("col-span-2 sm:col-span-1");
    expect(invStatsSrc).not.toContain("truncate");

    const invSearchSrc = fs.readFileSync(
      path.join(srcComponents, "invoices/InvoicesSearchBar.tsx"),
      "utf8"
    );
    expect(invSearchSrc).toContain("flex-wrap");
    expect(invSearchSrc).not.toContain("overflow-x-auto");

    const invCardSrc = fs.readFileSync(
      path.join(srcComponents, "invoices/InvoiceRecordCard.tsx"),
      "utf8"
    );
    expect(invCardSrc).not.toContain("truncate");
    expect(invCardSrc).toContain("break-words");
    expect(invCardSrc).toContain('<bdi dir="ltr"');
  });
});
