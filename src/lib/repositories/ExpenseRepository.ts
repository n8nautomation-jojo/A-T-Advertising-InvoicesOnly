/**
 * ═══════════════════════════════════════════════════════════════
 * Expenses — direct execution costs vs operating expenses
 * ═══════════════════════════════════════════════════════════════
 */

import { getDb } from "@/lib/database";
import { withDbWriteLock } from "@/lib/database/writeLock";
import { notifyDataChanged } from "@/lib/backup/notify";
import { appendAuditEntry } from "@/lib/repositories/AuditLogRepository";
import { allocateMoneyReference } from "@/lib/repositories/DocumentSequenceRepository";
import { sanitizeCurrency, type AppCurrency } from "@/lib/currency/types";
import {
  buildSettlement,
  sanitizeMoney,
  type PaymentMethod,
  type SettlementSummary,
} from "@/lib/domain/finance";

export type ExpenseKind = "direct" | "operating";

export const EXPENSE_KIND_LABELS: Record<ExpenseKind, string> = {
  direct: "تكلفة تنفيذ وإنتاج مباشرة",
  operating: "مصروف تشغيلي عام",
};

export interface Expense {
  id: string;
  kind: ExpenseKind;
  supplierId?: string | undefined;
  beneficiary?: string | undefined;
  category?: string | undefined;
  amount: number;
  currency: AppCurrency;
  expenseDate: string;
  method?: string | undefined;
  accountId?: string | undefined;
  evidenceRef?: string | undefined;
  notes?: string | undefined;
  createdAt: string;
  cancelledAt?: string | undefined;
}

function rowToExpense(row: any): Expense {
  return {
    id: String(row.id),
    kind: (row.kind as ExpenseKind) ?? "direct",
    supplierId: row.supplier_id ?? undefined,
    beneficiary: row.beneficiary ?? undefined,
    category: row.category ?? undefined,
    amount: Number(row.amount) || 0,
    currency: sanitizeCurrency(row.currency, "SDG"),
    expenseDate: String(row.expense_date ?? ""),
    method: row.method ?? undefined,
    accountId: row.account_id ?? undefined,
    evidenceRef: row.evidence_ref ?? undefined,
    notes: row.notes ?? undefined,
    createdAt: String(row.created_at),
    cancelledAt: row.cancelled_at ?? undefined,
  };
}

export interface ExpenseWithSettlement extends Expense {
  settlement: SettlementSummary;
}

export async function getAllExpenses(kind?: ExpenseKind): Promise<Expense[]> {
  const db = await getDb();
  const res = await db.query(
    `SELECT * FROM expenses WHERE cancelled_at IS NULL ${kind ? "AND kind = ?" : ""} ORDER BY expense_date DESC, created_at DESC`,
    kind ? [kind] : []
  );
  return (res.values ?? []).map(rowToExpense);
}

/** Single grouped SQL query replacing the previous N+1 loop. */
export async function getExpensesWithSettlement(
  kind?: ExpenseKind,
  currency?: AppCurrency
): Promise<ExpenseWithSettlement[]> {
  const db = await getDb();
  const clauses = ["e.cancelled_at IS NULL"];
  const params: any[] = [];
  if (kind) {
    clauses.push("e.kind = ?");
    params.push(kind);
  }
  if (currency) {
    clauses.push("COALESCE(e.currency, 'SDG') = ?");
    params.push(sanitizeCurrency(currency));
  }
  const res = await db.query(
    `SELECT e.*, COALESCE(ep.paid, 0) AS paid_amount
       FROM expenses e
       LEFT JOIN (
         SELECT expense_id, SUM(amount) AS paid
           FROM expense_payments
          WHERE cancelled_at IS NULL
          GROUP BY expense_id
       ) ep ON ep.expense_id = e.id
      WHERE ${clauses.join(" AND ")}
      ORDER BY e.expense_date DESC, e.created_at DESC`,
    params
  );
  return (res.values ?? []).map((row: any) => {
    const expense = rowToExpense(row);
    const paid = Number(row.paid_amount) || 0;
    return { ...expense, settlement: buildSettlement(expense.amount, paid) };
  });
}

export async function getExpenseById(id: string): Promise<Expense | undefined> {
  const db = await getDb();
  const res = await db.query("SELECT * FROM expenses WHERE id = ? LIMIT 1", [id]);
  const row = res.values?.[0];
  return row ? rowToExpense(row) : undefined;
}

