import React from "react";
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { BillingArchiveTable } from "@/components/billing/BillingArchiveTable";
import { CustomerDetailStatementTab } from "@/components/customers/CustomerDetailStatementTab";
import type { UnifiedInvoiceRecord } from "@/components/invoices/types";
import type { StatementLine } from "@/lib/repositories/ReportsRepository";

afterEach(() => {
  cleanup();
});

const mockRecords: UnifiedInvoiceRecord[] = Array.from({ length: 120 }, (_, i) => {
  const num = 120 - i;
  const serial = `26-${String(num).padStart(4, "0")}`;
  return {
    id: `inv-${num}`,
    kind: "custom",
    type: num % 5 === 0 ? "proforma" : "sales",
    typeLabel: num % 5 === 0 ? "عرض سعر" : "فاتورة مبيعات",
    badgeColor: "bg-emerald-500/10 text-emerald-700 border-emerald-500/25",
    serial,
    customerName: num === 120 ? "أحمد كمال" : `عميل رقم ${num}`,
    date: "2026-11-25",
    total: 1000 * num,
    currency: "SDG",
    itemsCount: 3,
    sortTime: 1700000000000 + num * 1000,
    raw: {
      id: `inv-${num}`,
      serial: num,
      reference: `INV-${serial}`,
      meta: {
        type: num % 5 === 0 ? "proforma" : "sales",
        partyName: num === 120 ? "أحمد كمال" : `عميل رقم ${num}`,
        date: "2026-11-25",
        currency: "SDG",
      },
      items: [],
      totalAmount: 1000 * num,
      createdAt: "2026-11-25T08:00:00Z",
      updatedAt: "2026-11-25T08:00:00Z",
    } as any,
  };
});

vi.mock("@/components/invoices/useUnifiedInvoices", () => ({
  useUnifiedInvoices: (search = "", selectedType = "all") => {
    const q = search.trim().toLowerCase();
    const filteredRecords = mockRecords.filter((rec) => {
      if (selectedType !== "all" && rec.type !== selectedType) return false;
      if (!q) return true;
      return (
        rec.customerName.toLowerCase().includes(q) ||
        rec.serial.toLowerCase().includes(q)
      );
    });
    return {
      filteredRecords,
      allRecords: mockRecords,
      stats: {
        totalCount: mockRecords.length,
        salesCount: 96,
        proformaCount: 24,
        purchaseCount: 0,
        calcCount: 0,
        salesTotal: 500000,
        purchaseTotal: 0,
      },
    };
  },
}));

