/**
 * ═══════════════════════════════════════════════════════════════
 * Reports read model (PRD §11)
 * ═══════════════════════════════════════════════════════════════
 * Every figure is computed from the authoritative records at read time, and
 * each one can be drilled down to the transactions that produced it (§11.6).
 * Nothing here is cached, estimated or hardcoded (§12.10).
 *
 * Date filters compare the document's own business date, so a report for a
 * period shows the documents issued in that period.
 */

import { getDb } from "@/lib/database";
import { getLocalIsoDate } from "@/lib/dateUtils";
import { sanitizeCurrency, type AppCurrency } from "@/lib/currency/types";
import { buildCompanyProfitability, buildSettlement, type CompanyProfitability, type SettlementSummary } from "@/lib/domain/finance";

export interface DateRange {
  from?: string | undefined; // inclusive YYYY-MM-DD
  to?: string | undefined; // inclusive YYYY-MM-DD
}

function rangeClause(range: DateRange, column: string): { sql: string; values: string[] } {
  const parts: string[] = [];
  const values: string[] = [];
  if (range.from) {
    parts.push(`${column} >= ?`);
    values.push(range.from);
  }
  if (range.to) {
    parts.push(`${column} <= ?`);
    values.push(range.to);
  }
  return { sql: parts.length ? ` AND ${parts.join(" AND ")}` : "", values };
}