export async function createExpense(
  input: {
    kind: ExpenseKind;
    supplierId?: string | null;
    beneficiary?: string;
    category?: string;
    amount: number;
    currency?: AppCurrency;
    expenseDate: string;
    evidenceRef?: string;
    notes?: string;
  },
  nowIso = new Date().toISOString()
): Promise<Expense> {
  const rawAmount = Number(input.amount);
  if (!Number.isFinite(rawAmount) || rawAmount <= 0) {
    throw new Error("قيمة المصروف يجب أن تكون أكبر من صفر");
  }
  const amount = sanitizeMoney(rawAmount);
  const currency = sanitizeCurrency(input.currency, "SDG");

  return withDbWriteLock(async () => {
    const db = await getDb();
    const id = `exp-${nowIso.replace(/[^0-9]/g, "").slice(0, 14)}-${Math.random().toString(36).slice(2, 6)}`;
    await db.run(
      `INSERT INTO expenses
         (id, kind, supplier_id, beneficiary, category, amount, currency, expense_date, evidence_ref, notes, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [
        id,
        input.kind,
        input.supplierId ?? null,
        input.beneficiary ?? null,
        input.category ?? null,
        amount,
        currency,
        input.expenseDate,
        input.evidenceRef ?? null,
        input.notes ?? null,
        nowIso,
      ]
    );

    await appendAuditEntry({
      entityType: "expense",
      entityId: id,
      action: "create",
      details: { kind: input.kind, amount, currency },
      nowIso,
    });
    notifyDataChanged();

    return {
      id,
      kind: input.kind,
      supplierId: input.supplierId ?? undefined,
      beneficiary: input.beneficiary,
      category: input.category,
      amount,
      currency,
      expenseDate: input.expenseDate,
      evidenceRef: input.evidenceRef,
      notes: input.notes,
      createdAt: nowIso,
    };
  });
}

export async function cancelExpense(id: string, reason: string | null, nowIso = new Date().toISOString()): Promise<void> {
  await withDbWriteLock(async () => {
    const db = await getDb();
    const paidRes = await db.query(
      "SELECT COALESCE(SUM(amount), 0) AS paid FROM expense_payments WHERE expense_id = ? AND cancelled_at IS NULL",
      [id]
    );
    const activePaid = Number(paidRes.values?.[0]?.paid) || 0;
    if (activePaid > 0.001) {
      throw new Error(
        `لا يمكن إلغاء مصروف مرتبط بسدادات نشطة بقيمة (${activePaid}). يرجى إلغاء سدادات المصروف أولاً.`
      );
    }

    await db.run("UPDATE expenses SET cancelled_at = ?, cancellation_reason = ? WHERE id = ? AND cancelled_at IS NULL", [
      nowIso,
      reason,
      id,
    ]);
    await appendAuditEntry({ entityType: "expense", entityId: id, action: "cancel", reason, nowIso });
    notifyDataChanged();
  });
}

export interface ExpensePayment {
  id: string;
  reference: string | null;
  expenseId: string;
  amount: number;
  currency: AppCurrency;
  paidAt: string;
  method: PaymentMethod;
  accountId?: string | undefined;
  notes?: string | undefined;
  createdAt: string;
}

export async function payExpense(
  input: {
    expenseId: string;
    amount: number;
    currency?: AppCurrency;
    paidAt: string;
    method?: PaymentMethod;
    accountId: string;
    notes?: string;
  },
  nowIso = new Date().toISOString()
): Promise<ExpensePayment> {
  const rawAmount = Number(input.amount);
  if (!Number.isFinite(rawAmount) || rawAmount <= 0) {
    throw new Error("قيمة السداد يجب أن تكون أكبر من صفر");
  }
  const amount = sanitizeMoney(rawAmount);
  if (!input.accountId) throw new Error("يجب تحديد الحساب المالي الذي خرج منه المبلغ");

  return withDbWriteLock(async () => {
    const db = await getDb();
    const expense = await getExpenseById(input.expenseId);
    if (!expense) throw new Error("المصروف غير موجود");
    if (expense.cancelledAt) throw new Error("لا يمكن سداد مصروف ملغى.");

    const currency = sanitizeCurrency(input.currency ?? expense.currency, expense.currency);
    if (currency !== expense.currency) {
      throw new Error(`عملة السداد (${currency}) لا تطابق عملة المصروف (${expense.currency}).`);
    }

    const paidRes = await db.query(
      "SELECT COALESCE(SUM(amount), 0) AS paid FROM expense_payments WHERE expense_id = ? AND cancelled_at IS NULL",
      [input.expenseId]
    );
    const alreadyPaid = Number(paidRes.values?.[0]?.paid) || 0;
    const outstanding = sanitizeMoney(Math.max(0, expense.amount - alreadyPaid));
    if (Math.round(amount * 100) > Math.round(outstanding * 100)) {
      throw new Error(`قيمة السداد (${amount}) تتجاوز المتبقي على المصروف (${outstanding})`);
    }

    const allocated = await allocateMoneyReference("expense_payment", input.paidAt, nowIso);
    const id = `exppay-${nowIso.replace(/[^0-9]/g, "").slice(0, 14)}-${Math.random().toString(36).slice(2, 6)}`;

    await db.beginTransaction();
    try {
      await db.run(
        `INSERT INTO expense_payments
           (id, reference, expense_id, amount, currency, paid_at, method, account_id, notes, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
        [
          id,
          allocated.reference,
          input.expenseId,
          amount,
          currency,
          input.paidAt,
          input.method ?? "cash",
          input.accountId,
          input.notes ?? null,
          nowIso,
        ],
        false
      );
      await db.run(
        `INSERT INTO financial_transactions
           (id, kind, amount, currency, occurred_at, account_id, source_type, source_id, reference_note, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
        [
          `tx-${id}`,
          "payment",
          amount,
          currency,
          input.paidAt,
          input.accountId,
          "expense_payment",
          id,
          allocated.reference,
          nowIso,
        ],
        false
      );
      await db.commitTransaction();
    } catch (err) {
      try {
        await db.rollbackTransaction();
      } catch {
        // already resolved
      }
      throw err;
    }

    await appendAuditEntry({
      entityType: "expense",
      entityId: input.expenseId,
      action: "update",
      reason: "تسجيل سداد مصروف",
      details: { paymentId: id, amount, currency, reference: allocated.reference },
      nowIso,
    });
    notifyDataChanged();

    return {
      id,
      reference: allocated.reference,
      expenseId: input.expenseId,
      amount,
      currency,
      paidAt: input.paidAt,
      method: (input.method ?? "cash") as PaymentMethod,
      accountId: input.accountId,
      notes: input.notes,
      createdAt: nowIso,
    };
  });
}
