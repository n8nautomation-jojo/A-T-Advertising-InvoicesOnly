/**
 * ═══════════════════════════════════════════════════════════════
 * Ledger read model (PRD §9, §10)
 * ═══════════════════════════════════════════════════════════════
 * Everything here is DERIVED from authoritative records: invoice settlement from
 * allocations, supplier obligations from purchase invoices minus payments,
 * balances from ledger movements, and profitability from recorded documents.
 * No figure is cached or maintained by hand (§10.2).
 */

import { getDb } from "@/lib/database";
import { getLocalIsoDate } from "@/lib/dateUtils";
import { sanitizeCurrency, type AppCurrency } from "@/lib/currency/types";
import {
  buildCompanyProfitability,
  buildSettlement,
  totalLiquidity,
  type CompanyProfitability,
  type LedgerEntry,
  type LedgerKind,
  type SettlementSummary,
} from "@/lib/domain/finance";
import { getAccountBalances } from "@/lib/repositories/FinancialAccountRepository";

/** Paid amount per invoice, derived from valid allocations only. */
export async function getInvoicePaidMap(kind: "sales" | "purchase" = "sales"): Promise<Record<string, number>> {
  const db = await getDb();
  const allocationTable =
    kind === "sales" ? "customer_payment_allocations" : "supplier_payment_allocations";
  const paymentTable = kind === "sales" ? "customer_payments" : "supplier_payments";
  const res = await db.query(
    `SELECT a.invoice_id AS invoice_id, COALESCE(SUM(a.amount), 0) AS paid
       FROM ${allocationTable} a
       JOIN ${paymentTable} p ON p.id = a.payment_id
       JOIN custom_invoices i ON i.id = a.invoice_id
      WHERE p.cancelled_at IS NULL AND i.cancelled_at IS NULL
      GROUP BY a.invoice_id`
  );
  const map: Record<string, number> = {};
  for (const row of res.values ?? []) {
    map[String(row.invoice_id)] = Number(row.paid) || 0;
  }
  return map;
}

/** Settlement of one invoice (total, paid, outstanding, derived status). */
export async function getInvoiceSettlement(
  invoiceId: string,
  kind: "sales" | "purchase" = "sales",
  total?: number
): Promise<SettlementSummary | null> {
  const db = await getDb();
  let invoiceTotal = total;
  if (invoiceTotal === undefined) {
    const res = await db.query("SELECT total_amount FROM custom_invoices WHERE id = ? LIMIT 1", [invoiceId]);
    const row = res.values?.[0];
    if (!row) return null;
    invoiceTotal = Number(row.total_amount) || 0;
  }
  const allocationTable =
    kind === "sales" ? "customer_payment_allocations" : "supplier_payment_allocations";
  const paymentTable = kind === "sales" ? "customer_payments" : "supplier_payments";
  const res = await db.query(
    `SELECT COALESCE(SUM(a.amount), 0) AS paid
       FROM ${allocationTable} a
       JOIN ${paymentTable} p ON p.id = a.payment_id
       JOIN custom_invoices i ON i.id = a.invoice_id
      WHERE p.cancelled_at IS NULL AND i.cancelled_at IS NULL AND a.invoice_id = ?`,
    [invoiceId]
  );
  const paid = Number(res.values?.[0]?.paid) || 0;
  return buildSettlement(invoiceTotal, paid);
}

export interface MoneyMovement {
  id: string;
  kind: LedgerKind;
  amount: number;
  currency: AppCurrency;
  occurredAt: string;
  accountId: string;
  accountName: string;
  counterAccountId?: string | undefined;
  sourceType?: string | undefined;
  sourceId?: string | undefined;
  reference?: string | undefined;
  notes?: string | undefined;
  reversed: boolean;
}