function currencyClause(currency: AppCurrency | undefined, column: string): { sql: string; values: string[] } {
  if (!currency) return { sql: "", values: [] };
  return { sql: ` AND COALESCE(${column}, 'SDG') = ?`, values: [currency] };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

// ═══════════════════════════════════════════════════════════════════════════
// §11.1 Sales performance
// ═══════════════════════════════════════════════════════════════════════════

export interface SalesPerformance {
  invoiceCount: number;
  totalSales: number;
  totalDiscount: number;
  averageInvoice: number;
  byCustomer: { customerId: string | null; name: string; total: number; count: number }[];
  invoices: SalesInvoiceRow[];
}

export interface SalesInvoiceRow {
  id: string;
  reference: string;
  date: string;
  customerName: string;
  total: number;
  discount: number;
  currency?: AppCurrency | undefined;
}

export async function getSalesPerformance(
  range: DateRange = {},
  currency?: AppCurrency
): Promise<SalesPerformance> {
  const db = await getDb();
  const clause = rangeClause(range, "date");
  const curClause = currencyClause(currency, "currency");
  const res = await db.query(
    `SELECT id, reference, serial, date, party_name, customer_id, total_amount, discount,
            COALESCE(currency, 'SDG') AS resolved_currency
       FROM custom_invoices
      WHERE type = 'sales' AND cancelled_at IS NULL${clause.sql}${curClause.sql}
      ORDER BY date DESC, created_at DESC`,
    [...clause.values, ...curClause.values]
  );

  const invoices: SalesInvoiceRow[] = (res.values ?? []).map((row: any) => ({
    id: String(row.id),
    reference: String(row.reference ?? row.serial ?? ""),
    date: String(row.date ?? ""),
    customerName: String(row.party_name ?? ""),
    total: num(row.total_amount),
    discount: num(row.discount),
    currency: sanitizeCurrency(row.resolved_currency, "SDG"),
  }));

  const totalSales = invoices.reduce((sum, inv) => sum + inv.total, 0);
  const totalDiscount = invoices.reduce((sum, inv) => sum + inv.discount, 0);

  const customerMap = new Map<string, { customerId: string | null; name: string; total: number; count: number }>();
  for (const invoice of invoices) {
    const key = invoice.customerName || "غير محدد";
    const entry = customerMap.get(key) ?? { customerId: null, name: key, total: 0, count: 0 };
    entry.total = round2(entry.total + invoice.total);
    entry.count += 1;
    customerMap.set(key, entry);
  }

  return {
    invoiceCount: invoices.length,
    totalSales: round2(totalSales),
    totalDiscount: round2(totalDiscount),
    averageInvoice: invoices.length ? round2(totalSales / invoices.length) : 0,
    byCustomer: Array.from(customerMap.values()).sort((a, b) => b.total - a.total),
    invoices,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// §11.2 Customer collections
// ═══════════════════════════════════════════════════════════════════════════

export interface CustomerCollectionsReport {
  collectedTotal: number;
  payments: { id: string; reference: string; date: string; customerName: string; amount: number; method: string; currency?: AppCurrency | undefined }[];
  openInvoices: { id: string; reference: string; customerName: string; date: string; dueDate?: string | undefined; currency?: AppCurrency | undefined; settlement: SettlementSummary; overdue: boolean }[];
  outstandingTotal: number;
  overdueTotal: number;
}

export async function getCustomerCollectionsReport(
  range: DateRange = {},
  today = getLocalIsoDate(),
  currency?: AppCurrency
): Promise<CustomerCollectionsReport> {
  const db = await getDb();
  const clause = rangeClause(range, "p.paid_at");
  const payCur = currencyClause(currency, "p.currency");
  const paymentsRes = await db.query(
    `SELECT p.id, p.reference, p.paid_at, p.amount, p.method, COALESCE(p.currency, 'SDG') AS resolved_currency,
            c.name AS customer_name
       FROM customer_payments p
       LEFT JOIN customers c ON c.id = p.customer_id
      WHERE p.cancelled_at IS NULL${clause.sql}${payCur.sql}
      ORDER BY p.paid_at DESC`,
    [...clause.values, ...payCur.values]
  );

  const payments = (paymentsRes.values ?? []).map((row: any) => ({
    id: String(row.id),
    reference: String(row.reference ?? ""),
    date: String(row.paid_at ?? ""),
    customerName: String(row.customer_name ?? "عميل محذوف"),
    amount: num(row.amount),
    method: String(row.method ?? "cash"),
    currency: sanitizeCurrency(row.resolved_currency, "SDG"),
  }));

  // Open invoices are not date-filtered: a balance is a current state, and the
  // report labels it as such instead of pretending it belongs to a period.
  // Pushed into SQL with LEFT JOIN to return ONLY invoices with genuine outstanding balances.
  const invCur = currencyClause(currency, "i.currency");
  const invoicesRes = await db.query(
    `SELECT i.id, i.reference, i.serial, i.party_name, i.date, i.due_date, i.total_amount,
            COALESCE(i.currency, 'SDG') AS resolved_currency,
            COALESCE(paid_agg.paid, 0) AS paid
       FROM custom_invoices i
       LEFT JOIN (
         SELECT a.invoice_id, SUM(a.amount) AS paid
           FROM customer_payment_allocations a
           JOIN customer_payments p ON p.id = a.payment_id
          WHERE p.cancelled_at IS NULL
          GROUP BY a.invoice_id
       ) paid_agg ON paid_agg.invoice_id = i.id
      WHERE i.type = 'sales' AND i.cancelled_at IS NULL
        AND (i.total_amount - COALESCE(paid_agg.paid, 0)) > 0.009${invCur.sql}
      ORDER BY i.date DESC`,
    invCur.values
  );

  const openInvoices: CustomerCollectionsReport["openInvoices"] = [];
  let outstandingTotal = 0;
  let overdueTotal = 0;
  for (const row of invoicesRes.values ?? []) {
    const settlement = buildSettlement(num(row.total_amount), num(row.paid));
    if (settlement.outstanding <= 0) continue;
    const due = row.due_date || row.date;
    const overdue = Boolean(due && String(due) < today);
    outstandingTotal += settlement.outstanding;
    if (overdue) overdueTotal += settlement.outstanding;
    openInvoices.push({
      id: String(row.id),
      reference: String(row.reference ?? row.serial ?? ""),
      customerName: String(row.party_name ?? ""),
      date: String(row.date ?? ""),
      dueDate: row.due_date ?? undefined,
      currency: sanitizeCurrency(row.resolved_currency, "SDG"),
      settlement,
      overdue,
    });
  }

  return {
    collectedTotal: round2(payments.reduce((sum, p) => sum + p.amount, 0)),
    payments,
    openInvoices,
    outstandingTotal: round2(outstandingTotal),
    overdueTotal: round2(overdueTotal),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// §11.3 Purchases & execution costs
// ═══════════════════════════════════════════════════════════════════════════

export interface PurchasesReport {
  purchaseCount: number;
  purchaseTotal: number;
  paidTotal: number;
  outstandingTotal: number;
  purchases: {
    id: string;
    reference: string;
    supplierName: string;
    supplierInvoiceNumber?: string | undefined;
    date: string;
    currency?: AppCurrency | undefined;
    settlement: SettlementSummary;
  }[];
  supplierPayments: { id: string; reference: string; date: string; supplierName: string; amount: number; currency?: AppCurrency | undefined }[];
  directExpenses: { id: string; date: string; beneficiary: string; category: string; amount: number; paid: number; currency?: AppCurrency | undefined }[];
}

export async function getPurchasesReport(
  range: DateRange = {},
  currency?: AppCurrency
): Promise<PurchasesReport> {
  const db = await getDb();
  const clause = rangeClause(range, "i.date");
  const curInv = currencyClause(currency, "i.currency");
  const purchasesRes = await db.query(
    `SELECT i.id, i.reference, i.serial, i.date, i.supplier_invoice_number, i.total_amount,
            COALESCE(i.currency, 'SDG') AS resolved_currency, s.name AS supplier_name
       FROM custom_invoices i
       LEFT JOIN suppliers s ON s.id = i.supplier_id
      WHERE i.type = 'purchase' AND i.cancelled_at IS NULL${clause.sql}${curInv.sql}
      ORDER BY i.date DESC`,
    [...clause.values, ...curInv.values]
  );
  const paidRes = await db.query(
    `SELECT a.invoice_id AS invoice_id, COALESCE(SUM(a.amount), 0) AS paid
       FROM supplier_payment_allocations a
       JOIN supplier_payments p ON p.id = a.payment_id
       JOIN custom_invoices i ON i.id = a.invoice_id
      WHERE p.cancelled_at IS NULL AND i.cancelled_at IS NULL${curInv.sql}
      GROUP BY a.invoice_id`,
    curInv.values
  );
  const paidMap: Record<string, number> = {};
  for (const row of paidRes.values ?? []) paidMap[String(row.invoice_id)] = num(row.paid);

  const purchases: PurchasesReport["purchases"] = [];
  let purchaseTotal = 0;
  let paidTotal = 0;
  for (const row of purchasesRes.values ?? []) {
    const settlement = buildSettlement(num(row.total_amount), paidMap[String(row.id)] ?? 0);
    purchaseTotal += settlement.total;
    paidTotal += settlement.paid;
    purchases.push({
      id: String(row.id),
      reference: String(row.reference ?? row.serial ?? ""),
      supplierName: String(row.supplier_name ?? "مورد غير محدد"),
      supplierInvoiceNumber: row.supplier_invoice_number ?? undefined,
      date: String(row.date ?? ""),
      currency: sanitizeCurrency(row.resolved_currency, "SDG"),
      settlement,
    });
  }

  const paymentsClause = rangeClause(range, "p.paid_at");
  const curPay = currencyClause(currency, "p.currency");
  const paymentsRes = await db.query(
    `SELECT p.id, p.reference, p.paid_at, p.amount, COALESCE(p.currency, 'SDG') AS resolved_currency,
            s.name AS supplier_name
       FROM supplier_payments p
       LEFT JOIN suppliers s ON s.id = p.supplier_id
      WHERE p.cancelled_at IS NULL${paymentsClause.sql}${curPay.sql}
      ORDER BY p.paid_at DESC`,
    [...paymentsClause.values, ...curPay.values]
  );
  const supplierPayments = (paymentsRes.values ?? []).map((row: any) => ({
    id: String(row.id),
    reference: String(row.reference ?? ""),
    date: String(row.paid_at ?? ""),
    supplierName: String(row.supplier_name ?? "مورد محذوف"),
    amount: num(row.amount),
    currency: sanitizeCurrency(row.resolved_currency, "SDG"),
  }));

  const expensesClause = rangeClause(range, "e.expense_date");
  const curExp = currencyClause(currency, "e.currency");
  const expensesRes = await db.query(
    `SELECT e.id, e.expense_date, e.beneficiary, e.category, e.amount,
            COALESCE(e.currency, 'SDG') AS resolved_currency,
            COALESCE((SELECT SUM(p.amount) FROM expense_payments p WHERE p.expense_id = e.id AND p.cancelled_at IS NULL), 0) AS paid
       FROM expenses e
      WHERE e.kind = 'direct' AND e.cancelled_at IS NULL${expensesClause.sql}${curExp.sql}
      ORDER BY e.expense_date DESC`,
    [...expensesClause.values, ...curExp.values]
  );
  const directExpenses = (expensesRes.values ?? []).map((row: any) => ({
    id: String(row.id),
    date: String(row.expense_date ?? ""),
    beneficiary: String(row.beneficiary ?? ""),
    category: String(row.category ?? ""),
    amount: num(row.amount),
    paid: num(row.paid),
    currency: sanitizeCurrency(row.resolved_currency, "SDG"),
  }));

  return {
    purchaseCount: purchases.length,
    purchaseTotal: round2(purchaseTotal),
    paidTotal: round2(paidTotal),
    outstandingTotal: round2(Math.max(0, purchaseTotal - paidTotal)),
    purchases,
    supplierPayments,
    directExpenses,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// §11.4 Financial performance
// ═══════════════════════════════════════════════════════════════════════════

export interface FinancialPerformanceReport extends CompanyProfitability {
  liquidity: number;
  receiptsTotal: number;
  paymentsTotal: number;
  /** تفصيل المصروفات التشغيلية (القيمة الإجمالية في الحقل الموروث operatingExpenses) */
  operatingExpenseRows: { id: string; date: string; beneficiary: string; amount: number; paid: number }[];
}

export async function getFinancialPerformanceReport(
  range: DateRange = {},
  currency?: AppCurrency
): Promise<FinancialPerformanceReport> {
  const db = await getDb();

  const curPlain = currencyClause(currency, "currency");
  const salesClause = rangeClause(range, "date");
  const salesRes = await db.query(
    `SELECT COALESCE(SUM(total_amount), 0) AS total FROM custom_invoices WHERE type = 'sales' AND cancelled_at IS NULL${salesClause.sql}${curPlain.sql}`,
    [...salesClause.values, ...curPlain.values]
  );
  const purchaseClause = rangeClause(range, "date");
  const purchasesRes = await db.query(
    `SELECT COALESCE(SUM(total_amount), 0) AS total FROM custom_invoices WHERE type = 'purchase' AND cancelled_at IS NULL${purchaseClause.sql}${curPlain.sql}`,
    [...purchaseClause.values, ...curPlain.values]
  );
  const expenseClause = rangeClause(range, "expense_date");
  const curExp = currencyClause(currency, "e.currency");
  const directExpensesRes = await db.query(
    `SELECT COALESCE(SUM(amount), 0) AS total FROM expenses WHERE kind = 'direct' AND cancelled_at IS NULL${expenseClause.sql}${curPlain.sql}`,
    [...expenseClause.values, ...curPlain.values]
  );
  const operatingRes = await db.query(
    `SELECT id, expense_date, beneficiary, amount,
            COALESCE((SELECT SUM(p.amount) FROM expense_payments p WHERE p.expense_id = e.id AND p.cancelled_at IS NULL), 0) AS paid
       FROM expenses e
      WHERE e.kind = 'operating' AND e.cancelled_at IS NULL${expenseClause.sql}${curExp.sql}
      ORDER BY e.expense_date DESC`,
    [...expenseClause.values, ...curExp.values]
  );

  const profitability = buildCompanyProfitability({
    revenue: num(salesRes.values?.[0]?.total),
    directCosts: num(purchasesRes.values?.[0]?.total) + num(directExpensesRes.values?.[0]?.total),
    operatingExpenses: (operatingRes.values ?? []).reduce((sum: number, row: any) => sum + num(row.amount), 0),
  });

  const { getCashSummary } = await import("@/lib/repositories/LedgerRepository");
  const cash = await getCashSummary(currency);

  const txRange = rangeClause(range, "t.occurred_at");
  const txCur = currencyClause(currency, "COALESCE(t.currency, a.currency, 'SDG')");
  const txAggRes = await db.query(
    `SELECT
       COALESCE(SUM(CASE WHEN t.kind = 'receipt' THEN t.amount ELSE 0 END), 0) AS receipts,
       COALESCE(SUM(CASE WHEN t.kind = 'payment' THEN t.amount ELSE 0 END), 0) AS payments
       FROM financial_transactions t
       LEFT JOIN financial_accounts a ON a.id = t.account_id
      WHERE t.reversed_by IS NULL${txRange.sql}${txCur.sql}`,
    [...txRange.values, ...txCur.values]
  );

  return {
    ...profitability,
    liquidity: cash.liquidity,
    receiptsTotal: round2(num(txAggRes.values?.[0]?.receipts)),
    paymentsTotal: round2(num(txAggRes.values?.[0]?.payments)),
    operatingExpenseRows: (operatingRes.values ?? []).map((row: any) => ({
      id: String(row.id),
      date: String(row.expense_date ?? ""),
      beneficiary: String(row.beneficiary ?? ""),
      amount: num(row.amount),
      paid: num(row.paid),
    })),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Report B — Customer statement (§11.5 B)
// ═══════════════════════════════════════════════════════════════════════════

export interface StatementLine {
  kind: "invoice" | "receipt" | "opening_balance";
  id: string;
  reference: string;
  date: string;
  label: string;
  debit: number;
  credit: number;
  runningBalance: number;
  notes?: string;
  currency?: string;
}

export interface CustomerStatement {
  customerId: string;
  customerName: string;
  currency: string;
  lines: StatementLine[];
  totalInvoiced: number;
  totalCollected: number;
  outstanding: number;
  netBalance: number;
  openingBalance: number;
  broughtForwardBalance?: number;
  periodFrom?: string;
  periodTo?: string;
}

export async function getCustomerStatement(
  customerId: string,
  range: DateRange = {},
  filterCurrency?: string
): Promise<CustomerStatement> {
  const db = await getDb();
  const customerRes = await db.query(
    "SELECT name, created_at, opening_balance, opening_balance_date, opening_balance_type, opening_balance_currency, opening_balance_notes FROM customers WHERE id = ? LIMIT 1",
    [customerId]
  );
  const cRow = customerRes.values?.[0] || {};
  const customerName = String(cRow.name ?? "عميل");
  const targetCurrency = sanitizeCurrency(filterCurrency || cRow.opening_balance_currency, "SDG");

  const invoiceClause = rangeClause(range, "i.date");
  const invoicesRes = await db.query(
    `SELECT i.id, i.reference, i.serial, i.date, i.total_amount, i.currency, i.notes
       FROM custom_invoices i
      WHERE i.type = 'sales' AND i.cancelled_at IS NULL
        AND (i.customer_id = ? OR (i.customer_id IS NULL AND LOWER(TRIM(i.party_name)) = LOWER(TRIM(?))))
        AND COALESCE(i.currency, 'SDG') = ?${invoiceClause.sql}
      ORDER BY i.date ASC, i.created_at ASC`,
    [customerId, customerName, targetCurrency, ...invoiceClause.values]
  );
  const paymentClause = rangeClause(range, "p.paid_at");
  const paymentsRes = await db.query(
    `SELECT p.id, p.reference, p.paid_at, p.amount, p.method, COALESCE(p.currency, 'SDG') AS currency, p.notes
       FROM customer_payments p
      WHERE p.cancelled_at IS NULL AND p.customer_id = ?
        AND COALESCE(p.currency, 'SDG') = ?${paymentClause.sql}
      ORDER BY p.paid_at ASC, p.created_at ASC`,
    [customerId, targetCurrency, ...paymentClause.values]
  );

  const events: { date: string; order: number; line: Omit<StatementLine, "runningBalance"> }[] = [];

  // 1. الرصيد الافتتاحي والرصيد المرحل لما قبل الفترة (range.from)
  const openingBal = Number(cRow.opening_balance) || 0;
  const openingCur = cRow.opening_balance_currency || "SDG";
  const openingDate = String(cRow.opening_balance_date || cRow.created_at || "2026-01-01").slice(0, 10);
  const hasOpening = openingBal > 0 && openingCur === targetCurrency;
  const isOpeningCredit = cRow.opening_balance_type === "credit";
  let broughtForwardBalance = 0;

  if (range.from) {
    const priorInvRes = await db.query(
      `SELECT COALESCE(SUM(i.total_amount), 0) AS total
         FROM custom_invoices i
        WHERE i.type = 'sales' AND i.cancelled_at IS NULL
          AND (i.customer_id = ? OR (i.customer_id IS NULL AND LOWER(TRIM(i.party_name)) = LOWER(TRIM(?))))
          AND COALESCE(i.currency, 'SDG') = ? AND i.date < ?`,
      [customerId, customerName, targetCurrency, range.from]
    );
    const priorPayRes = await db.query(
      `SELECT COALESCE(SUM(p.amount), 0) AS total
         FROM customer_payments p
        WHERE p.cancelled_at IS NULL AND p.customer_id = ?
          AND COALESCE(p.currency, 'SDG') = ? AND p.paid_at < ?`,
      [customerId, targetCurrency, range.from]
    );
    const priorOpeningSigned =
      hasOpening && openingDate < range.from ? (isOpeningCredit ? -openingBal : openingBal) : 0;
    const broughtForward = round2(
      priorOpeningSigned + num(priorInvRes.values?.[0]?.total) - num(priorPayRes.values?.[0]?.total)
    );
    broughtForwardBalance = broughtForward;
    if (Math.abs(broughtForward) > 0.009) {
      events.push({
        date: range.from,
        order: -2,
        line: {
          kind: "opening_balance",
          id: `bf-${customerId}`,
          reference: "رصيد مرحل",
          date: range.from,
          label: broughtForward > 0 ? "رصيد مرحل ما قبل الفترة (مدين)" : "رصيد مرحل ما قبل الفترة (دائن)",
          debit: broughtForward > 0 ? broughtForward : 0,
          credit: broughtForward < 0 ? round2(Math.abs(broughtForward)) : 0,
          currency: targetCurrency,
        },
      });
    }
  }

  const openingInPeriod =
    hasOpening && (!range.from || openingDate >= range.from) && (!range.to || openingDate <= range.to);
  if (openingInPeriod) {
    events.push({
      date: openingDate,
      order: -1,
      line: {
        kind: "opening_balance",
        id: `opening-${customerId}`,
        reference: "رصيد سابق",
        date: String(cRow.opening_balance_date || cRow.created_at || "").slice(0, 10),
        label: isOpeningCredit ? "رصيد افتتاحي دائن (دفعة مقدمة)" : "رصيد افتتاحي مدين (مستحقات سابقة)",
        debit: isOpeningCredit ? 0 : round2(openingBal),
        credit: isOpeningCredit ? round2(openingBal) : 0,
        notes: cRow.opening_balance_notes ? String(cRow.opening_balance_notes) : undefined,
        currency: targetCurrency,
      },
    });
  }

  for (const row of invoicesRes.values ?? []) {
    events.push({
      date: String(row.date ?? ""),
      order: 0,
      line: {
        kind: "invoice",
        id: String(row.id),
        reference: String(row.reference ?? row.serial ?? ""),
        date: String(row.date ?? ""),
        label: "فاتورة مبيعات",
        debit: num(row.total_amount),
        credit: 0,
        notes: row.notes ? String(row.notes) : undefined,
        currency: String(row.currency || "SDG"),
      },
    });
  }
  for (const row of paymentsRes.values ?? []) {
    events.push({
      date: String(row.paid_at ?? ""),
      order: 1,
      line: {
        kind: "receipt",
        id: String(row.id),
        reference: String(row.reference ?? ""),
        date: String(row.paid_at ?? ""),
        label: `سند تحصيل (${row.method ?? "نقدي"})`,
        debit: 0,
        credit: num(row.amount),
        notes: row.notes ? String(row.notes) : undefined,
        currency: String(row.currency || "SDG"),
      },
    });
  }

  events.sort((a, b) => (a.date === b.date ? a.order - b.order : a.date < b.date ? -1 : 1));

  let running = 0;
  const lines: StatementLine[] = [];
  for (const event of events) {
    running += event.line.debit - event.line.credit;
    lines.push({ ...event.line, runningBalance: round2(running) });
  }

  const totalInvoiced = lines.reduce((sum, line) => sum + line.debit, 0);
  const totalCollected = lines.reduce((sum, line) => sum + line.credit, 0);
  const netBalance = round2(running);

  const todayIso = getLocalIsoDate();
  const earliestLineDate = lines.find((l) => Boolean(l.date))?.date;
  const customerCreatedIso = cRow.created_at ? String(cRow.created_at).slice(0, 10) : "";
  const periodFrom = range.from || earliestLineDate || customerCreatedIso || todayIso;
  const periodTo = range.to || todayIso;

  return {
    customerId,
    customerName,
    currency: targetCurrency,
    lines,
    totalInvoiced: round2(totalInvoiced),
    totalCollected: round2(totalCollected),
    outstanding: round2(Math.max(0, netBalance)),
    netBalance,
    openingBalance: round2(openingInPeriod ? openingBal : 0),
    broughtForwardBalance,
    periodFrom,
    periodTo,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Report C — Supplier statement (§11.5 C)
// ═══════════════════════════════════════════════════════════════════════════

export interface SupplierStatement {
  supplierId: string;
  supplierName: string;
  currency: AppCurrency;
  lines: StatementLine[];
  totalPurchased: number;
  totalPaid: number;
  outstanding: number;
  netBalance: number;
}

export async function getSupplierStatement(
  supplierId: string,
  range: DateRange = {},
  filterCurrency?: AppCurrency
): Promise<SupplierStatement> {
  const db = await getDb();
  const supplierRes = await db.query("SELECT name FROM suppliers WHERE id = ? LIMIT 1", [supplierId]);
  const supplierName = String(supplierRes.values?.[0]?.name ?? "مورد");

  const targetCurrency: AppCurrency = sanitizeCurrency(filterCurrency, "SDG");
  const curPlain = currencyClause(targetCurrency, "currency");
  const curPay = currencyClause(targetCurrency, "p.currency");

  const invoiceClause = rangeClause(range, "date");
  const invoicesRes = await db.query(
    `SELECT id, reference, serial, date, total_amount, COALESCE(currency, 'SDG') AS resolved_currency
       FROM custom_invoices
      WHERE type = 'purchase' AND cancelled_at IS NULL AND supplier_id = ?${invoiceClause.sql}${curPlain.sql}
      ORDER BY date ASC, created_at ASC`,
    [supplierId, ...invoiceClause.values, ...curPlain.values]
  );
  const paymentClause = rangeClause(range, "p.paid_at");
  const paymentsRes = await db.query(
    `SELECT p.id, p.reference, p.paid_at, p.amount, p.method, COALESCE(p.currency, 'SDG') AS resolved_currency
       FROM supplier_payments p
      WHERE p.cancelled_at IS NULL AND p.supplier_id = ?${paymentClause.sql}${curPay.sql}
      ORDER BY p.paid_at ASC, p.created_at ASC`,
    [supplierId, ...paymentClause.values, ...curPay.values]
  );

  const events: { date: string; order: number; line: Omit<StatementLine, "runningBalance"> }[] = [];

  if (range.from) {
    const priorInvRes = await db.query(
      `SELECT COALESCE(SUM(total_amount), 0) AS total
         FROM custom_invoices
        WHERE type = 'purchase' AND cancelled_at IS NULL AND supplier_id = ? AND date < ?${curPlain.sql}`,
      [supplierId, range.from, ...curPlain.values]
    );
    const priorPayRes = await db.query(
      `SELECT COALESCE(SUM(p.amount), 0) AS total
         FROM supplier_payments p
        WHERE p.cancelled_at IS NULL AND p.supplier_id = ? AND p.paid_at < ?${curPay.sql}`,
      [supplierId, range.from, ...curPay.values]
    );
    const broughtForward = round2(num(priorInvRes.values?.[0]?.total) - num(priorPayRes.values?.[0]?.total));
    if (Math.abs(broughtForward) > 0.009) {
      events.push({
        date: range.from,
        order: -2,
        line: {
          kind: "opening_balance",
          id: `bf-sup-${supplierId}`,
          reference: "رصيد مرحل",
          date: range.from,
          label: "رصيد مرحل ما قبل الفترة",
          debit: broughtForward < 0 ? round2(Math.abs(broughtForward)) : 0,
          credit: broughtForward > 0 ? broughtForward : 0,
          currency: targetCurrency,
        },
      });
    }
  }

  for (const row of invoicesRes.values ?? []) {
    events.push({
      date: String(row.date ?? ""),
      order: 0,
      line: {
        kind: "invoice",
        id: String(row.id),
        reference: String(row.reference ?? row.serial ?? ""),
        date: String(row.date ?? ""),
        label: "فاتورة شراء",
        debit: 0,
        credit: num(row.total_amount),
        currency: sanitizeCurrency(row.resolved_currency, "SDG"),
      },
    });
  }
  for (const row of paymentsRes.values ?? []) {
    events.push({
      date: String(row.paid_at ?? ""),
      order: 1,
      line: {
        kind: "receipt",
        id: String(row.id),
        reference: String(row.reference ?? ""),
        date: String(row.paid_at ?? ""),
        label: "سداد للمورد",
        debit: num(row.amount),
        credit: 0,
        currency: sanitizeCurrency(row.resolved_currency, "SDG"),
      },
    });
  }

  events.sort((a, b) => (a.date === b.date ? a.order - b.order : a.date < b.date ? -1 : 1));

  let running = 0;
  const lines: StatementLine[] = [];
  for (const event of events) {
    running += event.line.credit - event.line.debit;
    lines.push({ ...event.line, runningBalance: round2(running) });
  }

  const totalPurchased = lines.reduce((sum, line) => sum + line.credit, 0);
  const totalPaid = lines.reduce((sum, line) => sum + line.debit, 0);
  const netBalance = round2(running);

  return {
    supplierId,
    supplierName,
    currency: targetCurrency,
    lines,
    totalPurchased: round2(totalPurchased),
    totalPaid: round2(totalPaid),
    outstanding: round2(Math.max(0, netBalance)),
    netBalance,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Report D — Cash movement (§11.5 D)
// ═══════════════════════════════════════════════════════════════════════════

export interface CashMovementLine {
  id: string;
  kind: string;
  date: string;
  accountName: string;
  currency?: AppCurrency | undefined;
  reference?: string | undefined;
  sourceType?: string | undefined;
  sourceId?: string | undefined;
  inflow: number;
  outflow: number;
  reversed: boolean;
}

export interface CashMovementReport {
  lines: CashMovementLine[];
  totalInflow: number;
  totalOutflow: number;
  net: number;
}

export async function getCashMovementReport(
  range: DateRange = {},
  currency?: AppCurrency
): Promise<CashMovementReport> {
  const db = await getDb();
  const clause = rangeClause(range, "t.occurred_at");
  const curClause = currencyClause(currency, "COALESCE(t.currency, a.currency, 'SDG')");
  const res = await db.query(
    `SELECT t.id, t.kind, t.occurred_at, t.amount, t.reference_note, t.source_type, t.source_id, t.reversed_by,
            a.name AS account_name, COALESCE(t.currency, a.currency, 'SDG') AS resolved_currency
       FROM financial_transactions t
       LEFT JOIN financial_accounts a ON a.id = t.account_id
      WHERE 1 = 1${clause.sql}${curClause.sql}
      ORDER BY t.occurred_at DESC, t.created_at DESC`,
    [...clause.values, ...curClause.values]
  );

  const lines: CashMovementLine[] = (res.values ?? []).map((row: any) => {
    const inflow = row.kind === "receipt" || row.kind === "transfer_in";
    const amount = num(row.amount);
    return {
      id: String(row.id),
      kind: String(row.kind),
      date: String(row.occurred_at ?? ""),
      accountName: String(row.account_name ?? "حساب محذوف"),
      currency: sanitizeCurrency(row.resolved_currency, "SDG"),
      reference: row.reference_note ?? undefined,
      sourceType: row.source_type ?? undefined,
      sourceId: row.source_id ?? undefined,
      inflow: inflow ? amount : 0,
      outflow: inflow ? 0 : amount,
      reversed: Boolean(row.reversed_by),
    };
  });

  const active = lines.filter((line) => !line.reversed);
  const totalInflow = active.reduce((sum, line) => sum + line.inflow, 0);
  const totalOutflow = active.reduce((sum, line) => sum + line.outflow, 0);

  return { lines, totalInflow: round2(totalInflow), totalOutflow: round2(totalOutflow), net: round2(totalInflow - totalOutflow) };
}
