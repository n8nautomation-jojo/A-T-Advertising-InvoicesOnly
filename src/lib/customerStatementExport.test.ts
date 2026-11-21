// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  buildStatementDomElement,
  buildMultiCurrencyStatementDomElement,
} from "./customerStatementExport";
import type { CustomerStatement } from "@/lib/repositories/ReportsRepository";
import type { CustomerRecord } from "@/lib/customersStore";

describe("Customer Statement of Account A4 Document", () => {
  const customer: CustomerRecord = {
    id: "cust-abbadi-0012",
    name: "حسام الدين عبادي",
    phone: "0946548154",
    type: "client",
    address: "",
    totalOrders: 2,
    totalSpent: 3912500,
    balance: 3912500,
    createdAt: "2026-11-01T00:00:00Z",
  };

  const statement: CustomerStatement = {
    customerId: customer.id,
    customerName: customer.name,
    currency: "SDG",
    openingBalance: 0,
    broughtForwardBalance: 0,
    periodFrom: "2026-11-01",
    periodTo: "2026-11-20",
    totalInvoiced: 3912500,
    totalCollected: 0,
    outstanding: 3912500,
    netBalance: 3912500,
    lines: [
      {
        kind: "invoice",
        id: "inv-1",
        reference: "26-0002",
        date: "2026-11-20",
        label: "فاتورة مبيعات",
        debit: 162500,
        credit: 0,
        runningBalance: 162500,
      },
      {
        kind: "invoice",
        id: "inv-2",
        reference: "26-0003",
        date: "2026-11-20",
        label: "فاتورة مبيعات",
        debit: 3750000,
        credit: 0,
        runningBalance: 3912500,
      },
    ],
  };

  it("renders bounded period, statement ref, centered bank details, and signatory title beneath name beside signature", () => {
    const el = buildStatementDomElement(statement, customer, "SDG");
    const html = el.innerHTML;
    const text = el.textContent || "";

    // 1. Bounded period & statement metadata
    expect(text).toContain("رقم الكشف:");
    expect(text).toContain("STMT-");
    expect(text).toContain("فترة محددة");
    expect(text).toContain("2026 / 11 / 01");
    expect(text).toContain("2026 / 11 / 20");
    expect(text).toContain("الرصيد الافتتاحي / المرحل:");
    expect(text).toContain("حركة الفترة (مدين / دائن):");
    expect(text).toContain("كود الحساب:");

    // 2. Centered bank & tafqeet strip + reconciliation notice
    expect(html).toContain("text-align: center");
    expect(html).toContain("الحساب المعتمد للسداد: بنك الخرطوم");
    expect(html).toContain("خلال 7 أيام من تاريخ الإصدار");

    // 3. Signatory layout: name directly above title, both beside signature inside finance card
    const namePos = html.indexOf("طارق عثمان علي");
    const titlePos = html.indexOf("المدير المالي والتشغيلي المعتمد");
    const sigPos = html.indexOf('alt="Signature"');
    expect(namePos).toBeGreaterThan(-1);
    expect(titlePos).toBeGreaterThan(namePos);
    expect(sigPos).toBeGreaterThan(titlePos);
  });

  it("renders separated per-currency summary windows and ledgers for multi-currency customers without mixing amounts", () => {
    const usdStatement: CustomerStatement = {
      customerId: customer.id,
      customerName: customer.name,
      currency: "USD",
      openingBalance: 0,
      broughtForwardBalance: 0,
      periodFrom: "2026-11-01",
      periodTo: "2026-11-20",
      totalInvoiced: 2050,
      totalCollected: 50,
      outstanding: 2000,
      netBalance: 2000,
      lines: [
        {
          kind: "invoice",
          id: "inv-usd-1",
          reference: "26-0009",
          date: "2026-11-18",
          label: "فاتورة تصميم دولية",
          debit: 2050,
          credit: 0,
          runningBalance: 2050,
        },
      ],
    };

    const el = buildMultiCurrencyStatementDomElement([statement, usdStatement], customer);
    const text = el.textContent || "";

    expect(text).toContain("كشف حساب مالي مفصّل حسب العملة");
    expect(text).toContain("جنيه سوداني (SDG)");
    expect(text).toContain("دولار أمريكي (USD)");
    expect(text).toContain("3,912,500");
    expect(text).toContain("2,000");
    expect(text).toContain("جدول حركات الحساب بعملة: جنيه سوداني (SDG)");
    expect(text).toContain("جدول حركات الحساب بعملة: دولار أمريكي (USD)");
    expect(text).not.toContain("3,914,500");
    expect(text).not.toContain("3,914,550");
  });
});