/** Ledger movements with the account name resolved for display. */
export async function getMoneyMovements(limit = 200, currency?: AppCurrency): Promise<MoneyMovement[]> {
  const db = await getDb();
  const whereSql = currency ? "WHERE COALESCE(t.currency, a.currency, 'SDG') = ?" : "";
  const params: any[] = currency ? [currency, limit] : [limit];
  const res = await db.query(
    `SELECT t.*, a.name AS account_name, COALESCE(t.currency, a.currency, 'SDG') AS resolved_currency
       FROM financial_transactions t
       LEFT JOIN financial_accounts a ON a.id = t.account_id
      ${whereSql}
      ORDER BY t.occurred_at DESC, t.created_at DESC
      LIMIT ?`,
    params
  );
  return (res.values ?? []).map((row: any) => ({
    id: String(row.id),
    kind: row.kind as LedgerKind,
    amount: Number(row.amount) || 0,
    currency: sanitizeCurrency(row.resolved_currency, "SDG"),
    occurredAt: String(row.occurred_at ?? ""),
    accountId: String(row.account_id),
    accountName: String(row.account_name ?? "حساب محذوف"),
    counterAccountId: row.counter_account_id ?? undefined,
    sourceType: row.source_type ?? undefined,
    sourceId: row.source_id ?? undefined,
    reference: row.reference_note ?? undefined,
    notes: row.notes ?? undefined,
    reversed: Boolean(row.reversed_by),
  }));
}

export interface CustomerAccount {
  customerId: string;
  invoicedTotal: number;
  collectedTotal: number;
  outstanding: number;
  invoiceCount: number;
}

