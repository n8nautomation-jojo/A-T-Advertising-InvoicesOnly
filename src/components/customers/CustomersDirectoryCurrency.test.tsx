import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import {
  CustomersDirectoryTable,
  CustomersMobileCards,
  type LiveBalancesMap,
} from "./CustomersDirectoryViews";
import type { CustomerRecord } from "@/lib/customersStore";

afterEach(() => {
  cleanup();
});

const usdCustomer: CustomerRecord = {
  id: "cust-usd-1",
  name: "عميل الدولار فقط",
  phone: "0912345678",
  type: "company",
  address: "بورتسودان",
  totalOrders: 1,
  totalSpent: 0,
  balance: 0,
  createdAt: "2026-11-20T00:00:00Z",
};

const dualCustomer: CustomerRecord = {
  id: "cust-dual-1",
  name: "عميل متعدد العملات",
  phone: "0998765432",
  type: "institution",
  address: "الخرطوم",
  totalOrders: 2,
  totalSpent: 0,
  balance: 0,
  createdAt: "2026-11-20T00:00:00Z",
};

const liveBalances: LiveBalancesMap = {
  "cust-usd-1": {
    invoiced: 500,
    collected: 0,
    outstanding: 500,
    overdueCount: 0,
    primaryCurrency: "USD",
    byCurrency: {
      USD: { currency: "USD", invoiced: 500, collected: 0, outstanding: 500, overdueCount: 0 },
    },
  },
  "cust-dual-1": {
    invoiced: 120000,
    collected: 0,
    outstanding: 120000,
    overdueCount: 0,
    primaryCurrency: "SDG",
    byCurrency: {
      SDG: { currency: "SDG", invoiced: 120000, collected: 0, outstanding: 120000, overdueCount: 0 },
      USD: { currency: "USD", invoiced: 250, collected: 50, outstanding: 200, overdueCount: 0 },
    },
  },
};

describe("CustomersDirectoryViews — Strict Multi-Currency Rendering", () => {
  it("displays USD ($) and NEVER ج.س for a USD-only customer in desktop table and mobile cards", () => {
    const { container } = render(
      <>
        <CustomersDirectoryTable
          totalMatchedCount={1}
          visibleCustomers={[usdCustomer]}
          liveBalances={liveBalances}
          selectedCurrency="ALL"
          onOpenProfile={vi.fn()}
          onCreateInvoice={vi.fn()}
          onEditCustomer={vi.fn()}
          onDeleteCustomer={vi.fn()}
        />
        <CustomersMobileCards
          totalMatchedCount={1}
          visibleCustomers={[usdCustomer]}
          liveBalances={liveBalances}
          selectedCurrency="ALL"
          onOpenProfile={vi.fn()}
          onCreateInvoice={vi.fn()}
          onEditCustomer={vi.fn()}
          onDeleteCustomer={vi.fn()}
        />
      </>
    );

    const text = container.textContent || "";
    expect(text).toContain("500");
    expect(text).toContain("$");
    expect(text).not.toContain("ج.س");
  });

  it("displays both SDG and USD separately for a dual-currency customer without summing them", () => {
    render(
      <CustomersDirectoryTable
        totalMatchedCount={1}
        visibleCustomers={[dualCustomer]}
        liveBalances={liveBalances}
        selectedCurrency="ALL"
        onOpenProfile={vi.fn()}
        onCreateInvoice={vi.fn()}
        onEditCustomer={vi.fn()}
        onDeleteCustomer={vi.fn()}
      />
    );

    expect(screen.getAllByText(/120,000/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/250/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/200/).length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText(/120,250/)).toBeNull();
  });
});