vi.mock("@/lib/customersStore", async () => {
  const actual = await vi.importActual<any>("@/lib/customersStore");
  return {
    ...actual,
    useCustomers: () => [
      {
        id: "cust-ahmed",
        name: "احمد كمال",
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

function walkSourceFiles(dir: string): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const results: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkSourceFiles(fullPath));
    } else if (
      (entry.name.endsWith(".tsx") || entry.name.endsWith(".ts")) &&
      !entry.name.endsWith(".test.tsx") &&
      !entry.name.endsWith(".test.ts")
    ) {
      results.push(fullPath);
    }
  }
  return results;
}

describe("Bi-Directional Scroll & Touch Usability Architecture (CTO Governance Suite)", () => {
  it("enforces pan-x pan-y touch-action and proper overscroll chaining in src/styles/base.css", () => {
    const baseCssPath = path.resolve(process.cwd(), "src/styles/base.css");
    const css = fs.readFileSync(baseCssPath, "utf8");

    // Verify bi-directional touch-action on horizontal & vertical scrollers
    expect(css).toMatch(/\.overflow-x-auto\s*\{[^}]*touch-action:\s*pan-x\s+pan-y\s+pinch-zoom/s);
    expect(css).toMatch(/\.overflow-x-auto\s*\{[^}]*overscroll-behavior-x:\s*contain/s);
    expect(css).toMatch(/\.overflow-x-auto\s*\{[^}]*overscroll-behavior-y:\s*auto/s);
    expect(css).toMatch(/\.overflow-y-auto\s*\{[^}]*touch-action:\s*pan-x\s+pan-y\s+pinch-zoom/s);

    // Ensure .overflow-y-auto itself does NOT globally trap nested vertical scroll chaining
    const overflowYBlock = css.match(/\.overflow-y-auto\s*\{([^}]*)\}/s)?.[1] ?? "";
    expect(overflowYBlock).not.toMatch(/overscroll-behavior(-y)?:\s*contain/);

    // Ensure root page/dialog scrollers DO contain overscroll
    expect(css).toMatch(/main\.overflow-y-auto[\s\S]*?overscroll-behavior-y:\s*contain/);

    // Ensure both .scrollbar-none and .no-scrollbar hide obstructive bar strips
    expect(css).toContain(".scrollbar-none");
    expect(css).toContain(".no-scrollbar");
  });

  it("prevents single-axis touch-pan-x / touch-pan-y and scroll-smooth traps across UI components", () => {
    const srcRoot = path.resolve(process.cwd(), "src");
    const files = [
      ...walkSourceFiles(path.join(srcRoot, "components")),
      ...walkSourceFiles(path.join(srcRoot, "routes")),
    ];

    const offenders: string[] = [];
    for (const file of files) {
      const content = fs.readFileSync(file, "utf8");
      if (/\btouch-pan-(x|y)\b/.test(content)) {
        offenders.push(`${path.relative(srcRoot, file)} (single-axis touch-pan)`);
      }
      if (/\bscroll-smooth\b/.test(content)) {
        offenders.push(`${path.relative(srcRoot, file)} (scroll-smooth touch jitter)`);
      }
      if (/overflow-x-auto[^\n"]*max-h-\[\d+px\][^\n"]*overscroll-contain/.test(content)) {
        offenders.push(`${path.relative(srcRoot, file)} (nested 2D table scroll trap)`);
      }
    }

    expect(offenders).toEqual([]);
  });

  it("allows unobstructed vertical + horizontal scrolling and progressive chunking in BillingArchiveTable with 120 accumulated invoices", () => {
    render(
      <BillingArchiveTable
        onEditCustom={vi.fn()}
        onPreviewCustom={vi.fn()}
      />
    );

    const scrollBox = screen.getByTestId("billing-archive-scroll-box");
    expect(scrollBox.className).toContain("overflow-x-auto");
    expect(scrollBox.className).toContain("overscroll-x-contain");
    expect(scrollBox.className).not.toContain("touch-pan-x");
    expect(scrollBox.className).not.toContain("max-h-");

    // Verify O(1) normalized Arabic customer name matching ("أحمد كمال" -> "احمد كمال")
    expect(screen.getByTitle("ربط هذه الفاتورة بملف احمد كمال")).toBeInTheDocument();

    // Verify progressive chunking renders 50 rows initially out of 120
    const initialRows = scrollBox.querySelectorAll("tbody tr");
    expect(initialRows.length).toBe(50);

    const loadMoreBtn = screen.getByText(/عرض المزيد من الفواتير \(70 فاتورة إضافية\)/);
    fireEvent.click(loadMoreBtn);
    expect(scrollBox.querySelectorAll("tbody tr").length).toBe(100);

    const loadMoreBtn2 = screen.getByText(/عرض المزيد من الفواتير \(20 فاتورة إضافية\)/);
    fireEvent.click(loadMoreBtn2);
    expect(scrollBox.querySelectorAll("tbody tr").length).toBe(120);
    expect(screen.queryByText(/عرض المزيد من الفواتير/)).toBeNull();

    // Filtering resets visible chunk cleanly
    const proformaTab = screen.getByText("فواتير مبدئية");
    fireEvent.click(proformaTab);
    expect(scrollBox.querySelectorAll("tbody tr").length).toBe(24);
  });

  it("renders CustomerDetailStatementTab without vertical clip traps in both single-currency and multi-currency views", () => {
    const lines: StatementLine[] = Array.from({ length: 20 }, (_, idx) => ({
      id: `stmt-${idx + 1}`,
      date: "2026-11-25",
      kind: "invoice",
      label: `فاتورة مبيعات #${idx + 1}`,
      reference: `INV-26-${String(idx + 1).padStart(4, "0")}`,
      debit: 5000,
      credit: 0,
      runningBalance: 5000 * (idx + 1),
    }));

    const { container, rerender } = render(
      <CustomerDetailStatementTab
        statementSearch=""
        setStatementSearch={vi.fn()}
        statementTypeFilter="all"
        setStatementTypeFilter={vi.fn()}
        statementPageSize={30}
        setStatementPageSize={vi.fn()}
        selectedCurrency="SDG"
        paginatedStatementLines={lines}
        processedStatementLinesCount={lines.length}
        statementPage={1}
        setStatementPage={vi.fn()}
        totalStatementPages={1}
      />
    );

    const singleTableWrapper = container.querySelector("table")?.parentElement;
    expect(singleTableWrapper?.className).toContain("overflow-x-auto");
    expect(singleTableWrapper?.className).not.toContain("touch-pan-x");
    expect(singleTableWrapper?.className).not.toContain("max-h-");
    expect(container.querySelectorAll("tbody tr").length).toBe(20);

    rerender(
      <CustomerDetailStatementTab
        statementSearch=""
        setStatementSearch={vi.fn()}
        statementTypeFilter="all"
        setStatementTypeFilter={vi.fn()}
        statementPageSize={30}
        setStatementPageSize={vi.fn()}
        selectedCurrency="ALL"
        statementViewAllCurrencies={true}
        paginatedStatementLines={lines}
        processedStatementLinesCount={lines.length}
        statementPage={1}
        setStatementPage={vi.fn()}
        totalStatementPages={1}
        allStatements={[
          {
            customerId: "c1",
            customerName: "عميل اختبار",
            currency: "SDG",
            openingBalance: 0,
            totalInvoiced: 100000,
            totalCollected: 0,
            outstanding: 100000,
            netBalance: 100000,
            lines,
          } as any,
        ]}
      />
    );

    const multiTableWrapper = container.querySelector("table")?.parentElement;
    expect(multiTableWrapper?.className).toContain("overflow-x-auto");
    expect(multiTableWrapper?.className).not.toContain("touch-pan-x");
    expect(multiTableWrapper?.className).not.toContain("max-h-");
  });
});