/** Customer receivables derived from opening balance + invoices and their collections (§9.1). */
export async function getCustomerAccount(customerId: string, currency?: AppCurrency): Promise<CustomerAccount> {
  const db = await getDb();
  const curSql = currency ? " AND COALESCE(currency, 'SDG') = ?" : "";
  const invParams = currency ? [currency, customerId, customerId] : [customerId, customerId];
  const [res, custRes] = await Promise.all([
    db.query(
      `SELECT COALESCE(SUM(total_amount), 0) AS total, COUNT(*) AS c
         FROM custom_invoices
        WHERE type = 'sales' AND cancelled_at IS NULL${curSql}
          AND (customer_id = ? OR (customer_id IS NULL AND LOWER(TRIM(party_name)) = (SELECT LOWER(TRIM(name)) FROM customers WHERE id = ? LIMIT 1)))`,
      invParams
    ),
    db.query(
      "SELECT COALESCE(opening_balance, 0) AS opening_balance, COALESCE(opening_balance_currency, 'SDG') AS opening_currency FROM customers WHERE id = ? LIMIT 1",
      [customerId]
    ),
  ]);
  const invoicedOnly = Number(res.values?.[0]?.total) || 0;
  const invoiceCount = Number(res.values?.[0]?.c) || 0;
  const custRow = custRes.values?.[0];
  const rawOpening = Number(custRow?.opening_balance) || 0;
  const openingCur = sanitizeCurrency(custRow?.opening_currency, "SDG");
  const openingApplicable = !currency || openingCur === currency ? rawOpening : 0;
  const invoicedTotal = invoicedOnly + Math.max(0, openingApplicable);

  const payParams = currency ? [customerId, currency] : [customerId];
  const collectedRes = await db.query(
    `SELECT COALESCE(SUM(amount), 0) AS total FROM customer_payments WHERE customer_id = ? AND cancelled_at IS NULL${curSql}`,
    payParams
  );
  const collectedTotal = Number(collectedRes.values?.[0]?.total) || 0;

  return {
    customerId,
    invoicedTotal: round2(invoicedTotal),
    collectedTotal: round2(collectedTotal),
    outstanding: round2(Math.max(0, invoicedTotal - collectedTotal)),
    invoiceCount,
  };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export interface CashSummary {
  liquidity: number;
  receipts: number;
  payments: number;
  accountCount: number;
}

/** Actual cash in and out (liquidity, PRD §8.3). */
export async function getCashSummary(currency?: AppCurrency): Promise<CashSummary> {
  const db = await getDb();
  const allReports = await getAccountBalances();
  const reports = currency ? allReports.filter((r) => r.account.currency === currency) : allReports;
  const txWhereCur = currency ? " AND COALESCE(t.currency, a.currency, 'SDG') = ?" : "";
  const txParams = currency ? [currency] : [];
  const receiptsRes = await db.query(
    `SELECT COALESCE(SUM(t.amount), 0) AS total
       FROM financial_transactions t
       LEFT JOIN financial_accounts a ON a.id = t.account_id
      WHERE t.kind = 'receipt' AND t.reversed_by IS NULL${txWhereCur}`,
    txParams
  );
  const paymentsRes = await db.query(
    `SELECT COALESCE(SUM(t.amount), 0) AS total
       FROM financial_transactions t
       LEFT JOIN financial_accounts a ON a.id = t.account_id
      WHERE t.kind = 'payment' AND t.reversed_by IS NULL${txWhereCur}`,
    txParams
  );
  return {
    liquidity: totalLiquidity(reports),
    receipts: round2(Number(receiptsRes.values?.[0]?.total) || 0),
    payments: round2(Number(paymentsRes.values?.[0]?.total) || 0),
    accountCount: reports.length,
  };
}

export interface ReceivablesSummary {
  invoiced: number;
  collected: number;
  outstanding: number;
  partialCount: number;
  unpaidCount: number;
  overdueCount: number;
}

/** Company-wide receivables, split the way the specification demands (§11.2). */
export async function getReceivablesSummary(
  today = getLocalIsoDate(),
  currency?: AppCurrency
): Promise<ReceivablesSummary> {
  const db = await getDb();
  const curSql = currency ? " AND COALESCE(i.currency, 'SDG') = ?" : "";
  const params = currency ? [today, currency] : [today];
  const res = await db.query(
    `SELECT 
       COALESCE(SUM(i.total_amount), 0) AS invoiced,
       COALESCE(SUM(COALESCE(paid_agg.paid, 0)), 0) AS collected,
       COALESCE(SUM(CASE WHEN COALESCE(paid_agg.paid, 0) <= 0.009 THEN 1 ELSE 0 END), 0) AS unpaid_count,
       COALESCE(SUM(CASE WHEN COALESCE(paid_agg.paid, 0) > 0.009 AND (COALESCE(paid_agg.paid, 0) + 0.009) < i.total_amount THEN 1 ELSE 0 END), 0) AS partial_count,
       COALESCE(SUM(CASE WHEN (i.total_amount - COALESCE(paid_agg.paid, 0)) > 0.009 AND COALESCE(i.due_date, i.date) < ? THEN 1 ELSE 0 END), 0) AS overdue_count
     FROM custom_invoices i
     LEFT JOIN (
       SELECT a.invoice_id, SUM(a.amount) AS paid
         FROM customer_payment_allocations a
         JOIN customer_payments p ON p.id = a.payment_id
        WHERE p.cancelled_at IS NULL
        GROUP BY a.invoice_id
     ) paid_agg ON paid_agg.invoice_id = i.id
     WHERE i.type = 'sales' AND i.cancelled_at IS NULL${curSql}`,
    params
  );

  const row = res.values?.[0] || {};
  const invoiced = round2(Number(row.invoiced) || 0);
  const collected = round2(Number(row.collected) || 0);

  return {
    invoiced,
    collected,
    outstanding: round2(Math.max(0, invoiced - collected)),
    partialCount: Number(row.partial_count) || 0,
    unpaidCount: Number(row.unpaid_count) || 0,
    overdueCount: Number(row.overdue_count) || 0,
  };
}

export interface PayablesSummary {
  purchased: number;
  paid: number;
  outstanding: number;
  invoiceCount: number;
}

/** Company-wide payables to suppliers (§11.3). */
export async function getPayablesSummary(currency?: AppCurrency): Promise<PayablesSummary> {
  const db = await getDb();
  const invCurSql = currency ? " AND COALESCE(currency, 'SDG') = ?" : "";
  const allocCurSql = currency ? " AND COALESCE(i.currency, 'SDG') = ?" : "";
  const params = currency ? [currency] : [];
  const res = await db.query(
    `SELECT COALESCE(SUM(total_amount), 0) AS total, COUNT(*) AS c
       FROM custom_invoices
      WHERE type = 'purchase' AND cancelled_at IS NULL${invCurSql}`,
    params
  );
  const purchased = Number(res.values?.[0]?.total) || 0;
  const invoiceCount = Number(res.values?.[0]?.c) || 0;

  const paidRes = await db.query(
    `SELECT COALESCE(SUM(a.amount), 0) AS total
       FROM supplier_payment_allocations a
       JOIN supplier_payments p ON p.id = a.payment_id
       JOIN custom_invoices i ON i.id = a.invoice_id
      WHERE p.cancelled_at IS NULL AND i.cancelled_at IS NULL${allocCurSql}`,
    params
  );
  const paid = Number(paidRes.values?.[0]?.total) || 0;

  return {
    purchased: round2(purchased),
    paid: round2(paid),
    outstanding: round2(Math.max(0, purchased - paid)),
    invoiceCount,
  };
}

/**
 * Company profitability with the cost split the specification requires (§9.5):
 * direct project costs and operating expenses are never mixed.
 */
export async function getCompanyProfitability(currency?: AppCurrency): Promise<CompanyProfitability> {
  const db = await getDb();
  const curSql = currency ? " AND COALESCE(currency, 'SDG') = ?" : "";
  const params = currency ? [currency] : [];

  const revenueRes = await db.query(
    `SELECT COALESCE(SUM(total_amount), 0) AS total FROM custom_invoices WHERE type = 'sales' AND cancelled_at IS NULL${curSql}`,
    params
  );
  const purchasesRes = await db.query(
    `SELECT COALESCE(SUM(total_amount), 0) AS total FROM custom_invoices WHERE type = 'purchase' AND cancelled_at IS NULL${curSql}`,
    params
  );
  const directExpensesRes = await db.query(
    `SELECT COALESCE(SUM(amount), 0) AS total FROM expenses WHERE kind = 'direct' AND cancelled_at IS NULL${curSql}`,
    params
  );
  const operatingExpensesRes = await db.query(
    `SELECT COALESCE(SUM(amount), 0) AS total FROM expenses WHERE kind = 'operating' AND cancelled_at IS NULL${curSql}`,
    params
  );

  return buildCompanyProfitability({
    revenue: Number(revenueRes.values?.[0]?.total) || 0,
    directCosts:
      (Number(purchasesRes.values?.[0]?.total) || 0) + (Number(directExpensesRes.values?.[0]?.total) || 0),
    operatingExpenses: Number(operatingExpensesRes.values?.[0]?.total) || 0,
  });
}

export interface CustomerReceiptRow {
  id: string;
  reference: string | null;
  customerId: string;
  customerName: string;
  amount: number;
  currency: AppCurrency;
  paidAt: string;
  method: string;
  accountId?: string | undefined;
  notes?: string | undefined;
}

/** Recorded customer collections, newest first. */
export async function getCustomerReceipts(limit = 100, currency?: AppCurrency): Promise<CustomerReceiptRow[]> {
  const db = await getDb();
  const curSql = currency ? " AND COALESCE(p.currency, 'SDG') = ?" : "";
  const params: any[] = currency ? [currency, limit] : [limit];
  const res = await db.query(
    `SELECT p.*, c.name AS customer_name, COALESCE(p.currency, 'SDG') AS resolved_currency
       FROM customer_payments p
       LEFT JOIN customers c ON c.id = p.customer_id
      WHERE p.cancelled_at IS NULL${curSql}
      ORDER BY p.paid_at DESC, p.created_at DESC
      LIMIT ?`,
    params
  );
  return (res.values ?? []).map((row: any) => ({
    id: String(row.id),
    reference: row.reference ?? null,
    customerId: String(row.customer_id),
    customerName: String(row.customer_name ?? "عميل محذوف"),
    amount: Number(row.amount) || 0,
    currency: sanitizeCurrency(row.resolved_currency, "SDG"),
    paidAt: String(row.paid_at ?? ""),
    method: String(row.method ?? "cash"),
    accountId: row.account_id ?? undefined,
    notes: row.notes ?? undefined,
  }));
}

export interface SupplierPaymentRow {
  id: string;
  reference: string | null;
  supplierId: string;
  supplierName: string;
  amount: number;
  currency: AppCurrency;
  paidAt: string;
  method: string;
  notes?: string | undefined;
}

export async function getSupplierPayments(limit = 100, currency?: AppCurrency): Promise<SupplierPaymentRow[]> {
  const db = await getDb();
  const curSql = currency ? " AND COALESCE(p.currency, 'SDG') = ?" : "";
  const params: any[] = currency ? [currency, limit] : [limit];
  const res = await db.query(
    `SELECT p.*, s.name AS supplier_name, COALESCE(p.currency, 'SDG') AS resolved_currency
       FROM supplier_payments p
       LEFT JOIN suppliers s ON s.id = p.supplier_id
      WHERE p.cancelled_at IS NULL${curSql}
      ORDER BY p.paid_at DESC, p.created_at DESC
      LIMIT ?`,
    params
  );
  return (res.values ?? []).map((row: any) => ({
    id: String(row.id),
    reference: row.reference ?? null,
    supplierId: String(row.supplier_id),
    supplierName: String(row.supplier_name ?? "مورد محذوف"),
    amount: Number(row.amount) || 0,
    currency: sanitizeCurrency(row.resolved_currency, "SDG"),
    paidAt: String(row.paid_at ?? ""),
    method: String(row.method ?? "cash"),
    notes: row.notes ?? undefined,
  }));
}

export interface OpenSalesInvoiceRow {
  id: string;
  reference: string;
  customerId: string | null;
  customerName: string;
  date: string;
  currency: AppCurrency;
  settlement: SettlementSummary;
}

/** Invoices still carrying an outstanding balance (§11.2 drill-down). */
export async function getOpenSalesInvoices(limit = 200, currency?: AppCurrency): Promise<OpenSalesInvoiceRow[]> {
  const db = await getDb();
  const curSql = currency ? " AND COALESCE(i.currency, 'SDG') = ?" : "";
  const params: any[] = currency ? [currency, limit] : [limit];
  const res = await db.query(
    `SELECT i.id, i.reference, i.serial, i.customer_id, i.party_name, i.date, i.total_amount,
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
        AND (i.total_amount - COALESCE(paid_agg.paid, 0)) > 0.009${curSql}
      ORDER BY i.date DESC, i.created_at DESC
      LIMIT ?`,
    params
  );
  const rows: OpenSalesInvoiceRow[] = [];
  for (const row of res.values ?? []) {
    const total = Number(row.total_amount) || 0;
    const paid = Number(row.paid) || 0;
    const settlement = buildSettlement(total, paid);
    rows.push({
      id: String(row.id),
      reference: String(row.reference ?? row.serial ?? ""),
      customerId: row.customer_id ? String(row.customer_id) : null,
      customerName: String(row.party_name ?? ""),
      date: String(row.date ?? ""),
      currency: sanitizeCurrency(row.resolved_currency, "SDG"),
      settlement,
    });
  }
  return rows;
}

// ═══════════════════════════════════════════════════════════════════════════
// Bank Account Statement (Bankak-Style Multi-Currency Ledger Read Model)
// ═══════════════════════════════════════════════════════════════════════════

export type BankStatementPeriod = "last5" | "7d" | "30d" | "90d" | "all";

export interface BankStatementItem {
  id: string;
  direction: "in" | "out";
  amount: number;
  signedAmount: number;
  runningBalance: number;
  currency: AppCurrency;
  occurredAt: string;
  title: string;
  subtitle?: string | undefined;
  reference?: string | undefined;
  sourceType: string;
  accountId: string;
  accountName: string;
}

export interface BankStatementReport {
  currency: AppCurrency;
  accountId: string | null;
  accountName: string;
  accountNumber?: string | undefined;
  period: BankStatementPeriod;
  currentBalance: number;
  periodInflow: number;
  periodOutflow: number;
  totalCount: number;
  items: BankStatementItem[];
}

function shiftIsoDateDays(isoDate: string, deltaDays: number): string {
  const parts = isoDate.slice(0, 10).split("-").map(Number);
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return isoDate.slice(0, 10);
  const dt = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
  dt.setUTCDate(dt.getUTCDate() + deltaDays);
  return dt.toISOString().slice(0, 10);
}

function buildStatementDescription(row: any, direction: "in" | "out"): {
  title: string;
  subtitle?: string | undefined;
} {
  const sourceType = String(row.source_type ?? "");
  const txNotes = row.notes ? String(row.notes).trim() : "";

  if (sourceType === "customer_payment") {
    const custName = row.customer_name ? String(row.customer_name).trim() : "";
    const invRefs = row.cp_inv_refs ? String(row.cp_inv_refs).trim() : "";
    const cpNotes = row.cp_notes ? String(row.cp_notes).trim() : txNotes;
    const title = custName ? `تحصيل مبيعات — ${custName}` : "تحصيل فاتورة مبيعات";
    const subParts = [invRefs ? `الفواتير: ${invRefs}` : "دفعة عميل", cpNotes].filter(Boolean);
    return { title, subtitle: subParts.join(" · ") || undefined };
  }

  if (sourceType === "supplier_payment") {
    const supName = row.supplier_name ? String(row.supplier_name).trim() : "";
    const invRefs = row.sp_inv_refs ? String(row.sp_inv_refs).trim() : "";
    const spNotes = row.sp_notes ? String(row.sp_notes).trim() : txNotes;
    const title = supName ? `سداد مشتريات — ${supName}` : "سداد فاتورة مشتريات";
    const subParts = [invRefs ? `الفواتير: ${invRefs}` : "دفعة مورد", spNotes].filter(Boolean);
    return { title, subtitle: subParts.join(" · ") || undefined };
  }

  if (sourceType === "expense_payment") {
    const expKind = row.exp_kind === "operating" ? "مصروف تشغيلي" : "مصروف مباشر";
    const cat = row.exp_category ? String(row.exp_category).trim() : "";
    const ben = row.exp_beneficiary ? String(row.exp_beneficiary).trim() : "";
    const expNotes = row.exp_notes ? String(row.exp_notes).trim() : txNotes;
    const label = [cat, ben].filter(Boolean).join(" — ");
    const title = label ? `${expKind} — ${label}` : expKind;
    return { title, subtitle: expNotes || undefined };
  }

  if (sourceType === "opening_balance") {
    return {
      title: "رصيد بنكي افتتاحي معتمد",
      subtitle: txNotes || undefined,
    };
  }

  if (sourceType === "bank_reconciliation") {
    return {
      title:
        direction === "in"
          ? "تغذية / إيداع خارجي — مطابقة الرصيد البنكي"
          : "خصم / منصرف خارجي — مطابقة الرصيد البنكي",
      subtitle: txNotes || undefined,
    };
  }

  if (sourceType === "external_deposit") {
    return {
      title: "إيداع / تحويل خارجي وارد للحساب",
      subtitle: txNotes || undefined,
    };
  }

  if (sourceType === "external_withdrawal") {
    return {
      title: "سحب / عمولة بنكية خارجية",
      subtitle: txNotes || undefined,
    };
  }

  if (row.kind === "transfer_in" || row.kind === "transfer_out") {
    const counterName = row.counter_account_name ? String(row.counter_account_name).trim() : "";
    const title =
      row.kind === "transfer_in"
        ? counterName
          ? `تحويل وارد من ${counterName}`
          : "تحويل داخلي وارد"
        : counterName
        ? `تحويل صادر إلى ${counterName}`
        : "تحويل داخلي صادر";
    return { title, subtitle: txNotes || undefined };
  }

  return {
    title: direction === "in" ? "إيداع بحساب البنك" : "خصم من حساب البنك",
    subtitle: txNotes || undefined,
  };
}

/**
 * Builds an authoritative Bank Statement for a specific account or currency
 * with chronological running balance, green (`in`) / red (`out`) semantics,
 * and Bankak-style period filters (`last5`, `7d`, `30d`, `90d`, `all`).
 */
export async function getBankAccountStatement(input: {
  currency: AppCurrency;
  accountId?: string;
  period?: BankStatementPeriod;
  today?: string;
}): Promise<BankStatementReport> {
  const db = await getDb();
  const currency = sanitizeCurrency(input.currency, "SDG");
  const period: BankStatementPeriod = input.period ?? "last5";
  const today = input.today ?? getLocalIsoDate();

  const allReports = await getAccountBalances();
  const targetReports = input.accountId
    ? allReports.filter((r) => r.account.id === input.accountId)
    : allReports.filter((r) => sanitizeCurrency(r.account.currency, "SDG") === currency);

  const primaryAccount = targetReports[0]?.account;
  const openingSum = round2(targetReports.reduce((s, r) => s + (r.account.openingBalance || 0), 0));
  const currentBalance = round2(targetReports.reduce((s, r) => s + r.balance, 0));

  const whereClause = input.accountId
    ? "WHERE t.account_id = ? AND (t.reversed_by IS NULL OR t.reversed_by = '') AND COALESCE(t.currency, a.currency, 'SDG') = ?"
    : "WHERE (t.reversed_by IS NULL OR t.reversed_by = '') AND COALESCE(t.currency, a.currency, 'SDG') = ? AND a.is_active = 1";
  const params = input.accountId ? [input.accountId, currency] : [currency];

  const res = await db.query(
    `SELECT
       t.id, t.kind, t.amount, t.occurred_at, t.account_id, t.counter_account_id,
       t.source_type, t.source_id, t.reference_note, t.notes, t.created_at,
       COALESCE(t.currency, a.currency, 'SDG') AS resolved_currency,
       a.name AS account_name,
       ca.name AS counter_account_name,
       cp.notes AS cp_notes,
       cust.name AS customer_name,
       cp_inv.inv_refs AS cp_inv_refs,
       sp.notes AS sp_notes,
       sup.name AS supplier_name,
       sp_inv.inv_refs AS sp_inv_refs,
       exp.kind AS exp_kind,
       exp.category AS exp_category,
       exp.beneficiary AS exp_beneficiary,
       exp.notes AS exp_notes
     FROM financial_transactions t
     JOIN financial_accounts a ON a.id = t.account_id
     LEFT JOIN financial_accounts ca ON ca.id = t.counter_account_id
     LEFT JOIN customer_payments cp ON t.source_type = 'customer_payment' AND cp.id = t.source_id
     LEFT JOIN customers cust ON cust.id = cp.customer_id
     LEFT JOIN (
       SELECT cpa.payment_id, GROUP_CONCAT(COALESCE(ci.reference, ci.serial), '، ') AS inv_refs
         FROM customer_payment_allocations cpa
         JOIN custom_invoices ci ON ci.id = cpa.invoice_id
        GROUP BY cpa.payment_id
     ) cp_inv ON cp_inv.payment_id = cp.id
     LEFT JOIN supplier_payments sp ON t.source_type = 'supplier_payment' AND sp.id = t.source_id
     LEFT JOIN suppliers sup ON sup.id = sp.supplier_id
     LEFT JOIN (
       SELECT spa.payment_id, GROUP_CONCAT(COALESCE(ci.reference, ci.serial), '، ') AS inv_refs
         FROM supplier_payment_allocations spa
         JOIN custom_invoices ci ON ci.id = spa.invoice_id
        GROUP BY spa.payment_id
     ) sp_inv ON sp_inv.payment_id = sp.id
     LEFT JOIN expense_payments ep ON t.source_type = 'expense_payment' AND ep.id = t.source_id
     LEFT JOIN expenses exp ON exp.id = ep.expense_id
     ${whereClause}
     ORDER BY t.occurred_at ASC, t.created_at ASC, t.rowid ASC`,
    params
  );

  const chronological: BankStatementItem[] = [];
  let running = openingSum;

  if (Math.abs(openingSum) > 0.009 && primaryAccount) {
    const dir: "in" | "out" = openingSum >= 0 ? "in" : "out";
    const absOpen = Math.abs(openingSum);
    chronological.push({
      id: `opening-${primaryAccount.id}`,
      direction: dir,
      amount: absOpen,
      signedAmount: openingSum,
      runningBalance: running,
      currency,
      occurredAt: String(primaryAccount.createdAt || today).slice(0, 10),
      title: "رصيد افتتاحي تأسيسي",
      subtitle: primaryAccount.name,
      reference: "OPENING",
      sourceType: "opening_balance",
      accountId: primaryAccount.id,
      accountName: primaryAccount.name,
    });
  }

  for (const row of res.values ?? []) {
    const kind = String(row.kind) as LedgerKind;
    const direction: "in" | "out" = kind === "receipt" || kind === "transfer_in" ? "in" : "out";
    const amount = round2(Math.abs(Number(row.amount) || 0));
    const signedAmount = direction === "in" ? amount : -amount;
    running = round2(running + signedAmount);
    const { title, subtitle } = buildStatementDescription(row, direction);

    chronological.push({
      id: String(row.id),
      direction,
      amount,
      signedAmount,
      runningBalance: running,
      currency,
      occurredAt: String(row.occurred_at ?? "").slice(0, 10),
      title,
      subtitle,
      reference: row.reference_note ? String(row.reference_note) : undefined,
      sourceType: String(row.source_type ?? kind),
      accountId: String(row.account_id),
      accountName: String(row.account_name ?? ""),
    });
  }

  const newestFirst = [...chronological].reverse();
  let filtered: BankStatementItem[];
  if (period === "last5") {
    filtered = newestFirst.slice(0, 5);
  } else if (period === "7d") {
    const cutoff = shiftIsoDateDays(today, -7);
    filtered = newestFirst.filter((item) => item.occurredAt >= cutoff);
  } else if (period === "30d") {
    const cutoff = shiftIsoDateDays(today, -30);
    filtered = newestFirst.filter((item) => item.occurredAt >= cutoff);
  } else if (period === "90d") {
    const cutoff = shiftIsoDateDays(today, -90);
    filtered = newestFirst.filter((item) => item.occurredAt >= cutoff);
  } else {
    filtered = newestFirst;
  }

  const periodInflow = round2(
    filtered.reduce((s, item) => s + (item.direction === "in" ? item.amount : 0), 0)
  );
  const periodOutflow = round2(
    filtered.reduce((s, item) => s + (item.direction === "out" ? item.amount : 0), 0)
  );

  return {
    currency,
    accountId: input.accountId ?? primaryAccount?.id ?? null,
    accountName: primaryAccount?.name ?? `حساب ${currency}`,
    accountNumber: primaryAccount?.accountNumber,
    period,
    currentBalance,
    periodInflow,
    periodOutflow,
    totalCount: newestFirst.length,
    items: filtered,
  };
}

export type { LedgerEntry };
